/*
 Copyright (C) 2026 3NSoft Inc.
 
 This program is free software: you can redistribute it and/or modify it under
 the terms of the GNU General Public License as published by the Free Software
 Foundation, either version 3 of the License, or (at your option) any later
 version.
 
 This program is distributed in the hope that it will be useful, but
 WITHOUT ANY WARRANTY; without even the implied warranty of
 MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 See the GNU General Public License for more details.
 
 You should have received a copy of the GNU General Public License along with
 this program. If not, see <http://www.gnu.org/licenses/>.
*/

import { FileException } from '../exceptions/file';
import { SingleProc } from '../processes/synced';
import { utf8 } from '../buffer-utils';
import { pseudoRNG, stringOfB64UrlSafeChars } from '../rng-def';
import { ConnectException } from '../exceptions/http';
import { appendFiniteSink } from '../obj-streaming/sink-utils';

type WritableFS = web3n.files.WritableFS;
type WritableFile = web3n.files.WritableFile;
type RemoteChangeEvent = web3n.files.RemoteChangeEvent;
type FSSyncException = web3n.files.FSSyncException;

const DEVICE_ID_FILE = 'device-id';
const DEV_LOGS_PROCESSING_FILE = 'dev-logs-processing';
const DEV_ID_LEN = 24;
const LOG_EXT = '.recent-changes';

function getOrMakeIdForThisDevice(localFS: WritableFS, logsFS: WritableFS): Promise<string> {
	return localFS.readTxtFile(DEVICE_ID_FILE)
	.catch(async (exc: FileException) => {
		if (!exc.notFound) {
			throw exc;
		}
		let devId = await stringOfB64UrlSafeChars(DEV_ID_LEN, pseudoRNG);
		while (await logsFS.checkFilePresence(logsFileName(devId))) {
			devId = await stringOfB64UrlSafeChars(DEV_ID_LEN, pseudoRNG);
		}
		await localFS.writeTxtFile(DEVICE_ID_FILE, devId);
		return devId;
	});
}

function logsFileName(devId: string): string {
	return `${devId}${LOG_EXT}`;
}

function devIdFromFileName(fName: string): string|undefined {
	if (fName.endsWith(LOG_EXT)) {
		return fName.slice(0, fName.length - LOG_EXT.length);
	}
}

function serializeLogs<T>(logs: LogEntry<T>[]): string {
	const json = JSON.stringify(logs);
	return json.substring(1, json.length-1);
}

function deserializeLogs<T>(choppedJSON: string): LogEntry<T>[] {
	const json = `[${choppedJSON}]`;
	return JSON.parse(json);
}

/**
 * This is a catch callback, which returns undefined on file(folder) not found
 * exception, and re-throws all other exceptions/errors.
 */
function notFoundOrReThrow(exc: FileException): undefined {
	if (!exc.notFound) { throw exc; }
	return;
}

/**
 * Log entry in synced files that act as broadcast of what operation a particular device has done.
 * There may be race condition, in which devices may perform and record same operation simultaneously in different
 * log files.
 * There will also be situations when operation is recorded only on one device, like when triggered by action on
 * one device.
 * 
 * Regular log entry has payload in `p` and `n` with entry number that is an increment counter within a given log.
 * When data set is synced to server, under some version `v`, a log entry with `syncPoint` is added.
 * `syncPoint` contains `logSyncedPoints` with last operations on known devices that have been incorporated into
 * the data set synced state of given version.
 * 
 * Sync point information allows to ignore log entries, cutting log files accordingly.
 */
export interface LogEntry<T> {
	/**
	 * When data set is synced to server, under some version `v`, this log entry is added.
	 * This contains `logSyncedPoints` with last operations on known devices that have been incorporated into data
	 * set synced state.
	 */
	syncPoint?: {
		v: number;
		logSyncedPoints: { [devId: string]: number; };
		params: any;
	};
	/**
	 * Increasing log entry number, unique to a given device log.
	 */
	n: number;
	/**
	 * Timestamp of log helps to somewhat order logs from many device.
	 */
	ts: number;
	/**
	 * Payload of regular log entry.
	 */
	p?: T;
}

