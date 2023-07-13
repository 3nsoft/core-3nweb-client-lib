/*
 Copyright (C) 2016 - 2020, 2023 3NSoft Inc.
 
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

import { FileException } from '../../../../lib-common/exceptions/file';
import { SingleProc } from '../../../../lib-common/processes/synced';
import { MsgKeyInfo, MsgKeyRole } from '../../keyring';
import { base64 } from '../../../../lib-common/buffer-utils';
import { makeTimedCache } from "../../../../lib-common/timed-cache";
import { errWithCause } from '../../../../lib-common/exceptions/error';

type WritableFS = web3n.files.WritableFS;
type MsgInfo = web3n.asmail.MsgInfo;

interface MsgOpenedLog {
	msgState: 'opened';
	msgId: string;
	msgType: string;
	deliveryTS: number;
	keyB64: string;
	keyStatus: MsgKeyRole;
	mainObjHeaderOfs: number;
	removeAfter?: number;
}
interface MsgRemovedLog {
	msgState: 'removed';
	msgId: string;
	deliveryTS: number;
}

type MsgLog = MsgOpenedLog | MsgRemovedLog;

export interface MsgKey {
	msgKey: Uint8Array;
	msgKeyRole: MsgKeyRole;
	mainObjHeaderOfs: number;
}

const LIMIT_RECORDS_PER_FILE = 200;

const LATEST_LOG = 'latest.json';
const LOG_EXT = '.json';
const INDEX_FNAME_REGEXP = /^\d+\.json$/;

function logsFileName(fileTS: number|undefined): string {
	return (fileTS ? LATEST_LOG : `${fileTS}${LOG_EXT}`);
}

function fileTSOrderComparator(a: number, b: number): number {
	return (a - b);
}

function insertInto(records: MsgLog[], rec: MsgOpenedLog): void {
	if (records.length === 0) {
		records.push(rec);
		return;
	}
	const ts = rec.deliveryTS;
	for (let i=(records.length-1); i>=0; i-=1) {
		if (records[i].deliveryTS <= ts) {
			records.splice(i+1, 0, rec);
			return;
		}
	}
	records.splice(0, 0, rec);
}

function removeMsgOpenedLogFrom(logs: MsgLog[], msgId: string): boolean {
	const indToRm = logs.findIndex(
		log => ((log.msgId === msgId) && (log.msgState === 'opened'))
	);
	if (indToRm > -1) {
		logs.splice(indToRm, 1);
		return true;
	} else {
		return false;
	}
}

/**
 * This is a catch callback, which returns undefined on file(folder) not found
 * exception, and re-throws all other exceptions/errors.
 */
function notFoundOrReThrow(exc: FileException): undefined {
	if (!exc.notFound) { throw exc; }
	return;
}

export interface IndexedRecords {
	add(
		msgInfo: MsgInfo, decrInfo: MsgKeyInfo, removeAfter: number
	): Promise<void>;
	remove(msgId: string): Promise<number|undefined>;
	listMsgs(fromTS: number|undefined): Promise<MsgInfo[]>;
	getKeyFor(msgId: string, deliveryTS: number): Promise<MsgKey|undefined>;
	msgExists(msgInfo: MsgInfo): Promise<boolean>;
	stopSyncing(): void;
}

export function makeJsonBasedIndexedRecords(logs: MsgLogs): IndexedRecords {
	return new JsonBasedIndexedRecords(logs);
}

function toMsgOpenedLog(
	msgInfo: MsgInfo, decrInfo: MsgKeyInfo, removeAfter: number|undefined
): MsgOpenedLog {
	if (!decrInfo.key) {
		throw new Error(`Given message decryption info doesn't have a key for message ${msgInfo.msgId}`);
	}
	return {
		msgState: 'opened',
		msgType: msgInfo.msgType,
		msgId: msgInfo.msgId,
		deliveryTS: msgInfo.deliveryTS,
		keyB64: base64.pack(decrInfo.key),
		keyStatus: decrInfo.keyStatus,
		mainObjHeaderOfs: decrInfo.msgKeyPackLen,
		removeAfter
	};
}

function keyInfoFrom(log: MsgOpenedLog): {
	msgKey: Uint8Array; msgKeyRole: MsgKeyRole; mainObjHeaderOfs: number;
} {
	return {
		msgKey: base64.open(log.keyB64),
		msgKeyRole: log.keyStatus,
		mainObjHeaderOfs: log.mainObjHeaderOfs
	};
}

