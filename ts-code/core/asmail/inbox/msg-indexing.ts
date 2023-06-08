/*
 Copyright (C) 2022 3NSoft Inc.
 
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

import { SingleProc } from '../../../lib-common/processes/synced';
import { MsgKeyInfo, MsgKeyRole } from '../keyring';
import { makeTimedCache } from "../../../lib-common/timed-cache";
import { BindParams, SQLiteOnSyncedFS, SQLiteOnVersionedFS } from '../../../lib-sqlite-on-3nstorage';
import { Database, QueryExecResult } from '../../../lib-sqlite-on-3nstorage/sqljs';
import { ensureCorrectFS } from '../../../lib-common/exceptions/file';
import { base64, utf8 } from '../../../lib-common/buffer-utils';
import { getOrMakeAndUploadFolderIn, getRemoteFolderChanges, observableFromTreeEvents, uploadFolderChangesIfAny } from '../../../lib-client/fs-sync-utils';
import { merge, Observable, Unsubscribable } from 'rxjs';
import { filter } from 'rxjs/operators';

type WritableFS = web3n.files.WritableFS;
type WritableFile = web3n.files.WritableFile;
type ReadonlyFS = web3n.files.ReadonlyFS;
type RemoteEvent = web3n.files.RemoteEvent;
type SyncState = web3n.files.SyncState;
type FileEvent = web3n.files.FileEvent;
type FolderEvent = web3n.files.FolderEvent;
type MsgInfo = web3n.asmail.MsgInfo;

interface MsgRecord extends MsgInfo {
	key: string;
	keyStatus: MsgKeyRole;
	mainObjHeaderOfs: number;
	removeAfter?: number;
}

// XXX Use TableColumnsAndParams from lib-with-sql.
//     And should we update here sqlite from that project?

const indexTab = 'inbox_index';
const column: Record<keyof MsgRecord, string> = {
	msgId: 'msg_id',
	msgType: 'msg_type',
	deliveryTS: 'delivery_ts',
	key: 'msg_key',
	keyStatus: 'key_status',
	mainObjHeaderOfs: 'main_obj_header_ofs',
	removeAfter: 'remove_after'
};
Object.freeze(column);

const createIndexTab = `CREATE TABLE ${indexTab} (
	${column.msgId} TEXT PRIMARY KEY,
	${column.msgType} TEXT,
	${column.deliveryTS} INTEGER,
	${column.key} BLOB,
	${column.keyStatus} TEXT,
	${column.mainObjHeaderOfs} INTEGER,
	${column.removeAfter} INTEGER DEFAULT 0
) STRICT`;

const insertRec = `INSERT INTO ${indexTab} (
	${column.msgId}, ${column.msgType}, ${column.deliveryTS},
	${column.key}, ${column.keyStatus}, ${column.mainObjHeaderOfs},
	${column.removeAfter}
) VALUES (
	$${column.msgId}, $${column.msgType}, $${column.deliveryTS},
	$${column.key}, $${column.keyStatus}, $${column.mainObjHeaderOfs},
	$${column.removeAfter}
)`;

const deleteRec = `DELETE FROM ${indexTab}
WHERE ${column.msgId}=$${column.msgId}`;

function listMsgInfos(db: Database, fromTS: number|undefined): MsgInfo[] {
	let result: QueryExecResult[];
	if (fromTS) {
		result = db.exec(
			`SELECT ${
				column.msgId}, ${column.msgType}, ${column.deliveryTS
			} FROM ${indexTab
			} WHERE ${column.deliveryTS}>$fromTS`,
			{
				'$fromTS': fromTS
			}
		);
	} else {
		result = db.exec(`SELECT ${
			column.msgId}, ${column.msgType}, ${column.deliveryTS
		} FROM ${indexTab}`);
	}
	if (result.length === 0) { return []; }
	const { columns, values: rows } = result[0];
	const indecies = columnIndecies(
		columns, column.msgId, column.msgType, column.deliveryTS
	);
	const msgs: MsgInfo[] = [];
	for (const row of rows) {
		msgs.push({
			msgId: row[indecies.get(column.msgId)!] as any,
			msgType: row[indecies.get(column.msgType)!] as any,
			deliveryTS: row[indecies.get(column.deliveryTS)!] as any
		});
	}
	return msgs;
}

function columnIndecies(
	columns: QueryExecResult['columns'], ...columnNames: string[]
): Map<string, number> {
	const indecies = new Map<string, number>();
	for (const colName of columnNames) {
		indecies.set(colName, columns.indexOf(colName));
	}
	return indecies;
}

function deleteMsgFrom(db: Database, msgId: string): boolean {
	db.exec(deleteRec, { [`$${column.msgId}`]: msgId });
	return (db.getRowsModified() > 0);
}

const LIMIT_RECORDS_PER_FILE = 200;

interface DBsFiles {
	getDBFile(fileTS: number): Promise<WritableFile>;
}


class RecordsInSQL {

	private readonly older = makeTimedCache<number, SQLiteOnSyncedFS>(
		10*60*1000
	);

	constructor(
		private readonly files: DBsFiles,
		private readonly latest: SQLiteOnVersionedFS,
		private readonly fileTSs: number[]
	) {
		Object.seal(this);
	}

	async add(
		msgInfo: MsgInfo, decrInfo: MsgKeyInfo, removeAfter: number
	): Promise<MsgAddition|undefined> {
		const { msgId, msgType, deliveryTS } = msgInfo;
		const { key, keyStatus, msgKeyPackLen: mainObjHeaderOfs } = decrInfo;
		const params: BindParams = {
			[`$${column.msgId}`]: msgId,
			[`$${column.msgType}`]: msgType,
			[`$${column.deliveryTS}`]: deliveryTS,
			[`$${column.key}`]: key!,
			[`$${column.keyStatus}`]: keyStatus,
			[`$${column.mainObjHeaderOfs}`]: mainObjHeaderOfs,
			[`$${column.removeAfter}`]: removeAfter,
		};
		const { db, fileTS } = await this.getDbFor(msgInfo.deliveryTS);
		db.db.exec(insertRec, params);
		if (fileTS) {
			await db.saveToFile();
			return;
		} else {
			return {
				type: 'addition',
				record: {
					msgId, msgType, deliveryTS,
					key: base64.pack(key!),
					keyStatus, mainObjHeaderOfs, removeAfter
				}
			};
		} 
	}

	async saveLatestWithAttr(logTail: LogsTail): Promise<void> {
		// XXX

	}

	private async getDbFor(deliveryTS: number): Promise<{
		db: SQLiteOnVersionedFS|SQLiteOnSyncedFS; fileTS?: number;
	}> {
		if ((this.fileTSs.length === 0)
		|| (this.fileTSs[this.fileTSs.length-1] < deliveryTS)) {
			return { db: this.latest };
		}
		let fileTS = this.fileTSs[this.fileTSs.length-1];
		for (let i=(this.fileTSs.length-2); i>=0; i-=1) {
			if (this.fileTSs[i] >= deliveryTS) {
				fileTS = this.fileTSs[i];
			} else {
				break;
			}
		}
		const db = await this.dbFromCacheOrInit(fileTS);
		return { db, fileTS };
	}

	private async dbFromCacheOrInit(fileTS: number): Promise<SQLiteOnSyncedFS> {
		let db = this.older.get(fileTS);
		if (db) { return db; }
		const dbFile = await this.files.getDBFile(fileTS);
		db = await SQLiteOnSyncedFS.makeAndStart(dbFile);
		this.older.set(fileTS, db);
		return db;
	}

	async remove(msgId: string): Promise<MsgRemoval|undefined> {
		for await (const { db, fileTS } of this.iterateDBs()) {
			if (deleteMsgFrom(db.db, msgId)) {
				if (fileTS) {
					await db.saveToFile();
					return;
				} else {
					return {
						type: 'removal',
						msgId
					};
				}
			}
		}
	}

	private async* iterateDBs() {
		yield { db: this.latest };
		for (let i=(this.fileTSs.length-1); i>=0; i=-1) {
			const fileTS = this.fileTSs[i];
			if (!fileTS) { continue; }
			const db = await this.dbFromCacheOrInit(fileTS);
			if (db) {
				yield { db, fileTS };
			}
		}
	}

	async listMsgs(fromTS: number|undefined): Promise<MsgInfo[]> {
		let lst = listMsgInfos(this.latest.db, fromTS);
		for (let i=(this.fileTSs.length-1); i>=0; i-=1) {
			const fileTS = this.fileTSs[i];
			if (fromTS && (fileTS <= fromTS)) { break; }
			const older = await this.dbFromCacheOrInit(fileTS);
			lst = listMsgInfos(older.db, fromTS).concat(lst);
		}
		lst.sort((a, b) => (a.deliveryTS - b.deliveryTS));
		return lst;
	}

	private async getIndexWith(
		deliveryTS: number
	): Promise<SQLiteOnVersionedFS|SQLiteOnSyncedFS> {
		let fileTS: number|undefined = undefined;
		for (let i=(this.fileTSs.length-1); i>=0; i-=1) {
			const fTS = this.fileTSs[i];
			if (fTS < deliveryTS) { break; }
			fileTS = fTS;
		}
		if (fileTS) {
			return await this.dbFromCacheOrInit(fileTS);
		} else {
			return this.latest;
		}
	}

	async getKeyFor(msgId: string, deliveryTS: number): Promise<{
		msgKey: Uint8Array; msgKeyRole: MsgKeyRole; mainObjHeaderOfs: number;
	}|undefined> {
		const db = await this.getIndexWith(deliveryTS);
		const result = db.db.exec(
			`SELECT ${column.key}, ${column.keyStatus}, ${column.mainObjHeaderOfs}
			FROM ${indexTab}
			WHERE ${column.msgId}=$${column.msgId}`,
			{ [`$${column.msgId}`]: msgId }
		);
		if (result.length === 0) { return; }
		const { columns, values: [ row ] } = result[0];
		const indecies = columnIndecies(
			columns, column.key, column.keyStatus, column.mainObjHeaderOfs
		);
		return {
			msgKey: row[indecies.get(column.key)!] as Uint8Array,
			msgKeyRole: row[indecies.get(column.keyStatus)!] as any,
			mainObjHeaderOfs: row[indecies.get(column.mainObjHeaderOfs)!] as number
		}
	}

}
Object.freeze(RecordsInSQL.prototype);
Object.freeze(RecordsInSQL);


interface LogFiles {
	createNewLogFile(logNum: number, jsonStr?: string): Promise<LogsTail>;
	appendLogFile(logNum: number, bytes: Uint8Array): Promise<{
		uploadedVersion: number; writeOfs: number;
	}>;
}

interface MsgAddition {
	type: 'addition';
	record: MsgRecord;
}

interface MsgRemoval {
	type: 'removal';
	msgId: string;
}

interface NewShard {
	type: 'new-shard';
	fileTS: number;
}

type ChangeToLog = MsgAddition | MsgRemoval | NewShard;

interface LogsTail {
	num: number;
	version: number;
	writeOfs: number;
}


class LogOfChanges {

	private latestLogNum: number;

	constructor(
		private readonly files: LogFiles,
		private logNums: number[],
		private latestLogVersion: number
	) {
		this.latestLogNum = this.logNums[this.logNums.length-1];
		Object.seal(this);
	}

	async push(change: ChangeToLog): Promise<LogsTail> {
		const bytes = utf8.pack(JSON.stringify(change));
		const {
			uploadedVersion, writeOfs
		} = await this.files.appendLogFile(this.latestLogNum, bytes);
		this.latestLogVersion = uploadedVersion;
		return {
			num: this.latestLogNum,
			version: this.latestLogVersion,
			writeOfs
		};
	}

}
Object.freeze(LogOfChanges.prototype);
Object.freeze(LogOfChanges);


const DBS_FOLDER = 'dbs';
const CHANGES_FOLDER = 'changes';
const LOG_EXT = '.log.json';
const DB_EXT = '.sqlite';
const LATEST_DB = `latest${DB_EXT}`;

const COMMA_BYTE = utf8.pack(',');
const SQ_BRACKET_BYTE = utf8.pack(']');


class LogAndStructFiles implements LogFiles, DBsFiles {

	private syncing: Unsubscribable|undefined = undefined;

	// XXX synchronize file saving
	private readonly logsFSaccessProc = new SingleProc();

	private constructor(
		private readonly logsFS: WritableFS,
		private readonly dbsFS: WritableFS
	) {
		ensureCorrectFS(this.logsFS, 'synced', true);
		Object.seal(this);
	}

	static async makeAndStart(syncedFS: WritableFS): Promise<{
		files: LogAndStructFiles; logs: LogOfChanges; records: RecordsInSQL;
	}> {
		ensureCorrectFS(syncedFS, 'synced', true);
		await getRemoteFolderChanges(syncedFS);
		const logsFS = await getOrMakeAndUploadFolderIn(syncedFS, CHANGES_FOLDER);
		const dbsFS = await getOrMakeAndUploadFolderIn(syncedFS, DBS_FOLDER);
		await uploadFolderChangesIfAny(syncedFS);
		const files = new LogAndStructFiles(logsFS, dbsFS);
		const logs = await files.makeLogOfChanges();
		const records = await files.makeRecords();
		files.startSyncing();
		return { files, logs, records };
	}

	private async makeLogOfChanges(): Promise<LogOfChanges> {
		const logNums = await this.logsInFolder();
		let logsTail: LogsTail;
		if (logNums.length === 0) {
			logsTail = await this.createNewLogFile(1);
			logNums.push(logsTail.num);
		} else {
			const lastLog = logNums[logNums.length-1];
			({ tail: logsTail } = await this.statLogFile(lastLog));
		}
		return new LogOfChanges(this, logNums, logsTail.version);
	}

	private logFileName(logNum: number): string {
		return `${logNum}${LOG_EXT}`;
	}

	private async logsInFolder(): Promise<number[]> {
		const lst = await this.logsFS.listFolder(``);
		const logNums: number[] = [];
		for (const { isFile, name } of lst) {
			if (!isFile || !name.endsWith(LOG_EXT)) { continue; }
			const numStr = name.substring(0, LOG_EXT.length);
			const logNum = parseInt(numStr);
			if (isNaN(logNum)) { continue; }
			logNums.push(logNum);
		}
		logNums.sort();
		return logNums;
	}

	createNewLogFile(
		logNum: number, jsonStr = '[]'
	): Promise<LogsTail> {
		return this.logsFSaccessProc.startOrChain(async () => {
			const logFile = this.logFileName(logNum);
			const version = await this.logsFS.v!.writeTxtFile(
				logFile, jsonStr, { create: true, exclusive: true }
			);
			// XXX sync disabled for now, and may be need another structure
			// await this.logsFS.v!.sync!.upload(logFile);
			// await this.logsFS.v!.sync!.upload('');
			return {
				num: logNum,
				version,
				writeOfs: jsonStr.length - 1
			};
		});
	}

	private async statLogFile(
		logNum: number
	): Promise<{ tail: LogsTail; syncState: SyncState; }> {
		const logFile = this.logFileName(logNum);
		// XXX sync disabled for now, and may be need another structure
		// const { state: syncState } = await this.logsFS.v!.sync!.status(logFile);
		// if (syncState === 'behind') {
		// 	await this.logsFS.v!.sync!.adoptRemote(logFile);
		// } else if (syncState === 'unsynced') {
		// 	await this.logsFS.v!.sync!.upload(logFile);
		// } else if (syncState === 'conflicting') {
		// 	// XXX
		// 	throw new Error(`conflict resolution needs implementation`);
		// }
		const { size, version } = await this.logsFS.stat(logFile);
		return {
			syncState: 'unsynced',
			tail: {
				num: logNum,
				version: version!,
				writeOfs: size! - 1
			}
		};
	}

	async appendLogFile(logNum: number, bytes: Uint8Array): Promise<{
		uploadedVersion: number; writeOfs: number;
	}> {
		return this.logsFSaccessProc.startOrChain(async () => {
			const logFile = this.logFileName(logNum);
			// XXX sync disabled for now, and may be need another structure
			// const { state } = await this.logsFS.v!.sync!.status(logFile);
			// if (state === 'behind') {
			// 	await this.logsFS.v!.sync!.adoptRemote(logFile);
			// } else if (state === 'conflicting') {
			// 	// XXX
			// 	throw new Error(`conflict resolution needs implementation`);
			// }
			const sink = await this.logsFS.getByteSink(
				logFile, { truncate: false }
			);
			const len = await sink.getSize();
			let writeOfs: number;
			if (len === 2) {
				await sink.splice(len-1, 1);
				writeOfs = len-1;
			} else {
				await sink.splice(len-1, 1, COMMA_BYTE);
				writeOfs = len;
			}
			await sink.splice(writeOfs, 0, bytes);
			writeOfs += bytes.length
			await sink.splice(writeOfs, 0, SQ_BRACKET_BYTE);
			await sink.done();
			// XXX sync disabled for now, and may be need another structure
			// const uploadedVersion = (await this.logsFS.v!.sync!.upload(logFile))!;
			const uploadedVersion = logNum;
			return { uploadedVersion, writeOfs };
		});
	}

	private dbFileName(fileTS: number): string {
		return `${fileTS}${DB_EXT}`;
	}

	private async makeRecords(): Promise<RecordsInSQL> {
		const latest = await this.readOrInitializeLatestDB();
		const fileTSs = await this.fileTSsOfDBShards();
		return new RecordsInSQL(this, latest, fileTSs);
	}

	async getDBFile(fileTS: number): Promise<WritableFile> {
		return await this.dbsFS.writableFile(
			this.dbFileName(fileTS), { create: false }
		);
	}

	private async readOrInitializeLatestDB(): Promise<SQLiteOnVersionedFS> {
		if (await this.dbsFS.checkFilePresence(LATEST_DB)) {
			const dbFile = await this.dbsFS.writableFile(
				LATEST_DB, { create: false }
			);
			return await SQLiteOnVersionedFS.makeAndStart(dbFile);
		} else {
			const dbFile = await this.dbsFS.writableFile(
				LATEST_DB, { create: true, exclusive: true }
			);
			const latest = await SQLiteOnVersionedFS.makeAndStart(dbFile);
			latest.db.run(createIndexTab);
			await latest.saveToFile();
			return latest;
		}
	}

	private async fileTSsOfDBShards(): Promise<number[]> {
		const lst = await this.dbsFS.listFolder('');
		const fileTSs: number[] = [];
		for (const { isFile, name } of lst) {
			if (!isFile || !name.endsWith(DB_EXT)) { continue; }
			const numStr = name.substring(0, DB_EXT.length);
			const fileTS = parseInt(numStr);
			if (isNaN(fileTS)) { continue; }
			fileTSs.push(fileTS);
		}
		fileTSs.sort();
		return fileTSs;
	}

	private startSyncing(): void {
		const db$ = observableFromTreeEvents(this.dbsFS, '');
		const change$ = observableFromTreeEvents(this.logsFS, '');

		// XXX
		// - start from data in fs, attempt to get fresh, etc. Both log and data
		//   (in parallel ?).
		// - start sync process
		// - unblock processing, as init is done
		// Write theses in functions that use RecordsInSQL and LogOfChanges
		// structures.
		// Somehow aforementioned processes ain't exclusive to either point.

		// XXX
		//  should start from reading folder and placing logs into yet unsynced db

		this.syncing = merge(change$, db$)
		.pipe(
			filter(ev => ev.type.startsWith('remote-'))
		)
		// .subscribe({
		// 	next: ev => console.log(`------ fs event:`, ev),
		// 	complete: () => console.log(` +++ MsgIndex's sync process completed`),
		// 	error: err => console.log(` *** error in MsgIndex's sync process`, err)
		// });
		.subscribe();
	}

	stopSyncing(): void {
		if (this.syncing) {
			this.syncing.unsubscribe();
			this.syncing = undefined;
		}
	}


}
Object.freeze(LogAndStructFiles.prototype);
Object.freeze(LogAndStructFiles);


/**
 * This message index stores info for messages present on the server, in the
 * inbox. Records contain message key info, time of delivery, and time of
 * desired removal.
 * 
 * Message info with keys is stored in SQLite dbs sharded/partitioned by
 * delivery timestamp. The latest shard, shard without upper time limit
 * is stored in local storage, while all other shards with limits are stored in
 * synced storage. Information in synced storage is a sum of all limited shards
 * and action logs. Action logs 
 * 
 */