/**
 * Each device tracks and keeps locally this info about which other device's operation it has already processed.
 * Logs are written sequencially. And processing should follow the order. This allows to keep only last processed
 * operations' number for each respective device.
 */
interface DevLogsProcessingState {
	/**
	 * This is a record of last processed operation from each device.
	 */
	logProcessedPoints: { [devId: string]: number; };
	lastSyncV: number;
}

export async function makeRecentChangesLogs<T>(
	logsFS: WritableFS, localLogsFS: WritableFS,
	areOpsEqual: (a: T, b: T) => boolean,
	logError: (err: any, msg?: string) => Promise<void>,
) {
	const thisDevId = await getOrMakeIdForThisDevice(localLogsFS, logsFS);

	const {
		logs, thisDevLogsFile
	} = await (async function readOrCreateLogsFile(): Promise<{
		logs: LogEntry<T>[]; thisDevLogsFile: WritableFile;
	}> {
		const thisDevLogsFile = await logsFS.writableFile(logsFileName(thisDevId), { create: false })
		.catch(notFoundOrReThrow);
		if (thisDevLogsFile) {
			const logsTxt = await thisDevLogsFile.readTxt();
			try {
				const logs = deserializeLogs<T>(logsTxt);
				return { logs, thisDevLogsFile };
			} catch (err) {
				// if there was anything wrong, by ignoring, we'll effectively overwrite file
				await logError(err, `Fail to parse current changes from log file ${logsFS.name}/${thisDevLogsFile.name}`);
				return { logs: [], thisDevLogsFile };
			}
		} else {
			const thisDevLogsFile = await logsFS.writableFile(logsFileName(thisDevId))
			await thisDevLogsFile.writeTxt('');
			return { logs: [], thisDevLogsFile };
		}
	})();
	let numOfEntriesOnLastSave = logs.length;
	let needToSave = false;
	let needToUpload = (await thisDevLogsFile.v!.sync!.status(true)).state !== 'synced';

	const {
		snapshotOpsInfoForSync, shouldProcessOp, addToRecent, addDoneOnThisDeviceRecent
	} = await makeLogsProcessingState(localLogsFS, thisDevId, areOpsEqual);

	await saveAndUploadIfNeeded();

	function watchAndApplyOpsFromOtherDevices(
		changeProc: SingleProc, sink: (ops: LogEntry<T>[]) => Promise<void>
	): () => void {
		const stopWatching = logsFS.watchTree('.', 1, {
			next: fsEvent => changeProc.startOrChain(async () => {
				if (fsEvent.path.endsWith(thisDevLogsFile.name)) {
					return;
				}
				if (fsEvent.type === 'remote-change') {
					if (fsEvent.path === '.') {
						await logsFS.v!.sync!.adoptRemote(fsEvent.path);
					} else {
						await doOnNewRemoteVersionOfLog(fsEvent, sink);
					}
				} else if ((fsEvent.type === 'entry-addition') && (fsEvent.src === 'sync') && fsEvent.entry.isFile) {
					await doOnAppearanceOfNewDeviceLog(fsEvent.entry.name, sink);
				}
			})
		});
		changeProc.startOrChain(() => getAndProcessOpsFromOtherDevicesLogs(sink));
		return stopWatching;
	}

	async function doOnAppearanceOfNewDeviceLog(
		logFile: string, sink: (ops: LogEntry<T>[]) => Promise<void>
	): Promise<void> {
		const devId = devIdFromFileName(logFile);
		if (!devId) {
			return;
		}
		try {
			const content = (await logsFS.readTxtFile(logFile));
			if (!content) {
				return;
			}
			const appendedEvents = deserializeLogs<T>(content);
			processFromLogFile(devId, appendedEvents, sink);
		} catch (err) {
			if ((err as ConnectException).type !== 'connect') {
				logError(err);
			}
		}
	}

	function processFromLogFile(
		devId: string, ops: LogEntry<T>[],
		sink: (ops: LogEntry<T>[]) => Promise<void>
	) {
		const newOps = ops.filter(op => shouldProcessOp(devId, op));
		if (newOps.length > 0) {
			const recordCompletion = addToRecent(devId, newOps);
			sink(newOps).finally(recordCompletion);
		}
	}

	async function doOnNewRemoteVersionOfLog(
		{ path, newRemoteVersion }: RemoteChangeEvent, sink: (ops: LogEntry<T>[]) => Promise<void>
	): Promise<void> {
		const devId = devIdFromFileName(path);
		if (!devId) {
			return;
		}
		try {
			const { size: initSize, version: initVersion } = await logsFS.v!.stat(path);
			if (initVersion === newRemoteVersion) {
				return;
			}
			await logsFS.v!.sync!.adoptRemote(path);
			const { size: newSize } = await logsFS.v!.stat(path);
			let additionalBytes: Uint8Array;
			if (initSize! < newSize!) {
				additionalBytes = (await logsFS.readBytes(path, (initSize! > 0) ? initSize!+1 : undefined))!;
			} else if (initSize! > newSize!) {
				additionalBytes = (await logsFS.readBytes(path))!;
			} else {
				return;
			}
			const appendedOps = deserializeLogs<T>(utf8.open(additionalBytes!));
			processFromLogFile(devId, appendedOps, sink);
		} catch (err) {
			if ((err as ConnectException).type !== 'connect') {
				logError(err);
			}
		}
	}

	function numOfLogs(): number {
		return logs.length;
	}

	function appendLogsAndUpload(...ops: T[]): Promise<void>|undefined {
		if (ops.length > 0) {
			const logEntries: LogEntry<T>[] = [];
			const ts = Date.now();
			let n = ((logs.length === 0) ? 0 : logs[logs.length-1].n);
			for (let p of ops) {
				n += 1;
				logEntries.push({ n, ts, p });
			}
			logs.push(...logEntries);
			addDoneOnThisDeviceRecent(logEntries);
			needToSave = true;
			return saveAndUploadIfNeeded();
		}
	}

	function cutLogOnDatasetSyncAndUpload(syncPointV: number, params?: any): Promise<void>|undefined {
		if (logs.length === 0) {
			return;
		}
		const lastN = logs[logs.length-1].n;
		logs.splice(0, logs.length, {
			n: lastN + 1,
			ts: Date.now(),
			syncPoint: {
				v: syncPointV,
				logSyncedPoints: snapshotOpsInfoForSync(lastN),
				params
			}
		});
		needToSave = true;
		return saveAndUploadIfNeeded();
	}

	async function saveAndUploadIfNeeded(): Promise<void> {

		if (needToSave && (logs.length > numOfEntriesOnLastSave)) {
			needToSave = false;
			// XXX do more efficient appending
			//   sink.slice is not doing efficient appending job, and when versions go into 1000's it blows things up.
			//   When appending can be done properly, we can switch to a more efficient
			// 
			// if (numOfEntriesOnLastSave > 0) {
			// 	const logsToAppend = logs.slice(numOfEntriesOnLastSave);
			// 	const logsTxt = serializeLogs(logsToAppend);
			// 	const sink = await thisDevLogsFile.getByteSink(false);
			// 	try {
			// 		await appendFiniteSink(sink, utf8.pack(','), false);
			// 		await appendFiniteSink(sink, utf8.pack(logsTxt), true);
			// 	} catch (err) {
			// 		await sink.done(err);
			// 	}
			// 	numOfEntriesOnLastSave += logsToAppend.length;
			// } else {
			// 	const logsTxt = serializeLogs(logs);
			// 	const numOfLogs = logs.length
			// 	await thisDevLogsFile.writeTxt(logsTxt)
			// 	.catch(_exc => {
			// 		needToSave = true;
			// 	});
			// 	numOfEntriesOnLastSave = numOfLogs;
			// }

			const logsTxt = serializeLogs(logs);
			const numOfLogs = logs.length
			await thisDevLogsFile.writeTxt(logsTxt)
			.catch(_exc => {
				needToSave = true;
			});
			numOfEntriesOnLastSave = numOfLogs;

			needToUpload = true;
		}
		if (needToUpload) {
			needToUpload = false;
			await thisDevLogsFile.v!.sync!.upload()
			.catch(_exc => {
				needToUpload = true;
			});
			const { existsInSyncedParent } = await thisDevLogsFile.v!.sync!.status(true);
			if (!existsInSyncedParent) {
				await syncLogsFS().catch((exc: ConnectException) => {
					if (exc.type !== 'connect') {
						logError(exc, `Fail to sync folder with messages index logs`);
					}
				});
			}
		}

	}

	async function getAndProcessOpsFromOtherDevicesLogs(sink: (op: LogEntry<T>[]) => Promise<void>): Promise<void> {

		// XXX current code assumes that dataset was brought up from synced point, if any, or has always existed

		try {
			await syncLogsFS();
		} catch (err) {
			if ((err as ConnectException).type === 'connect') {
				return;
			} else {
				logError(err);
			}
		}

		const otherDevs = (await logsFS.listFolder(''))
		.map(({ name }) => devIdFromFileName(name)!)
		.filter(devId => !!devId && (devId !== thisDevId));

		const opsFromAllDevices: LogEntry<T>[] = [];
		const recordCompletions: (() => Promise<void>)[] = [];
		for (const devId of otherDevs) {
			try {
				const logContent = await logsFS.readTxtFile(logsFileName(devId));
				const devOps = deserializeLogs<T>(logContent);
				const newOps = devOps.filter(op => shouldProcessOp(devId, op));
				if (newOps.length > 0) {
					opsFromAllDevices.push(...newOps);
					recordCompletions.push(addToRecent(devId, newOps));
				}
			} catch (err) {
				logError(err);
			}
		}

		if (opsFromAllDevices.length > 0) {
			opsFromAllDevices.sort((a, b) => (a.ts - b.ts));
			sink(opsFromAllDevices).finally(() => Promise.all(recordCompletions.map(c => c())));
		}
	}

	async function syncLogsFS(): Promise<void> {
		const { state } = await logsFS.v!.sync!.status('');
		if (state === 'behind') {
			await logsFS.v!.sync!.absorbRemoteFolderChanges('');
		} else if (state === 'conflicting') {
			await logsFS.v!.sync!.absorbRemoteFolderChanges('');
			await logsFS.v!.sync!.upload('');
		} else if (state === 'unsynced') {
			await logsFS.v!.sync!.upload('')
			.catch(async (exc: FSSyncException) => {
				if (exc.childNeverUploaded) {
					await localLogsFS.deleteFile(exc.childName!);
					return syncLogsFS();
				}
			});
		}
	}

	return {
		appendLogsAndUpload,
		watchAndApplyOpsFromOtherDevices,
		numOfLogs,
		cutLogOnDatasetSyncAndUpload
	};
}

