/*
 Copyright (C) 2022 - 2023, 2025 - 2026 3NSoft Inc.
 
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

import { MsgKeyInfo, MsgKeyRole } from '../../../../../keyring';
import { makeTimedCache } from "../../../../../../lib-common/timed-cache";
import { SQLiteOn3NStorage, SQLiteOnSyncedFS } from '../../../../../../lib-sqlite-on-3nstorage';
import { Database, ParamsObject, QueryExecResult } from '../../../../../../lib-sqlite-on-3nstorage/sqljs';
import { MsgOp, msgOpenedEventToRecordParams } from './logs';
import { andEqualExprFor, forTableInsert, fromQueryResult, queryParamsFrom, TransformDefinition } from '../../../../../../lib-sqlite-on-3nstorage/for-sqlite';
import { getAllRecordsFromVersionNone } from '../v0/sql-db-v-none';
import { SingleProc } from '../../../../../../lib-common/processes/synced';
import { LogEntry } from '../../../../../../lib-common/dataset-sync/per-device-json-array-logs';

type WritableFS = web3n.files.WritableFS;
type WritableFile = web3n.files.WritableFile;
type MsgInfo = web3n.asmail.MsgInfo;

interface MsgIndexEntry extends MsgInfo {
	key: Uint8Array;
	keyStatus: MsgKeyRole;
	mainObjHeaderOfs: number;
}

const queryToCreateMsgsIndexDbV1 = [
	`--sql
	CREATE TABLE inbox_index (
		msgId TEXT PRIMARY KEY,
		msgType TEXT,
		deliveryTS INTEGER,
		key BLOB,
		keyStatus TEXT,
		mainObjHeaderOfs INTEGER,
		removeAfter INTEGER DEFAULT 0
	) STRICT
	`,
  `--sql
    CREATE INDEX IF NOT EXISTS delivery_ts ON inbox_index (
      deliveryTS ASC
    )
  `,
].join(';\n');

const msgsIndexFields: TransformDefinition<MsgIndexEntry> = {
	msgId: 'as-is',
	msgType: 'as-is',
	deliveryTS: 'as-is',
	key: 'as-is',
	keyStatus: 'as-is',
	mainObjHeaderOfs: 'as-is'
};

function msgWhereParamsFor(msgId: string): {
  whereMsgParams: ParamsObject;
  whereMsg: string;
} {
  const whereMsgParams = queryParamsFrom<Pick<MsgIndexEntry, 'msgId'>>(
    {
      msgId
    },
    msgsIndexFields,
  );
  const whereMsg = andEqualExprFor(whereMsgParams);
  return { whereMsgParams, whereMsg };
}

function listMsgInfos(db: Database, fromTS: number|undefined): MsgInfo[] {
	let result: QueryExecResult[];
	if (fromTS) {
		result = db.exec(`--sql
			SELECT msgId, msgType, deliveryTS FROM inbox_index
			WHERE deliveryTS > $fromTS`,
			{ '$fromTS': fromTS }
		);
	} else {
		result = db.exec(
			`--sql
			SELECT msgId, msgType, deliveryTS FROM inbox_index`
		);
	}
	return ((result.length > 0) ? fromQueryResult(result[0], msgsIndexFields) : []);
}

function deleteMsgFrom(db: Database, msgId: string): boolean {
	const { whereMsg, whereMsgParams } = msgWhereParamsFor(msgId);
	db.exec(`--sql
		DELETE FROM inbox_index WHERE ${whereMsg}`,
		whereMsgParams
	);
	return (db.getRowsModified() > 0);
}

function deleteAllMsgsAfterTS(db: Database, ts: number): void {
	db.exec(
		`--sql
		DELETE FROM inbox_index WHERE deliveryTS > $ts
		`,
		{ '$ts': ts }
	);
}

function deleteAllMsgsUpToAndAtTS(db: Database, ts: number): void {
	db.exec(
		`--sql
		DELETE FROM inbox_index WHERE deliveryTS <= $ts
		`,
		{ '$ts': ts }
	);
}

function findMsgAndGetDeliveryTS(db: Database, msgId: string): number|undefined {
	const { whereMsg, whereMsgParams } = msgWhereParamsFor(msgId);
	const result = db.exec(
		`--sql
		SELECT deliveryTS FROM inbox_index WHERE ${whereMsg}`,
		whereMsgParams
	)[0];
	if (result) {
		const values = fromQueryResult(result, msgsIndexFields);
		return ((values.length > 0) ? values[0].deliveryTS : undefined);
	}
}

function countUpToTS(db: Database, tillTS: number): number {
	const result = db.exec(
		`--sql
		SELECT count() FROM inbox_index WHERE deliveryTS <= $tillTS`,
		{ '$tillTS': tillTS }
	);
	return result[0].values[0][0] as number;
}

export interface MsgKey {
	msgKey: Uint8Array;
	msgKeyRole: MsgKeyRole;
	mainObjHeaderOfs: number;
}

function findMsgKey(db: Database, msgId: string): MsgKey|undefined {
	const { whereMsg, whereMsgParams } = msgWhereParamsFor(msgId);
	const result = db.exec(
		`--sql
		SELECT key, keyStatus, mainObjHeaderOfs FROM inbox_index WHERE ${whereMsg}`,
		whereMsgParams
	);
	if (result.length > 0) {
		const {
			key: msgKey, keyStatus: msgKeyRole, mainObjHeaderOfs
		} = fromQueryResult(result[0], msgsIndexFields)[0];
		return { msgKey, msgKeyRole, mainObjHeaderOfs };
	} else {
		return;
	}
}

function isMsgPresent(db: Database, msgId: string): boolean {
	const { whereMsg, whereMsgParams } = msgWhereParamsFor(msgId);
	const result = db.exec(
		`--sql
		SELECT msgId FROM inbox_index WHERE ${whereMsg}`,
		whereMsgParams
	);
	return (result.length > 0);
}

async function readOrInitializeLatestDB(dbsFS: WritableFS): Promise<SQLiteOnSyncedFS> {
	if (await dbsFS.checkFilePresence(LATEST_DB)) {
		const dbFile = await dbsFS.writableFile(LATEST_DB, { create: false });
		return await readDbAndUpgradeVersionIfNeeded(dbFile);
	} else {
		const dbFile = await dbsFS.writableFile(LATEST_DB, { create: true, exclusive: true });
		const latest = await SQLiteOn3NStorage.makeSynced(dbFile);
		latest.db.run(queryToCreateMsgsIndexDbV1);
		await setMsgIndexInfoIntoAttrOf(latest.dbFile, {});
		await latest.saveToFile();
		await latest.dbFileSync.upload();
		await dbsFS.v!.sync!.upload('');
		return latest;
	}
}

function insertMsgEntryInto(db: Database, msgEntry: MsgIndexEntry): void {
	const { orderedColumns, orderedValues, insertParams } = forTableInsert(msgEntry, msgsIndexFields);
	db.run(
		`--sql
		INSERT INTO inbox_index (${orderedColumns}) VALUES (${orderedValues})`,
		insertParams
	);
}

async function readDbAndUpgradeVersionIfNeeded(dbFile: WritableFile): Promise<SQLiteOnSyncedFS> {
	const dbInfo = await dbFile.getXAttr(MSG_INDEX_DB_ATTR) as MsgIndexDbFileAttr|undefined;
	if (!dbInfo) {
		const preV1 = await SQLiteOn3NStorage.makeSynced(dbFile);
		const preV1Records = getAllRecordsFromVersionNone(preV1.db);
		const msgs: MsgIndexEntry[] = preV1Records.map(({
			msg_id, msg_type, delivery_ts, key_status, key, main_obj_header_ofs, remove_after
		}) => ({
			msgId: msg_id, msgType: msg_type, deliveryTS: delivery_ts,
			keyStatus: key_status as MsgKeyRole, key, mainObjHeaderOfs: main_obj_header_ofs
		}));
		const dbV1 = await SQLiteOn3NStorage.makeSynced(dbFile, false);
		dbV1.db.run(queryToCreateMsgsIndexDbV1);
		for (const msgEntry of msgs) {
			insertMsgEntryInto(dbV1.db, msgEntry);
		}
		await setMsgIndexInfoIntoAttrOf(dbV1.dbFile, {});
		await dbV1.saveToFile();
		return dbV1;
	} else if (dbInfo.dbVersion === 1) {
		return await SQLiteOn3NStorage.makeSynced(dbFile);
	} else {
		throw new Error(`Platform needs an upgrade: MsgIndex db file has unknown version ${dbInfo.dbVersion}`);
	}
}

async function fileTSsOfDBShards(dbsFS: WritableFS): Promise<number[]> {
	const lst = await dbsFS.listFolder('');
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

const DB_EXT = '.sqlite';
const LATEST_DB = `latest${DB_EXT}`;
const MSG_INDEX_DB_ATTR = `msg-index-db`;

interface MsgIndexDbFileAttr {
	dbVersion: 1;
	shardTS?: number;
	prevShardTS?: number;
}

async function setMsgIndexInfoIntoAttrOf(
	dbFile: WritableFile, info: Omit<MsgIndexDbFileAttr, 'dbVersion'>
): Promise<void> {
	const completeInfo: MsgIndexDbFileAttr = {
		dbVersion: 1,
		...info
	};
	await dbFile.updateXAttrs({
		set: { [MSG_INDEX_DB_ATTR]: completeInfo }
	});
}

function dbFileName(shardTS: number|undefined): string {
	return (shardTS ? LATEST_DB : `${shardTS}${DB_EXT}`);
}

function shardTSFromFileName(fName: string): number|undefined {
	if (fName.endsWith(DB_EXT)) {
		const shardTS = parseInt(fName.slice(0, fName.length - DB_EXT.length));
		return ((isNaN(shardTS) || (fName !== dbFileName(shardTS))) ? undefined : shardTS);
	} else {
		return;
	}
}

export async function makeSqliteDBs(dbsFS: WritableFS) {

	const shardsCache = makeTimedCache<number, SQLiteOnSyncedFS>(10*60*1000);

	const latest = await readOrInitializeLatestDB(dbsFS);
	const fileTSs = await fileTSsOfDBShards(dbsFS);

	async function getDBFile(fileTS: number): Promise<WritableFile> {
		return await dbsFS.writableFile(dbFileName(fileTS), { create: false });
	}

	function numberOfRecordsInLatestBefore(ts: number): number {
		return countUpToTS(latest.db, ts);
	}

	/**
	 * This return true when msg should be added to log, and false otherwise.
	 * @param msgInfo 
	 * @param decrInfo 
	 * @param removeAfter 
	 */
	async function addToLatest(msgInfo: MsgInfo, decrInfo: MsgKeyInfo): Promise<boolean> {
		if (!isForLatestDb(msgInfo.deliveryTS)) {
			return false;
		}
		const recordAdded = addMsgRecordToLatest(msgInfo, decrInfo);
		if (recordAdded) {
			await latest.saveToFile();
		}
		return recordAdded;
	}

	function addMsgRecordToLatest(msgInfo: MsgInfo, decrInfo: MsgKeyInfo): boolean {
		const { msgId, msgType, deliveryTS } = msgInfo;
		const { db } = latest;
		if (isMsgPresent(db, msgId)) {
			return false;
		}
		const { key, keyStatus, msgKeyPackLen: mainObjHeaderOfs } = decrInfo;
		insertMsgEntryInto(db, {
			msgId, msgType, deliveryTS, key: key!, keyStatus, mainObjHeaderOfs
		})
		return true;
	}

	function isForLatestDb(deliveryTS: number): boolean {
		return ((fileTSs.length === 0) || (fileTSs[fileTSs.length-1] < deliveryTS));
	}

	async function dbShardFromCacheOrFS(fileTS: number): Promise<SQLiteOnSyncedFS> {
		let db = shardsCache.get(fileTS);
		if (db) { return db; }
		const dbFile = await getDBFile(fileTS);
		db = await SQLiteOn3NStorage.makeSynced(dbFile);
		shardsCache.set(fileTS, db);
		return db;
	}

	async function remove(msgId: string): Promise<number|undefined> {
		for await (const { db, fileTS } of iterateDBsFromLatestToOldest()) {
			const deliveryTS = findMsgAndGetDeliveryTS(db.db, msgId);
			if (deliveryTS) {
				deleteMsgFrom(db.db, msgId);
				await db.saveToFile();
				return deliveryTS;
			}
		}
		return undefined;
	}

	async function* iterateDBsFromLatestToOldest() {
		yield { db: latest };
		for (let i=(fileTSs.length-1); i>=0; i=-1) {
			const fileTS = fileTSs[i];
			if (!fileTS) { continue; }
			const db = await dbShardFromCacheOrFS(fileTS);
			if (db) {
				yield { db, fileTS };
			}
		}
	}

	async function listMsgs(fromTS: number|undefined): Promise<MsgInfo[]> {
		let lst = listMsgInfos(latest.db, fromTS);
		for (let i=(fileTSs.length-1); i>=0; i-=1) {
			const fileTS = fileTSs[i];
			if (fromTS && (fileTS <= fromTS)) { break; }
			const older = await dbShardFromCacheOrFS(fileTS);
			lst = listMsgInfos(older.db, fromTS).concat(lst);
		}
		lst.sort((a, b) => (a.deliveryTS - b.deliveryTS));
		return lst;
	}

	async function getIndexWith(deliveryTS: number): Promise<SQLiteOnSyncedFS> {
		let fileTS: number|undefined = undefined;
		for (let i=(fileTSs.length-1); i>=0; i-=1) {
			const fTS = fileTSs[i];
			if (fTS < deliveryTS) { break; }
			fileTS = fTS;
		}
		if (fileTS) {
			return await dbShardFromCacheOrFS(fileTS);
		} else {
			return latest;
		}
	}

	async function getKeyFor(msgId: string, deliveryTS: number): Promise<MsgKey|undefined> {
		const db = await getIndexWith(deliveryTS);
		return findMsgKey(db.db, msgId);
	}

	async function msgExists({ msgId, deliveryTS }: MsgInfo): Promise<boolean> {
		const db = await getIndexWith(deliveryTS);
		return isMsgPresent(db.db, msgId);
	}

	// XXX at a startup we should check if current local latest is too old

	// XXX one should watch for reconnect event and run similar checks of possibly missed events

	function watchAndApplyOpsFromOtherDevices(changeProc: SingleProc, resetSyncInterval: () => void): () => void {
		return dbsFS.watchTree('.', 1, {
			next: fsEvent => changeProc.startOrChain(async () => {
				if (fsEvent.type === 'remote-change') {
					if (fsEvent.path === '.') {
						doWhenDBsFolderChangedOnRemote();
					} else if (fsEvent.path === LATEST_DB) {

						// XXX latest db shard file has been cut
						//  - remove stuff from latest and from log
						const { state, remote } = await latest.dbFileSync.status();
						if (state === 'behind') {
							await latest.dbFileSync.adoptRemote();
						} else if (state === 'conflicting') {
							const remoteAttr = await latest.dbFile.v!.getXAttr(
								MSG_INDEX_DB_ATTR, { remoteVersion: remote?.latest }
							);


						}
					} else {

						// XXX old db shard file has changed.
						//   -> file should adopt remote state, and may be trigger download


					}
				} else if ((fsEvent.type === 'entry-addition') && (fsEvent.src === 'sync') && fsEvent.entry.isFile) {
					resetSyncInterval();
					await doWhenShardWasAddedFromRemote(fsEvent.entry.name);
				} else if ((fsEvent.type === 'entry-removal') && (fsEvent.src === 'sync') && fsEvent.name) {
					doWhenShardWasRemovedFromRemote(fsEvent.name);
				}
			})
		});
	}

	async function doWhenDBsFolderChangedOnRemote(): Promise<void> {
		const { state } = await dbsFS.v!.sync!.status('.');
		if (state === 'behind') {
			await dbsFS.v!.sync!.adoptRemote('.');
		} else if (state === 'conflicting') {
			await dbsFS.v!.sync!.absorbRemoteFolderChanges('.');
			await dbsFS.v!.sync!.upload('.');
		}
	}

	async function doWhenShardWasAddedFromRemote(shardFName: string): Promise<void> {
		const shardTS = shardTSFromFileName(shardFName);
		if (!shardTS) {
			return;
		}
		for (let i=fileTSs.length; i>=0; i-1) {
			const ts = fileTSs[i]
			if (ts < shardTS) {
				fileTSs.slice(i+1, shardTS);
				break;
			} else if (ts === shardTS) {
				return;
			}
		}
		const stats = await dbsFS.stat(shardFName);
		await dbsFS.v!.sync!.startDownload(shardFName, stats.version!);
	}

	async function doWhenShardWasRemovedFromRemote(shardFName: string): Promise<void> {
		const shardTS = shardTSFromFileName(shardFName);
		if (!shardTS) {
			return;
		}
		const tsInd = fileTSs.indexOf(shardTS);
		if (tsInd < 0) {
			return;
		}
		fileTSs.splice(tsInd, 1);
		shardsCache.delete(shardTS);
	}

	async function latestDbHasNewRemoteVersion(): Promise<boolean> {
		const { state } = await latest.dbFile.v!.sync!.status();
		return ((state === 'behind') || (state === 'conflicting'));
	}

	async function absorbOpsFromOtherDevices(
		changeProc: SingleProc, ops: LogEntry<MsgOp>[]
	): Promise<void> {
		await changeProc.startOrChain(async () => {
			let dbsToSave = new Set<SQLiteOnSyncedFS>();
			for (const op of ops) {
				if (op.p) {
					if (isForLatestDb(op.p.deliveryTS)) {
						if (op.p.eventType === 'msg-opened') {
							const { msgInfo, decrInfo } = msgOpenedEventToRecordParams(op.p);
							const addedMsg = addMsgRecordToLatest(msgInfo, decrInfo);
							if (addedMsg) {
								dbsToSave.add(latest);
							}
						} else if (op.p.eventType === 'msg-removed') {
							const removedMsg = deleteMsgFrom(latest.db, op.p.msgId);
							if (removedMsg) {
								dbsToSave.add(latest);
							}
						}
					} else if (op.p.eventType === 'msg-removed') {
						const shard = await getIndexWith(op.p.deliveryTS);
						const removedMsg = deleteMsgFrom(shard.db, op.p.msgId);
						if (removedMsg) {
							dbsToSave.add(shard);
						}
					}
				} else if (op.syncPoint) {
					// XXX
					//  - 

				}
			}
			for (const db of dbsToSave) {
				await db.saveToFile();
			}
		});
	}

	async function makeNewShardWithRecordsUpToTS(shardTS: number): Promise<number> {
		// make and upload shard
		const shardFile = await dbsFS.writableFile(dbFileName(shardTS), { create: true, exclusive: true });
		const shard = await latest.makeCopyIn(shardFile) as SQLiteOnSyncedFS;
		deleteAllMsgsAfterTS(shard.db, shardTS);
		await shard.saveToFile();
		await setMsgIndexInfoIntoAttrOf(shard.dbFile, {
			shardTS,
			prevShardTS: ((fileTSs.length > 0) ? fileTSs[fileTSs.length-1] : undefined)
		});
		await shard.dbFileSync.upload();
		await dbsFS.v!.sync!.upload('');
		// cut and upload latest
		deleteAllMsgsUpToAndAtTS(latest.db, shardTS);
		fileTSs.push(shardTS);
		await setMsgIndexInfoIntoAttrOf(latest.dbFile, { prevShardTS: shardTS });
		const syncedIndexDbVersion = await latest.dbFileSync.upload();
		return syncedIndexDbVersion!;
	}

	async function syncPastShards(): Promise<void> {

		// XXX only removals are done on older shards, so conflicts should be easy to process
		//  - check sync status of shard file without instantiating dbs.
		//  - push unsynced
		//  - adopt and download a thing that is behind
		//  - 



	}

	return {
		absorbOpsFromOtherDevices,
		addToLatest,
		getDBFile,
		getKeyFor,
		isForLatestDb,
		latestDbHasNewRemoteVersion,
		listMsgs,
		msgExists,
		makeNewShardWithRecordsUpToTS,
		syncPastShards,
		numberOfRecordsInLatestBefore,
		remove,
		watchAndApplyOpsFromOtherDevices
	};
}


Object.freeze(exports);