function addOnlyNonRemovedMsgs(
	dst: MsgOpenedLog[], ignore: Set<string>, src: MsgLog[]
): void {
	for (const log of src) {
		if (log.msgState === 'removed') {
			ignore.add(log.msgId);
		}
	}
	for (const log of src) {
		if ((log.msgState === 'opened') && !ignore.has(log.msgId)) {
			dst.push(log);
		}
	}
}

function cutEarlierMsgs(msgs: MsgOpenedLog[], fromTS: number): void {
	let timedEnd = msgs.length;
	for (let i=(msgs.length-1); i>=0; i-=1) {
		const msg = msgs[i];
		if (msg.deliveryTS < fromTS) {
			timedEnd = i;
		} else {
			break;
		}
	}
	if (timedEnd < msgs.length) {
		msgs.splice(timedEnd, (msgs.length - timedEnd));
	}
}


class JsonBasedIndexedRecords implements IndexedRecords {

	private readonly cachedLogs = makeTimedCache<string, MsgOpenedLog>(10*60*1000);

	constructor(
		private readonly logs: MsgLogs
	) {
		Object.seal(this);
	}

	async add(
		msgInfo: MsgInfo, decrInfo: MsgKeyInfo, removeAfter: number
	): Promise<void> {
		const msg = toMsgOpenedLog(msgInfo, decrInfo, removeAfter);
		this.cachedLogs.set(msg.msgId, msg);
	}

	async remove(msgId: string): Promise<number|undefined> {
		let foundLog = this.cachedLogs.get(msgId);
		if (foundLog) {
			this.cachedLogs.delete(msgId);
			return foundLog.deliveryTS;
		}
		for (const fileTS of [ undefined, ... this.logs.getLogFileTSs() ]) {
			let logs: MsgLog[];
			if ((fileTS === undefined)) {
				logs = this.logs.getLatestMsgLogs();
			} else {
				const logsFromFile = await this.logs.getLogsFromFile(fileTS);
				if (!logsFromFile) { continue; }
				logs = logsFromFile;
			}
			for (const log of logs) {
				if (log.msgId === msgId) {
					return log.deliveryTS;
				}
			}
		}
		return undefined;
	}

	async listMsgs(fromTS: number | undefined): Promise<MsgInfo[]> {
		const ignore = new Set<string>();
		const msgs: MsgOpenedLog[] = [];
		addOnlyNonRemovedMsgs(msgs, ignore, this.logs.getLatestMsgLogs());
		const fileTSs = this.logs.getLogFileTSs();
		if (fromTS === undefined) {
			for (const fileTS of fileTSs) {
				const logs = await this.logs.getLogsFromFile(fileTS);
				if (!logs) { continue; }
				addOnlyNonRemovedMsgs(msgs, ignore, logs);
			}
		} else {
			for (const fileTS of fileTSs) {
				if (fromTS > fileTS) { break; }
				const logs = await this.logs.getLogsFromFile(fileTS);
				if (!logs) { continue; }
				addOnlyNonRemovedMsgs(msgs, ignore, logs);
			}
		}
		// note sorting later messages to array's head
		msgs.sort((m1, m2) => (m2.deliveryTS - m1.deliveryTS));
		if (fromTS !== undefined) {
			cutEarlierMsgs(msgs, fromTS);
		}
		for (const log of msgs) {
			this.cachedLogs.set(log.msgId, log);
		}
		return msgs.map(log => ({
			msgId: log.msgId,
			msgType: log.msgType,
			deliveryTS: log.deliveryTS
		}))
	}

	async getKeyFor(
		msgId: string, deliveryTS: number
	): Promise<MsgKey|undefined> {
		let log = this.cachedLogs.get(msgId);
		if (log) {
			return keyInfoFrom(log);
		}
		log = await this.logs.getMsgOpenedLog(msgId, deliveryTS);
		if (!log) {
			return undefined;
		}
		this.cachedLogs.set(log.msgId, log);
		return keyInfoFrom(log);
	}

	async msgExists(msgInfo: MsgInfo): Promise<boolean> {
		const foundLog = this.cachedLogs.get(msgInfo.msgId);
		return (!!foundLog && (foundLog.deliveryTS === msgInfo.deliveryTS));
	}

	stopSyncing(): void {}

}
Object.freeze(JsonBasedIndexedRecords.prototype);
Object.freeze(JsonBasedIndexedRecords);


export class MsgLogs {

	private readonly changeProc = new SingleProc();

	private constructor(
		private readonly fs: WritableFS,
		private latest: MsgLog[],
		private fileTSs: number[]
	) {
		Object.seal(this);
	}

