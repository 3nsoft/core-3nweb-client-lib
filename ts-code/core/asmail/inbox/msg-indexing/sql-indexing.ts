/*
 Copyright (C) 2022 - 2023 3NSoft Inc.
 
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

import { MsgKeyInfo, MsgKeyRole } from '../../../keyring';
import { makeTimedCache } from "../../../../lib-common/timed-cache";
import { TableColumnsAndParams, SQLiteOn3NStorage } from '../../../../lib-sqlite-on-3nstorage';
import { Database, QueryExecResult } from '../../../../lib-sqlite-on-3nstorage/sqljs';
import { ensureCorrectFS } from '../../../../lib-common/exceptions/file';
import { observableFromTreeEvents } from '../../../../lib-client/fs-utils/fs-sync-utils';
import { Unsubscribable } from 'rxjs';
import { filter } from 'rxjs/operators';
import { IndexedRecords, MsgKey } from './logs-n-entries';

type WritableFS = web3n.files.WritableFS;
type WritableFile = web3n.files.WritableFile;
type ReadonlyFS = web3n.files.ReadonlyFS;
type RemoteEvent = web3n.files.RemoteEvent;
type SyncState = web3n.files.SyncState;
type FileEvent = web3n.files.FileEvent;
type FolderEvent = web3n.files.FolderEvent;
type MsgInfo = web3n.asmail.MsgInfo;

interface MsgRecord extends MsgInfo {
	key: Uint8Array;
	keyStatus: MsgKeyRole;
	mainObjHeaderOfs: number;
	removeAfter?: number;
}

const tab = new TableColumnsAndParams<MsgRecord>('inbox_index', {
	msgId: [ 'msg_id', 'TEXT PRIMARY KEY' ],
	msgType: [ 'msg_type', 'TEXT' ],
	deliveryTS: [ 'delivery_ts', 'INTEGER' ],
	key: [ 'key', 'BLOB' ],
	keyStatus: [ 'key_status', 'TEXT' ],
	mainObjHeaderOfs: [ 'main_obj_header_ofs', 'INTEGER' ],
	removeAfter: [ 'remove_after', 'INTEGER DEFAULT 0' ]
});

const createIndexTab =
`CREATE TABLE ${tab.name} (
	${tab.columnsCreateSection}
) STRICT`;

const selectAllMsgInfos =
`SELECT ${tab.colsSection('msgId', 'msgType', 'deliveryTS')}
FROM ${tab.name}`;

const selectMsgInfosFromTS =
`SELECT ${tab.colsSection('msgId', 'msgType', 'deliveryTS')}
FROM ${tab.name}
WHERE ${tab.c['deliveryTS']}>$fromTS`;

function listMsgInfos(db: Database, fromTS: number|undefined): MsgInfo[] {
	let result: QueryExecResult[];
	if (fromTS) {
		result = db.exec(selectMsgInfosFromTS, { '$fromTS': fromTS });
	} else {
		result = db.exec(selectAllMsgInfos);
	}
	return tab.fromQueryExecResult(result);
}

const deleteRec =
`DELETE FROM ${tab.name}
WHERE ${tab.colsEqualSection('msgId')}`;

function deleteMsgFrom(db: Database, msgId: string): void {
	db.exec(deleteRec, tab.toParams({ msgId }));
}

const selectMsgDeliveryTS =
`SELECT ${tab.colsSection('deliveryTS')}
FROM ${tab.name}
WHERE ${tab.colsEqualSection('msgId')}`;

function findMsgAndGetDeliveryTS(
	db: Database, msgId: string
): number|undefined {
	const result = db.exec(selectMsgDeliveryTS, tab.toParams({ msgId }));
	const values = tab.fromQueryExecResult<MsgRecord>(result);
	return ((values.length > 0) ? values[0].deliveryTS : undefined);
}

const selectMsgKey =
`SELECT ${tab.colsSection('key', 'keyStatus', 'mainObjHeaderOfs')}
FROM ${tab.name}
WHERE ${tab.colsEqualSection('msgId')}`;

function findMsgKey(db: Database, msgId: string): MsgKey|undefined {
	const result = db.exec(selectMsgKey, tab.toParams({ msgId }));
	if (result.length > 0) {
		const {
			key: msgKey, keyStatus: msgKeyRole, mainObjHeaderOfs
		} = tab.fromQueryExecResult<MsgRecord>(result)[0];
		return { msgKey, msgKeyRole, mainObjHeaderOfs };
	} else {
		return;
	}
}

const selectMsgPresence =
`SELECT ${tab.colsSection('msgId')}
FROM ${tab.name}
WHERE ${tab.colsEqualSection('msgId')}`;

function isMsgPresent(db: Database, msgId: string): boolean {
	const result = db.exec(selectMsgPresence, tab.toParams({ msgId }));
	return (result.length > 0);
}

const LIMIT_RECORDS_PER_FILE = 200;

interface DBsFiles {
	getDBFile(fileTS: number): Promise<WritableFile>;
}


class RecordsInSQL {

	private readonly older = makeTimedCache<number, SQLiteOn3NStorage>(
		10*60*1000
	);

	constructor(
		private readonly files: DBsFiles,
		private readonly latest: SQLiteOn3NStorage,
		private readonly fileTSs: number[]
	) {
		Object.seal(this);
	}

	async add(
		msgInfo: MsgInfo, decrInfo: MsgKeyInfo, removeAfter: number
	): Promise<void> {
		const { msgId, msgType, deliveryTS } = msgInfo;
		const { key, keyStatus, msgKeyPackLen: mainObjHeaderOfs } = decrInfo;
		const { db } = await this.getDbFor(msgInfo.deliveryTS);
		db.db.exec(tab.insertQuery, tab.toParams({
			msgId, msgType, deliveryTS,
			key, keyStatus,
			mainObjHeaderOfs, removeAfter
		}));
		await db.saveToFile();
	}

	async saveLatestWithAttr(): Promise<void> {
		// XXX

	}

	private async getDbFor(deliveryTS: number): Promise<{
		db: SQLiteOn3NStorage; fileTS?: number;
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

	private async dbFromCacheOrInit(fileTS: number): Promise<SQLiteOn3NStorage> {
		let db = this.older.get(fileTS);
		if (db) { return db; }
		const dbFile = await this.files.getDBFile(fileTS);
		db = await SQLiteOn3NStorage.makeAndStart(dbFile);
		this.older.set(fileTS, db);
		return db;
	}

	async remove(msgId: string): Promise<number|undefined> {
		for await (const { db, fileTS } of this.iterateDBs()) {
			const deliveryTS = findMsgAndGetDeliveryTS(db.db, msgId);
			if (deliveryTS) {
				deleteMsgFrom(db.db, msgId);
				await db.saveToFile();
				return deliveryTS;
			}
		}
		return undefined;
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

	private async getIndexWith(deliveryTS: number): Promise<SQLiteOn3NStorage> {
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
		return findMsgKey(db.db, msgId);
	}

	async msgExists({ msgId, deliveryTS }: MsgInfo): Promise<boolean> {
		const db = await this.getIndexWith(deliveryTS);
		return isMsgPresent(db.db, msgId);
	}

}
Object.freeze(RecordsInSQL.prototype);
Object.freeze(RecordsInSQL);


const DB_EXT = '.sqlite';
const LATEST_DB = `latest${DB_EXT}`;

function dbFileName(fileTS: number|undefined): string {
	return (fileTS ? LATEST_DB : `${fileTS}${DB_EXT}`);
}


class SqliteFiles implements DBsFiles {

	private syncing: Unsubscribable|undefined = undefined;

	private constructor(
		private readonly dbsFS: WritableFS
	) {
		Object.seal(this);
	}

	static async makeAndStart(syncedFS: WritableFS): Promise<{
		files: SqliteFiles; records: RecordsInSQL;
	}> {
		ensureCorrectFS(syncedFS, 'synced', true);
		const files = new SqliteFiles(syncedFS);
		const records = await files.makeRecords();
		files.startSyncing();
		return { files, records };
	}

	private async makeRecords(): Promise<RecordsInSQL> {
		const latest = await this.readOrInitializeLatestDB();
		const fileTSs = await this.fileTSsOfDBShards();
		return new RecordsInSQL(this, latest, fileTSs);
	}

	async getDBFile(fileTS: number): Promise<WritableFile> {
		return await this.dbsFS.writableFile(
			dbFileName(fileTS), { create: false }
		);
	}

	private async readOrInitializeLatestDB(): Promise<SQLiteOn3NStorage> {
		if (await this.dbsFS.checkFilePresence(LATEST_DB)) {
			const dbFile = await this.dbsFS.writableFile(
				LATEST_DB, { create: false }
			);
			return await SQLiteOn3NStorage.makeAndStart(dbFile);
		} else {
			const dbFile = await this.dbsFS.writableFile(
				LATEST_DB, { create: true, exclusive: true }
			);
			const latest = await SQLiteOn3NStorage.makeAndStart(dbFile);
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

		this.syncing = db$
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
Object.freeze(SqliteFiles.prototype);
Object.freeze(SqliteFiles);


class SqliteBasedIndexedRecords implements IndexedRecords {

	private constructor(
		private readonly files: SqliteFiles,
		private readonly records: RecordsInSQL
	) {
		Object.seal(this);
	}

	static async makeAndStart(
		syncedFS: WritableFS
	): Promise<SqliteBasedIndexedRecords> {
		const {
			files, records
		} = await SqliteFiles.makeAndStart(syncedFS);
		return new SqliteBasedIndexedRecords(files, records);
	}

	async add(
		msgInfo: MsgInfo, decrInfo: MsgKeyInfo, removeAfter: number
	): Promise<void> {
		await this.records.add(msgInfo, decrInfo, removeAfter);
	}

	remove(msgId: string): Promise<number|undefined> {
		return this.records.remove(msgId);
	}

	listMsgs(fromTS: number | undefined): Promise<MsgInfo[]> {
		return this.records.listMsgs(fromTS);
	}

	getKeyFor(msgId: string, deliveryTS: number): Promise<MsgKey|undefined> {
		return this.records.getKeyFor(msgId, deliveryTS);
	}

	async msgExists({ msgId, deliveryTS }: MsgInfo): Promise<boolean> {
		return !!(await this.records.getKeyFor(msgId, deliveryTS));
	}

	stopSyncing(): void {
		this.files.stopSyncing();
	}

}
Object.freeze(SqliteBasedIndexedRecords.prototype);
Object.freeze(SqliteBasedIndexedRecords);


export function makeSqliteBasedIndexedRecords(
	syncedFS: WritableFS
): Promise<IndexedRecords> {
	return SqliteBasedIndexedRecords.makeAndStart(syncedFS);
}


Object.freeze(exports);