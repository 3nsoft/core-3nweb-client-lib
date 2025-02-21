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
import { IndexedRecords, MsgLogs, makeJsonBasedIndexedRecords } from './logs-n-entries';

type WritableFS = web3n.files.WritableFS;
type MsgInfo = web3n.asmail.MsgInfo;

const LOGS_DIR = 'logs';
const INDEX_DIR = 'index';

async function getOrMakeDirStructure(syncedFS: WritableFS): Promise<{
	logsFS: WritableFS; indexFS: WritableFS;
}> {
	const logsFS = await syncedFS.writableSubRoot(LOGS_DIR);
	const indexFS = await syncedFS.writableSubRoot(INDEX_DIR);
	return { logsFS, indexFS };
}

async function syncDirStructureIfNeeded(syncedFS: WritableFS): Promise<void> {

	// XXX need uploading of initial folders, and of syncedFS itself
	// const logsDirInfo = await logsFS.v!.sync!.status(LOGS_DIR);
	// logsDirInfo.state


	// Or, is this enough?
	// await getRemoteFolderChanges(syncedFS);
	// await uploadFolderChangesIfAny(syncedFS);

}


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
		private readonly logs: MsgLogs,
		private readonly indexed: IndexedRecords
	) {
		Object.seal(this);
	}

	static async make(syncedFS: WritableFS): Promise<MsgIndex> {
		const { logsFS, indexFS } = await getOrMakeDirStructure(syncedFS);
		await syncDirStructureIfNeeded(syncedFS);
		const logs = await MsgLogs.makeAndStartSyncing(logsFS);
		let indexed: IndexedRecords;
		if (global.WebAssembly) {
			indexed = await require('./sql-indexing').makeSqliteBasedIndexedRecords(indexFS);
		} else {
			indexed = makeJsonBasedIndexedRecords(logs);
		}
		const index = new MsgIndex(logs, indexed);
		return index;
	}

	stopSyncing(): void {
		this.logs.stopSyncing();
		this.indexed.stopSyncing();
	}

	async add(
		msgInfo: MsgInfo, decrInfo: MsgKeyInfo, removeAfter = 0
	): Promise<void> {
		const msgAlreadyExists = await this.indexed.msgExists(msgInfo);
		if (msgAlreadyExists) { return; }
		await this.logs.add(msgInfo, decrInfo, removeAfter);
		await this.indexed.add(msgInfo, decrInfo, removeAfter);
	}

	async remove(msgId: string): Promise<void> {
		const deliveryTS = await this.indexed.remove(msgId);
		if (deliveryTS) {
			await this.logs.remove(msgId, deliveryTS);
		}
	}

	listMsgs(fromTS: number|undefined): Promise<MsgInfo[]> {
		return this.indexed.listMsgs(fromTS);
	}

	getKeyFor(msgId: string, deliveryTS: number): Promise<{
		msgKey: Uint8Array; msgKeyRole: MsgKeyRole; mainObjHeaderOfs: number;
	}|undefined> {
		return this.indexed.getKeyFor(msgId, deliveryTS);
	}

}
Object.freeze(MsgIndex.prototype);
Object.freeze(MsgIndex);


Object.freeze(exports);