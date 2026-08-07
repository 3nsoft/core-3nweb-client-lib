/*
 Copyright (C) 2016 - 2020, 2023, 2026 3NSoft Inc.
 
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

import { SingleProc } from '../../../../../../lib-common/processes/synced';
import { MsgKeyInfo, MsgKeyRole } from '../../../../../keyring';
import { base64 } from '../../../../../../lib-common/buffer-utils';
import { LogError } from '../../../../../../lib-client/logging/log-to-file';
import { makeRecentChangesLogs } from '../../../../../../lib-common/dataset-sync/per-device-json-array-logs';

type WritableFS = web3n.files.WritableFS;
type MsgInfo = web3n.asmail.MsgInfo;

interface MsgOpenedLog {
	eventType: 'msg-opened';
	eventTS: number;
	msgId: string;
	msgType: string;
	deliveryTS: number;
	keyB64: string;
	keyStatus: MsgKeyRole;
	mainObjHeaderOfs: number;
}
interface MsgRemovedLog {
	eventType: 'msg-removed';
	eventTS: number;
	msgId: string;
	deliveryTS: number;
}

export type MsgOp = MsgOpenedLog | MsgRemovedLog;

export function msgOpenedEventToRecordParams(op: MsgOpenedLog): {
	msgInfo: MsgInfo; decrInfo: MsgKeyInfo;
} {
	const { msgType, msgId, deliveryTS, keyB64, keyStatus, mainObjHeaderOfs } = op;
	return {
		msgInfo: {
			msgId, msgType, deliveryTS
		},
		decrInfo: {
			correspondent: '',
			keyStatus,
			msgKeyPackLen: mainObjHeaderOfs,
			key: base64.open(keyB64)
		}
	};
}

function areOpsEqual(a: MsgOp, b: MsgOp): boolean {
	return ((a.eventType === b.eventType) && (a.msgId === b.msgId) && (a.deliveryTS === b.deliveryTS));
}


export async function makeRecentMsgIndexChangesLogs(
	logsFS: WritableFS, localLogsFS: WritableFS, logError: LogError
) {

	const {
		appendLogsAndUpload, cutLogOnDatasetSyncAndUpload, watchAndApplyOpsFromOtherDevices
	} = await makeRecentChangesLogs<MsgOp>(logsFS, localLogsFS, areOpsEqual, logError);

	function recordMsgAddition(msgInfo: MsgInfo, decrInfo: MsgKeyInfo): Promise<void> {
		if (!decrInfo.key) {
			throw new Error(`Given message decryption info doesn't have a key for message ${msgInfo.msgId}`);
		}
		return appendLogsAndUpload({
			eventType: 'msg-opened',
			eventTS: Date.now(),
			msgType: msgInfo.msgType,
			msgId: msgInfo.msgId,
			deliveryTS: msgInfo.deliveryTS,
			keyB64: base64.pack(decrInfo.key),
			keyStatus: decrInfo.keyStatus,
			mainObjHeaderOfs: decrInfo.msgKeyPackLen,
		})!;
	}

	function recordMsgRemoval(msgId: string, deliveryTS: number): Promise<void> {
		return appendLogsAndUpload({
			eventType: 'msg-removed',
			eventTS: Date.now(),
			msgId,
			deliveryTS
		})!;
	}

	return {
		recordMsgAddition,
		recordMsgRemoval,
		watchAndApplyOpsFromOtherDevices,
		cutLogOnDatasetSyncAndUpload
	};
}


Object.freeze(exports);