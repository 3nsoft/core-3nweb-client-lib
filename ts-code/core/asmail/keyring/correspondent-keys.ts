/*
 Copyright (C) 2015 - 2018, 2022 3NSoft Inc.
 
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

/**
 * This file contains functionality, used inside keyring.
 */

import { JWKeyPair, PID_LENGTH, generateKeyPair, extractKeyBytes, MsgKeyRole, extractSKeyBytes, ASMailKeyPair} from './common';
import { JsonKey, JsonKeyShort } from '../../../lib-common/jwkeys';
import { SuggestedNextKeyPair } from '../msg/opener';
import { KeyPairsStorage } from './index';
import * as random from '../../../lib-common/random-node';
import { box } from 'ecma-nacl';
import { base64 } from '../../../lib-common/buffer-utils';
import { errWithCause } from '../../../lib-common/exceptions/error';
import { Decryptor, makeDecryptor } from '../../../lib-common/async-cryptor-wrap';
import { AsyncSBoxCryptor } from 'xsp-files';

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
 * Sending pairs are a rotating public key cryptography key material for sending
 * messages.
 * 
 * Let's note naming convention. Since this is a sending pair, this side of
 * communication is called a sender, while the other side is a recipient.
 */
export interface BaseSendingPair {

	/**
	 * This is recipients' public key, to which encryption is done.
	 * If this is an introductory pair, this key is recipient's published intro
	 * public key.
	 * Else, if this is an ratcheted pair, this key comes from crypto material
	 * that recipients suggests from time to time for further use.
	 */
	recipientPKey: JsonKeyShort;
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
export interface IntroductorySendingPair extends BaseSendingPair {
	type: 'intro';
}

/**
 * Ratcheted sending pair is a sending pair with pair ids (pids), attached to
 * it. These ids are used to identify correct key material.
 */
export interface RatchetedSendingPair extends BaseSendingPair {
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

function generatePids(): string[] {
	const pids: string[] = [];
	for (let i=0; i<5; i+=1) {
		pids[i] = random.stringOfB64UrlSafeCharsSync(PID_LENGTH);
	}
	return pids;
}

export function msgMasterDecryptor(
	cryptor: AsyncSBoxCryptor, skey: JsonKey, pkey: JsonKeyShort
): Decryptor {
	const msgMasterKey = calcMsgMasterKey(skey, pkey);
	const masterDecr = makeDecryptor(cryptor, msgMasterKey);
	msgMasterKey.fill(0);
	return masterDecr;
}

function calcMsgMasterKey(skey: JsonKey, pkey: JsonKeyShort): Uint8Array {
	if (skey.alg === box.JWK_ALG_NAME) {
		const sk = extractSKeyBytes(skey);
		const pk = extractKeyBytes(pkey);
		const dhShared = box.calc_dhshared_key(pk, sk);
		sk.fill(0);
		pk.fill(0);
		return dhShared;
	}
	throw new Error(`Unsupported algorithm ${skey.alg}`);
}

function calcMsgMasterKeyB64(skey: JsonKey, pkey: JsonKeyShort): string {
	return base64.pack(calcMsgMasterKey(skey, pkey));
}

interface CorrespondentKeysJSON {
	
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

const MIN_PERIOD_FOR_PAIR = 15*60*1000;

export class CorrespondentKeys {

	private keys: CorrespondentKeysJSON = (undefined as any);
	get correspondent(): string {
		return this.keys.correspondent;
	}
	
	/**
	 * @param keyring in which these keys are hanging.
	 * @param address of this correspondent.
	 * Either serialData, or an address should be defined, not both.
	 * @param serialData from which this object should be reconstructed.
	 * Either serialData, or an address should be defined, not both.
	 */
	constructor(
		private keyring: KeyPairsStorage,
		address: string|undefined, serialData?: string
	) {
		if (address) {
			this.keys = {
				correspondent: address,
				sendingPair: null,
				receptionPairs: {
					suggested: null,
					inUse: null,
					old: null
				}
			};
		} else {
			const data: CorrespondentKeysJSON = JSON.parse(serialData!);
			// TODO checks of deserialized json data
			
			this.keys = data;
		}
		Object.seal(this);
	}
	