export type RecentChangesLogs<T> = Awaited<ReturnType<typeof makeRecentChangesLogs<T>>>;

async function makeLogsProcessingState<T>(
	localLogsFS: WritableFS, thisDevId: string,
	areOpsEqual: (a: T, b: T) => boolean,
	maxRecentLen = 50
) {

	const procStateFile = await localLogsFS.writableFile(DEV_LOGS_PROCESSING_FILE);
	const pState = (procStateFile.isNew ?
		{ logProcessedPoints: {} } : await procStateFile.readJSON()
	) as DevLogsProcessingState;

	const pStateSavingProc = new SingleProc();
	let needsSaving = false;
	async function savePState() {
		needsSaving = true;
		pStateSavingProc.startOrChain(async () => {
			if (needsSaving) {
				needsSaving = false;
				await procStateFile.writeJSON(pState);
			}
		});
	}

	async function recordOpAsProcessed(devId: string, opN: number) {
		let lastProcessed = pState.logProcessedPoints[devId];
		if (lastProcessed === undefined) {
			pState.logProcessedPoints[devId] = opN;
		} else if (lastProcessed >= opN) {
			return;
		} else {
			pState.logProcessedPoints[devId] = opN;
		}
		await savePState();
		if (recentOps.length > maxRecentLen) {
			recentOps.splice(0, recentOps.length - maxRecentLen);
		}
	}

	function snapshotOpsInfoForSync(lastN: number): { [devId: string]: number; } {
		const info: { [devId: string]: number; } = {};
		for (const [devId, opN] of Object.entries(pState.logProcessedPoints)) {
			info[devId] = opN;
		}
		info[thisDevId] = lastN;
		return info;
	}

	function hasOpBeenProcessed(devId: string, opN: number): boolean {
		const lastProcessed = pState.logProcessedPoints[devId];
		return ((lastProcessed === undefined) ? false : (lastProcessed >= opN));
	}

	// XXX should switch to keeping log entry and devId to trim recents when they get applied
	//     should trim be done within recordOpAsProcessed() ?
	//     And may be we should keep recent by ts, so as not to drop too recent, when there is a lot of them.
	const recentOps: T[] = [];
	const recentSyncPoint: LogEntry<T>['syncPoint'] = undefined;

	function shouldProcessOp(devId: string, op: LogEntry<T>): boolean {
		if (hasOpBeenProcessed(devId, op.n)) {
			return false;
		}
		if (op.p === undefined) {
			if (op.syncPoint) {
				if (pState.lastSyncV >= op.syncPoint.v) {
					return false;
				} else {
					return (!recentSyncPoint || (recentSyncPoint.v < op.syncPoint.v));
				}
			} else {
				return false;
			}
		} else {
			return !recentOps.find(ev => areOpsEqual(ev, op.p!));
		}
	}

	function addToRecent(devId: string, newOps: LogEntry<T>[]): () => Promise<void> {
		newOps.sort((a, b) => (a.n - b.n));
		const lastOpN = newOps[newOps.length - 1].n;
		const payloads = newOps.map(({p}) => p).filter(p => (p !== undefined));
		if (payloads.length > 0) {
			recentOps.splice(recentOps.length, 0, ...payloads);
		}
		return () => recordOpAsProcessed(devId, lastOpN);
	}

	function addDoneOnThisDeviceRecent(done: LogEntry<T>[]): void {
		const payloads = done.map(({p}) => p).filter(p => (p !== undefined));
		recentOps.splice(0, 0, ...payloads);
	}

	return {
		snapshotOpsInfoForSync,
		shouldProcessOp,
		addToRecent,
		addDoneOnThisDeviceRecent
	};
}