export class MsgIndex {

	private constructor(
		private readonly files: LogAndStructFiles,
		private readonly records: RecordsInSQL,
		private readonly changes: LogOfChanges
	) {
		Object.seal(this);
	}

	static async make(syncedFS: WritableFS): Promise<MsgIndex> {
		const {
			files, logs, records
		} = await LogAndStructFiles.makeAndStart(syncedFS);
		const index = new MsgIndex(files, records, logs);
		return index;
	}

	stopSyncing(): void {
		this.files.stopSyncing();
	}

	async add(
		msgInfo: MsgInfo, decrInfo: MsgKeyInfo, removeAfter = 0
	): Promise<void> {
		const logChange = await this.records.add(msgInfo, decrInfo, removeAfter);
		if (!logChange) { return; }
		const logTail = await this.changes.push(logChange);
		await this.records.saveLatestWithAttr(logTail);
	}

	async remove(msgId: string): Promise<void> {
		const logChange = await this.records.remove(msgId);
		if (!logChange) { return; }
		const logTail = await this.changes.push(logChange);
		await this.records.saveLatestWithAttr(logTail);
	}

	listMsgs(fromTS: number|undefined): Promise<MsgInfo[]> {
		return this.records.listMsgs(fromTS);
	}

	getKeyFor(msgId: string, deliveryTS: number): Promise<{
		msgKey: Uint8Array; msgKeyRole: MsgKeyRole; mainObjHeaderOfs: number;
	}|undefined> {
		return this.records.getKeyFor(msgId, deliveryTS);
	}

}
Object.freeze(MsgIndex.prototype);
Object.freeze(MsgIndex);


Object.freeze(exports);