	/**
	 * This attaches all keys into ring's maps.
	 * Theis method should be called only once, and only on a deserialized
	 * object.
	 */
	mapAllKeysIntoRing(): void {
		// index key pairs
		const pairs = [ this.keys.receptionPairs.suggested,
			this.keys.receptionPairs.inUse,
			this.keys.receptionPairs.old ];
		const email = this.correspondent;
		pairs.forEach(pair => {
			if (!pair) { return; }
			pair.pids.forEach(pid =>
				this.keyring.pairIdToEmailMap.addPair(pid, email));
		});
	}

	/**
	 * @return json object for serialization.
	 */
	serialForm(): string {
		return JSON.stringify(this.keys);
	}
	
	/**
	 * This function generates new suggested reception pair, but only if there
	 * is currently none.
	 * If there is previous suggested pair, it shall be returned.
	 */
	async suggestPair(): Promise<SuggestedNextKeyPair|undefined> {
		
		// reuse previously suggested pair
		if (this.keys.receptionPairs.suggested) {
			return toSuggestedPair(this.keys.receptionPairs.suggested);
		}

		if (!this.shouldSuggestNewPair()) { return; }

		// generate new suggested pair
		const corrPKey = this.keys.sendingPair!.recipientPKey;
		const isSenderIntroKey = (this.keys.sendingPair!.type === 'intro');
		const recipientKey = await generateKeyPair();
		const msgMasterKey = calcMsgMasterKeyB64(recipientKey.skey, corrPKey);
		const pair: ReceptionPair = {
				pids: generatePids(),
				recipientKey,
				senderPKey: corrPKey,
				isSenderIntroKey,
				msgMasterKey,
				timestamp: Date.now()
		};

		this.keys.receptionPairs.suggested = pair;

		// add pair to index
		this.keyring.pairIdToEmailMap.addPairs(pair.pids, this.correspondent);
		this.keyring.saveChanges();

		return toSuggestedPair(this.keys.receptionPairs.suggested);
	}

	private shouldSuggestNewPair(): boolean {
		if (!this.keys.sendingPair) { throw new Error(
			"Sending pair should be set before calling this function."); }
		if (this.keys.sendingPair.type === 'intro') { return true; }
		if (!this.keys.sendingPair.sentMsgs) { return false; }
		const now = Date.now();
		if ((this.keys.sendingPair.sentMsgs.lastTS + MIN_PERIOD_FOR_PAIR) < now) {
			return false; }
		return true;
	}

	/**
	 * This marks suggested reception pair as being in use.
	 * Suggested pair is moved into category in-use, while in-use pair is
	 * reclassified as old.
	 * @param pair
	 */
	markPairAsInUse(pair: ReceptionPair): void {
		if (this.keys.receptionPairs.suggested !== pair) { return; }
		const mp = this.keys.receptionPairs.inUse;
		this.keys.receptionPairs.inUse = this.keys.receptionPairs.suggested;
		if (mp) {
			const dp = this.keys.receptionPairs.old;
			this.keys.receptionPairs.old = mp;
			if (dp) {
				this.tryToRemovePIDsFromIndex(dp.pids);
			}
		}
	}

	private tryToRemovePIDsFromIndex(pids: string[]): void {
		const pidSet = new Set(pids);
		for (const pair of Object.values(this.keys.receptionPairs)) {
			if (!pair) { continue; }
			pair.pids.forEach(pid => pidSet.delete(pid));
		}
		for (const pid of pidSet) {
			this.keyring.pairIdToEmailMap.removePair(
				pid, this.correspondent);
		}
	}
	
	/**
	 * This function is used internally in this.setSendingPair(p) function.
	 * @param kid
	 * @return a key for receiving, corresponding to given key id.
	 */
	private findReceptionKey(kid: string): JWKeyPair {
		for (const fieldName of Object.keys(this.keys.receptionPairs)) {
			const rp: ReceptionPair = this.keys.receptionPairs[fieldName];
			if (!rp) { continue; }
			if (rp.recipientKey.skey.kid === kid) {
				return rp.recipientKey;
			}
		}
		const err = new Error("Key cannot be found");
		(err as any).unknownKid = true;
		throw err;
	}

