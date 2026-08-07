/*
 Copyright (C) 2022 - 2023, 2026 3NSoft Inc.
 
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

import type { MsgKeyInfo } from '../../../keyring';
import { makeSqliteDBs } from './dataset/v1/sql-db';
import { makeRecentMsgIndexChangesLogs } from './dataset/v1/logs';
import type { LogError } from '../../../../lib-client/logging/log-to-file';
import { getOrMakeDirOnInit } from '../../../../lib-client/fs-utils/fs-sync-utils';
import { makeSyncedFunc } from '../../../../lib-common/processes/synced';
import { startDatasetSync } from '../../../../lib-common/dataset-sync/per-device-json-array-logs';

type WritableFS = web3n.files.WritableFS;
type MsgInfo = web3n.asmail.MsgInfo;

const LOGS_DIR = 'logs';
const INDEX_DIR = 'index';

const NUM_OF_ENTRIES_TO_CHOP_DB = 200;

/**
 * This message index stores info for messages present on the server, in the inbox.
 * Records contain message key info, time of delivery, and time of desired removal.
 */
export type MsgIndex = Awaited<ReturnType<typeof makeMsgIndex>>;

export async function makeMsgIndex(syncedFS: WritableFS, localFS: WritableFS, logError: LogError) {

	// file systems within dataset
	const logsFS = await getOrMakeDirOnInit(syncedFS, LOGS_DIR);
	const localLogsFS = await localFS.writableSubRoot(LOGS_DIR);
	const indexFS = await getOrMakeDirOnInit(syncedFS, INDEX_DIR);

	const logs = await makeRecentMsgIndexChangesLogs(logsFS, localLogsFS, logError);
	const indexed = await makeSqliteDBs(indexFS);

	async function add(msgInfo: MsgInfo, decrInfo: MsgKeyInfo): Promise<void> {
		const shouldAddToLog = await indexed.addToLatest(msgInfo, decrInfo);
		if (shouldAddToLog) {
			await logs.recordMsgAddition(msgInfo, decrInfo);
		}
	}

	async function remove(msgId: string): Promise<void> {
		const deliveryTS = await indexed.remove(msgId);
		if (deliveryTS) {
			await logs.recordMsgRemoval(msgId, deliveryTS);
		}
	}

	async function periodicCheckAndUploadOfData() {
		const shardTS = Date.now() - 10*60*1000;
		const countBefore = indexed.numberOfRecordsInLatestBefore(shardTS);
		if (countBefore >= NUM_OF_ENTRIES_TO_CHOP_DB) {
			const syncedIndexDbVersion = await indexed.makeNewShardWithRecordsUpToTS(shardTS);
			await logs.cutLogOnDatasetSyncAndUpload(syncedIndexDbVersion, { shardTS });
		}
	}

	function millisBeforeNextRun() {
		return 30*60*1000 + Math.floor(10*60*1000 * Math.random());
	}

	const { stopSyncing, changeProc } = startDatasetSync(
		periodicCheckAndUploadOfData, millisBeforeNextRun,
		{
			watchAndApplyOpsFromOtherDevices: logs.watchAndApplyOpsFromOtherDevices
		},
		{
			absorbOpsFromOtherDevices: indexed.absorbOpsFromOtherDevices,
			watchAndApplyOpsFromOtherDevices: indexed.watchAndApplyOpsFromOtherDevices
		}

	);

	// XXX
	//  - check if indexed latest is too old, chopping to the latest shard

	return {
		add: makeSyncedFunc(changeProc, undefined, add),
		remove: makeSyncedFunc(changeProc, undefined, remove),
		listMsgs: makeSyncedFunc(changeProc, undefined, indexed.listMsgs),
		getKeyFor: makeSyncedFunc(changeProc, undefined, indexed.getKeyFor),
		stopSyncing
	};
}


Object.freeze(exports);