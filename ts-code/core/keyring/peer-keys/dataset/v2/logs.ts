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

import { LogError } from "../../../../../lib-client/logging/log-to-file";
import { base64 } from "../../../../../lib-common/buffer-utils";
import { makeRecentChangesLogs } from "../../../../../lib-common/dataset-sync/per-device-json-array-logs";
import { SingleProc } from "../../../../../lib-common/processes/synced";
import { SuggestedNextKeyPair } from "../../../../asmail/msg/common";
import { RecipientKeyPairDbEntry, SendingKeyPairDbEntry } from "./peer-keys-db";

type WritableFS = web3n.files.WritableFS;

export interface PairFromPeerLog {
	opType: 'pair-from-peer';
	eventTS: number;
	sendingPairRecord: Omit<SendingKeyPairDbEntry, 'msgMasterKey' | 'senderSKey' | 'peerPKey'> & {
		msgMasterKey: string;
		senderSKey: string;
		peerPKey: string;
	};
	peerAddr: string;
}
export interface PairSuggestedToPeerLog {
	opType: 'pair-suggested-to-peer';
	eventTS: number;
	receivingPairRecord: Omit<RecipientKeyPairDbEntry, 'msgMasterKey' | 'recipientSKey' | 'peerPKey'> & {
		msgMasterKey: string;
		recipientSKey: string;
		peerPKey: string;
	};
	peerAddr: string;
}
export interface PeerStartedUsingPair {
	opType: 'peer-started-using-pair';
	eventTS: number;
	peerCAddr: string;
	peerKId: string;
	recipientKId: string;
}
export type PairEvent = PairFromPeerLog | PairSuggestedToPeerLog | PeerStartedUsingPair;

export function sendingPairEntryFromJSON(json: PairFromPeerLog['sendingPairRecord']): SendingKeyPairDbEntry {
	return {
		...json,
		msgMasterKey: base64.open(json.msgMasterKey),
		senderSKey: base64.open(json.senderSKey),
		peerPKey: base64.open(json.peerPKey),
	};
}

function sendingPairEntryToJSON(entry: SendingKeyPairDbEntry): PairFromPeerLog['sendingPairRecord'] {
	return {
		...entry,
		msgMasterKey: base64.pack(entry.msgMasterKey),
		senderSKey: base64.pack(entry.senderSKey),
		peerPKey: base64.pack(entry.peerPKey),
	};
}

export function recipientPairEntryFromJSON(
	json: PairSuggestedToPeerLog['receivingPairRecord']
): RecipientKeyPairDbEntry {
	return {
		...json,
		msgMasterKey: base64.open(json.msgMasterKey),
		recipientSKey: base64.open(json.recipientSKey),
		peerPKey: base64.open(json.peerPKey),
	};
}

function recipientPairEntryToJSON(
	entry: RecipientKeyPairDbEntry
): PairSuggestedToPeerLog['receivingPairRecord'] {
	return {
		...entry,
		msgMasterKey: base64.pack(entry.msgMasterKey),
		recipientSKey: base64.pack(entry.recipientSKey),
		peerPKey: base64.pack(entry.peerPKey),
	};
}

function areEventsEqual(a: PairEvent, b: PairEvent): boolean {
	if (b.opType !== a.opType) {
		return false;
	}
	if (a.opType === 'pair-from-peer') {
		const aSP = a.sendingPairRecord;
		const { peerCAddr, peerKId, senderKId } = (b as PairFromPeerLog).sendingPairRecord;
		if ((aSP.peerCAddr === peerCAddr) && (aSP.peerKId === peerKId) && (aSP.senderKId === senderKId)) {
			return true;
		}
	} else if (a.opType === 'pair-suggested-to-peer') {
		const aRP = a.receivingPairRecord;
		const { receivingPairRecord: { peerCAddr, peerKId, recipientKId } } = b as PairSuggestedToPeerLog;
		if ((aRP.peerCAddr === peerCAddr) && (aRP.peerKId === peerKId) && (aRP.recipientKId === recipientKId)) {
			return true;
		}
	} else if (a.opType === 'peer-started-using-pair') {
		const { peerCAddr, peerKId, recipientKId } = b as PeerStartedUsingPair;
		if ((a.peerCAddr === peerCAddr) && (a.peerKId === peerKId) && (a.recipientKId === recipientKId)) {
			return true;
		}
	}
	return false;
}

export async function makePeerKeysChangeLogs(logsFS: WritableFS, localLogsFS: WritableFS, logError: LogError) {

	const {
		appendLogsAndUpload, watchAndApplyOpsFromOtherDevices, cutLogOnDatasetSyncAndUpload, numOfLogs
	} = await makeRecentChangesLogs<PairEvent>(logsFS, localLogsFS, areEventsEqual, logError);

	async function recordSuggestingCryptoToPeer(receivingPair: RecipientKeyPairDbEntry, peerAddr: string) {
		await appendLogsAndUpload({
			opType: 'pair-suggested-to-peer',
			eventTS: Date.now(),
			receivingPairRecord: recipientPairEntryToJSON(receivingPair),
			peerAddr
		});
	}

	async function recordPeerStartedUsingPair(peerCAddr: string, peerKId: string, recipientKId: string) {
		await appendLogsAndUpload({
			opType: 'peer-started-using-pair',
			eventTS: Date.now(),
			peerCAddr, peerKId, recipientKId
		});
	}

	async function recordGettingCryptoFromPeer(sendingPair: SendingKeyPairDbEntry, peerAddr: string) {
		await appendLogsAndUpload({
			opType: 'pair-from-peer',
			eventTS: Date.now(),
			sendingPairRecord: sendingPairEntryToJSON(sendingPair),
			peerAddr
		});
	}

	return {
		recordSuggestingCryptoToPeer,
		recordPeerStartedUsingPair,
		recordGettingCryptoFromPeer,
		numOfLogs,
		cutLogOnDatasetSyncAndUpload,
		watchAndApplyOpsFromOtherDevices
	};
}


Object.freeze(exports);