export interface DatasetInstance<T> {
	watchAndApplyOpsFromOtherDevices: (changeProc: SingleProc, resetSyncInterval: () => void) => (() => void);
	absorbOpsFromOtherDevices: (changeProc: SingleProc, ops: LogEntry<T>[]) => Promise<void>;
}

export function startDatasetSync<T>(
	periodicCheckAndUploadOfData: () => Promise<void>,
	millisBeforeNextRun: () => number,
	logs: Pick<RecentChangesLogs<T>, 'watchAndApplyOpsFromOtherDevices'>,
	dataset: DatasetInstance<T>
) {

	// We order fn calls and data-sync operation within single process chain to ensure consistency.
	// This is simple, and may be good enough.
	// We pass this single process point out to wrap fn's with it, in an attempt to explicitly keeping it at the
	// boundary of incoming operations, either from fn calls, or from handling changes passed via fs events.
	const changeProc = new SingleProc();

	function datasetCheckAndSyncAction() {
		changeProc.startOrChain(periodicCheckAndUploadOfData);
	}

	let interval: ReturnType<typeof setInterval>|undefined = undefined;
	function resetSyncInterval(): void {
		if (interval !== undefined) {
			clearInterval(interval);
		}
		interval = setInterval(datasetCheckAndSyncAction, millisBeforeNextRun()).unref?.();
	}

	resetSyncInterval();

	// XXX we should watch for reconnect events and run similar to start checks of possibly missed ops

	// watch and absorb ops, coming from logs of other devices
	const stopLogsWatching = logs.watchAndApplyOpsFromOtherDevices(
		changeProc, ops => dataset.absorbOpsFromOtherDevices(changeProc, ops)
	);

	// watch and absorb ops in dataset, coming from places that dataset sets itself
	const stopDatasetWatching = dataset.watchAndApplyOpsFromOtherDevices(changeProc, resetSyncInterval);

	function stopSyncing() {
		if (interval !== undefined) {
			stopLogsWatching();
			stopDatasetWatching();
			clearInterval(interval);
			interval = undefined;
		}
	}

	return { changeProc, stopSyncing };
}


Object.freeze(exports);