	/**
	 * This checks given pair and sets a new sending pair.
	 * @param pair
	 * @param usedPublishedIntro
	 */
	ratchetUpSendingPair(
		pair: SuggestedNextKeyPair, usedPublishedIntro?: JWKeyPair
	): void {
		if (this.keys.sendingPair) {
			const existingPair = this.keys.sendingPair;
			if (existingPair.type === 'ratcheted') {
				if ((existingPair.recipientPKey.k === pair.recipientPKey.k)
				&& (existingPair.senderKey.pkey.kid === pair.senderKid)) { return; }
				if (existingPair.timestamp < pair.timestamp) { return; }
			}
		}

		let senderKey: JWKeyPair;
		if (pair.isSenderIntroKey) {
			if (!usedPublishedIntro) { throw new Error(
				`Missing a published intro key, referenced in the pair`); }
			senderKey = usedPublishedIntro;
		} else {
			senderKey = this.findReceptionKey(pair.senderKid);
		}
		try {
			const msgMasterKey = calcMsgMasterKeyB64(
				senderKey.skey, pair.recipientPKey);
			this.keys.sendingPair = {
				type: 'ratcheted',
				pids: pair.pids,
				recipientPKey: pair.recipientPKey,
				senderKey: senderKey,
				msgMasterKey,
				timestamp: pair.timestamp
			};
		} catch (err) {
			throw errWithCause(err, "Public key in a given pair cannot be used");
		}
	}
	
	/**
	 * @param pid
	 * @return pair for receiving messages and a role of a given pair.
	 * Undefined is returned when no pair were found.
	 */
	getReceivingPair(
		pid: string
	): { pair: ReceptionPair; role: MsgKeyRole; } | undefined {
		const pairs = this.keys.receptionPairs;
		if (pairs.suggested && (pairs.suggested.pids.indexOf(pid) >= 0)) {
			return {
				pair: pairs.suggested,
				role: 'suggested'
			};
		} else if (pairs.inUse && (pairs.inUse.pids.indexOf(pid) >= 0)) {
			return {
				pair: pairs.inUse,
				role: 'in_use'
			};
		} else if (pairs.old && (pairs.old.pids.indexOf(pid) >= 0)) {
			return {
				pair: pairs.old,
				role: 'old'
			};
		}
		return;	// explicit return of undefined
	}

	async getSendingPair(
		recipientIntroPKey?: JsonKey
	): Promise<{
		currentPair: ASMailKeyPair; msgMasterKey: Uint8Array; msgCount: number;
	}> {
		if (!this.keys.sendingPair) {
			if (!recipientIntroPKey) { throw new Error(
				`Sending pair for ${this.correspondent} is not set.`); }
			this.keys.sendingPair = {
				type: 'intro',
				recipientPKey: recipientIntroPKey
			};
		}
		const p = this.keys.sendingPair;
		let currentPair: ASMailKeyPair;
		let msgMasterKey: Uint8Array;
		let msgCount: number;
		if (p.type === 'intro') {
			const senderKey = await generateKeyPair();
			msgMasterKey = calcMsgMasterKey(senderKey.skey, p.recipientPKey);
			currentPair = {
				senderPKey: senderKey.pkey,
				recipientKid: p.recipientPKey.kid
			};
			msgCount = 1;
		} else {
			msgMasterKey = base64.open(p.msgMasterKey);
			msgCount = updateMsgCountInRatchetedSendingPair(p);
			currentPair = { pid: selectPid(p) };
		}
		return { msgMasterKey, msgCount, currentPair };
	}
	
}
Object.freeze(CorrespondentKeys.prototype);
Object.freeze(CorrespondentKeys);

function toSuggestedPair(pair: ReceptionPair): SuggestedNextKeyPair {
	const nextKeyPair: SuggestedNextKeyPair = {
		pids: pair.pids,
		senderKid: pair.senderPKey.kid,
		recipientPKey: pair.recipientKey.pkey,
		isSenderIntroKey: pair.isSenderIntroKey,
		timestamp: pair.timestamp
	};
	return nextKeyPair;
}

function selectPid(pair: RatchetedSendingPair): string {
	if (pair.pids.length < 1) { throw new Error(
		"There are no pair ids in array."); }
	const i = Math.round((pair.pids.length-1) * random.uint8Sync()/255);
	return pair.pids[i];
}

/**
 * This function updates message count and a timestamp in a given sending pair,
 * returning a message count to use for sending a new message.
 * @param p is a sending pair, in which changes should be done.
 */
function updateMsgCountInRatchetedSendingPair(p: RatchetedSendingPair): number {
	const lastTS = Date.now();
	if (p.sentMsgs) {
		p.sentMsgs.count += 1;
		p.sentMsgs.lastTS = lastTS;
	} else {
		p.sentMsgs = {
			count: 1,
			lastTS
		};
	}
	return p.sentMsgs.count;
}

Object.freeze(exports);