	static async makeAndStartSyncing(logsFS: WritableFS): Promise<MsgLogs> {
		const fName = logsFileName(undefined);
		let latest = await logsFS.readJSONFile<MsgLog[]>(fName)
		.catch(notFoundOrReThrow);
		if (!latest) {
			latest = [];
			await logsFS.writeJSONFile(
				fName, latest, { create: true, exclusive: true }
			);
		}
		const fileTSs = (await logsFS.listFolder('.'))
		.map(f => f.name)
		.filter(fName => fName.match(INDEX_FNAME_REGEXP))
		.map(fName => parseInt(fName.substring(0, fName.length-LOG_EXT.length)))
		.filter(fileTS => !isNaN(fileTS))
		.sort(fileTSOrderComparator);
		const logs = new MsgLogs(logsFS, latest, fileTSs);
		return logs;
	}

	stopSyncing(): void {

		// XXX fill this with content

	}

	async add(
		msgInfo: MsgInfo, decrInfo: MsgKeyInfo, removeAfter: number|undefined
	): Promise<void> {
		const msg = toMsgOpenedLog(msgInfo, decrInfo, removeAfter);
		return this.changeProc.startOrChain(async () => {
			const fileTS = this.fileTSforMsgTS(msg.deliveryTS);
			const logs = ((fileTS === undefined) ?
				this.latest : await this.getLogsFromFile(fileTS)
			);
			if (!logs) {
				throw errWithCause(
					`${logsFileName(fileTS)} not found`,
					`Expectation fail: there should be some message records.`
				);
			}
			insertInto(logs, msg);
			await this.updateLogsFile(fileTS, logs);
		});
	}

	private async updateLogsFile(
		fileTS: number|undefined, logs: MsgLog[]
	): Promise<void> {
		await this.fs.writeJSONFile(
			logsFileName(fileTS), logs, { create: false }
		);
	}

	async getLogsFromFile(
		fileTS: number|undefined
	): Promise<MsgLog[]|undefined> {
		const fName = logsFileName(undefined);
		const logs = await this.fs.readJSONFile<MsgLog[]>(fName)
		.catch(notFoundOrReThrow);
		return logs;
	}

	private fileTSforMsgTS(deliveryTS: number): number|undefined {
		if ((this.fileTSs.length === 0)
		|| (deliveryTS >= this.fileTSs[this.fileTSs.length-1])) {
			return undefined;
		}
		let fileTS = this.fileTSs[this.fileTSs.length-1];
		for (let i=(this.fileTSs.length-2); i<=0; i-=1) {
			if (deliveryTS >= this.fileTSs[i]) {
				break;
			} else {
				fileTS = this.fileTSs[i];
			}
		}
		return fileTS;
	}

	async remove(msgId: string, deliveryTS: number): Promise<void> {
		const msgRmLog: MsgRemovedLog = {
			msgState: 'removed',
			msgId,
			deliveryTS
		};
		return this.changeProc.startOrChain(async () => {
			this.latest.push(msgRmLog);
			const fileTS = this.fileTSforMsgTS(deliveryTS);
			if (fileTS === undefined) {
				removeMsgOpenedLogFrom(this.latest, msgId);
			}
			await this.updateLogsFile(undefined, this.latest);
			if (fileTS !== undefined) {
				this.scheduleRemovalOfMsgOpenedLog(fileTS, msgId);
			}
		});
	}

	private scheduleRemovalOfMsgOpenedLog(fileTS: number, msgId: string): void {
		this.changeProc.startOrChain(async () => {
			const logs = await this.getLogsFromFile(fileTS);
			if (!logs) { return; }
			const changed = removeMsgOpenedLogFrom(logs, msgId);
			if (!changed) { return; }
			await this.updateLogsFile(fileTS, logs);
		});
	}

	async getMsgOpenedLog(
		msgId: string, deliveryTS: number
	): Promise<MsgOpenedLog|undefined> {
		const fileTS = this.fileTSforMsgTS(deliveryTS);
		const logs = ((fileTS === undefined) ?
			this.latest : await this.getLogsFromFile(fileTS)
		);
		if (!logs) { return undefined; }
		return logs.find(
			log => ((log.msgId === msgId) && (log.msgState === 'opened'))
		) as MsgOpenedLog;
	}

	getLogFileTSs(): number[] {
		return this.fileTSs.concat([]);
	}

	getLatestMsgLogs(): MsgLog[] {
		return this.latest.concat([]);
	}

	// XXX need vacuum to remove MsgRemovedLog's, compact and remove log files

}
Object.freeze(MsgLogs.prototype);
Object.freeze(MsgLogs);


Object.freeze(exports);