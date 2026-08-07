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

import { base64 } from '../../../../../lib-common/buffer-utils';
import type { JWKeyPair } from '../../../common';
import type { RecipientKeyPairDbEntry, SendingKeyPairDbEntry } from '../v2/peer-keys-db';
import { secret_box as sbox } from 'ecma-nacl';

type JsonKey = web3n.keys.JsonKey;
type JsonKeyShort = web3n.keys.JsonKeyShort;
type WritableFS = web3n.files.WritableFS;

export interface ReceptionPair {
	pids: string[];
	recipientKey: JWKeyPair;
	isSenderIntroKey?: boolean,
	senderPKey: JsonKeyShort;
	msgMasterKey: string;
	receivedMsgs?: {
		counts: number[][];
		lastTS: number;
	};
	timestamp: number;
}

/**
 * Introductory pair appears when the first message is sent to a new
 * correspondent. By nature it is an introductory message that uses recipient's
 * published introductory key. Hence, recipient's key material in this pair
 * comes from recipient's publishing.
 * 
 * Structurally, introductory pair is just a sending pair with an addition of
 * a flag that allows to distinguish it from ratcheted pair with a clean
 * if-statement.
 */
export interface IntroductorySendingPair {
	type: 'intro';

	/**
	 * This is recipients' public key, to which encryption is done.
	 * If this is an introductory pair, this key is recipient's published intro
	 * public key.
	 * Else, if this is an ratcheted pair, this key comes from crypto material
	 * that recipients suggests from time to time for further use.
	 */
	recipientPKey: JsonKey;
}

/**
 * Ratcheted sending pair is a sending pair with pair ids (pids), attached to
 * it. These ids are used to identify correct key material.
 */
export interface RatchetedSendingPair {
	type: 'ratcheted';
	pids: string[];
	timestamp: number;

	/**
	 * This is sender's secret-public key pair, to which encryption is done.
	 * This sending side always generates this key.
	 * Key material of an introductory key is used right away.
	 * Key material of a ratcheted pair is first suggested to the other side,
	 * and is moved to the sending pair when it is used by the other side.
	 */
	senderKey: JWKeyPair;

	/**
	 * This is recipients' public key, to which encryption is done.
	 * If this is an introductory pair, this key is recipient's published intro
	 * public key.
	 * Else, if this is an ratcheted pair, this key comes from crypto material
	 * that recipients suggests from time to time for further use.
	 */
	recipientPKey: JsonKeyShort;

	/**
	 * This is a precomputed message master key that comes from a given pair.
	 * This exist only as a speedup measure, to save time of public key crypto
	 * calculation by using a bit of extra space.
	 */
	msgMasterKey: string;

	sentMsgs?: {
		count: number;
		lastTS: number;
	};
}

export type SendingPair = IntroductorySendingPair | RatchetedSendingPair;

interface RingJSON {
	// each string is json of PeerKeysJSON
	corrKeys: string[];
}

export interface V1PeerKeysJSON {
	
	/**
	 * This is correspondent's address.
	 */
	correspondent: string;
	
	/**
	 * Sending pair is used for sending messages to this recipient.
	 * It is set from suggestions that correspondent sends in her messages.
	 * When initiating an exchange, while this pair has not been set, it is
	 * generated, which is indicated by the flag.
	 */
	sendingPair: SendingPair|null;
	
	/**
	 * Reception key pairs are pairs which we suggest to this correspondent
	 * for sending messages to us.
	 * Suggested pair is the one that we have already suggested, or are
	 * suggesting now.
	 * When correspondent uses suggested pair, we move it to inUse, while
	 * previous inUse pair is moved to old.
	 */
	receptionPairs: {
		suggested: ReceptionPair|null;
		inUse: ReceptionPair|null;
		old: ReceptionPair|null;
	};
}

const VERSION_1_FOLDER_NAME = 'v1';
const KEYRING_FNAME = 'keyring.json';

export async function checkIfV1AndReadPeerKeys(krFS: WritableFS): Promise<V1PeerKeysJSON[]|undefined> {
	if (!(await krFS.checkFolderPresence(VERSION_1_FOLDER_NAME))) {
		return;
	}
	const peerKeys: V1PeerKeysJSON[] = [];
	const ringJSON = await krFS.readJSONFile<RingJSON>(`${VERSION_1_FOLDER_NAME}/${KEYRING_FNAME}`)
	.catch(noop);
	if (ringJSON) {
		for (const peerKeysStr of ringJSON.corrKeys) {
			try {
				peerKeys.push(JSON.parse(peerKeysStr));
			} catch (_err) {}
		}
	}
	return peerKeys;
}

export async function removeV1FolderIn(krFS: WritableFS): Promise<void> {
	await krFS.deleteFolder(VERSION_1_FOLDER_NAME, true).catch(noop);
}

function noop() {}

export function v1ReceptionPairToV2RecipientKeyPairDbEntry(
	pairV1: ReceptionPair, ratchetStage: RecipientKeyPairDbEntry['ratchetStage'], peerCAddr: string
): RecipientKeyPairDbEntry {
	const {
		pids, msgMasterKey, recipientKey, senderPKey, timestamp, isSenderIntroKey, receivedMsgs
	} = pairV1;
	return {
		ratchetStage,
		pids,
		msgMasterKey: base64.open(msgMasterKey),
		// at version 1 we only had NaCl' box shared key here
		msgMasterKeyAlg: sbox.JWK_ALG_NAME,
		pairAlg: recipientKey.pkey.alg,
		pairTS: timestamp,
		peerCAddr,
		peerKId: senderPKey.kid,
		peerPKey: base64.open(senderPKey.k),
		isPeerIntroKey: !!isSenderIntroKey,
		recipientKId: recipientKey.pkey.kid,
		recipientPKey: recipientKey.pkey.k,
		recipientSKey: base64.open(recipientKey.skey.k),
		receivedMsgLastTS: receivedMsgs?.lastTS,
		receivedMsgsCounts: receivedMsgs?.counts
	};
}

export function v1RatchetedSendingPairToV2SendingKeyPairDbEntry(
	pairV1: RatchetedSendingPair, peerCAddr: string
): SendingKeyPairDbEntry {
	const {
		pids, msgMasterKey, recipientPKey, senderKey, timestamp, sentMsgs, type
	} = pairV1;
	return {
		pids,
		msgMasterKey: base64.open(msgMasterKey),
		// at version 1 we only had NaCl' box shared key here
		msgMasterKeyAlg: sbox.JWK_ALG_NAME,
		pairAlg: senderKey.pkey.alg,
		pairTS: timestamp,
		peerCAddr,
		peerKId: recipientPKey.kid,
		peerPKey: base64.open(recipientPKey.k),
		senderKId: senderKey.pkey.kid,
		senderPKey: senderKey.pkey.k,
		senderSKey: base64.open(senderKey.skey.k),
		sentMsgLastTS: sentMsgs?.lastTS ?? 0,
		sentMsgsCount: sentMsgs?.count ?? 0
	};
}


Object.freeze(exports);