/*
 Copyright (C) 2015 - 2018, 2022, 2025 3NSoft Inc.
 
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

import { CorrespondentKeys, ReceptionPair, msgMasterDecryptor } from './correspondent-keys';
import { IdToEmailMap } from './id-to-email-map';
import { MsgKeyRole, msgKeyPackSizeFor } from './common';
import { makeEncryptor, makeDecryptor } from '../../lib-common/async-cryptor-wrap';
import { NONCE_LENGTH, AsyncSBoxCryptor } from 'xsp-files';
import { SuggestedNextKeyPair, OpenedMsg } from '../asmail/msg/opener';
import * as random from '../../lib-common/random-node';
import { base64 } from '../../lib-common/buffer-utils';
import { areAddressesEqual, toCanonicalAddress } from '../../lib-common/canonical-address';
import { ResourcesForSending, addToNumberLineSegments } from '../asmail/delivery/common';
import { ResourcesForReceiving } from '../asmail/inbox';
import { makeKeyringStorage, KeyringStorage } from './keyring-storage';
import * as delivApi from '../../lib-common/service-api/asmail/delivery';
import { cryptoWorkLabels } from '../../lib-client/cryptor-work-labels';
import { PublishedIntroKey } from './published-intro-key';
import { GetSigner } from '../id-manager';
import { ParamOnServer } from '../../lib-client/asmail/service-config';
import { Logger } from '../../lib-client/logging/log-to-file';

type JsonKey = web3n.keys.JsonKey;
type PKeyCertChain = web3n.keys.PKeyCertChain;

export { KEY_USE, MsgKeyRole } from './common';

type EncryptionException = web3n.EncryptionException;

export interface MsgKeyInfo {
	
	correspondent: string;

	key?: Uint8Array;

	/**
	 * This is a current status of the key in this keyring.
	 */
	keyStatus: MsgKeyRole;

	/**
	 * Length of a key pack, in a main object's header start.
	 * This length depends on algorithms, hence we cannot hard-wire it, but must
	 * pass it this way, setting it according to key's nature.
	 */
	msgKeyPackLen: number;
}

interface RingJSON {
	corrKeys: string[];
}

type WritableFS = web3n.files.WritableFS;
type Service = web3n.keys.Keyrings;

type SendingResources = ResourcesForSending['correspondents'];
type ReceptionResources = ResourcesForReceiving['correspondents'];

export interface KeyringForASMail {
	needIntroKeyFor: SendingResources['needIntroKeyFor'];
	generateKeysToSend: SendingResources['generateKeysToSend'];
	nextCrypto: SendingResources['nextCrypto'];
	decrypt: ReceptionResources['msgDecryptor'];
	close(): Promise<void>;
}

export interface KeyPairsStorage {
	pairIdToEmailMap: IdToEmailMap;
	saveChanges: () => void;
}

const FILE_FOR_INTRO_KEY_ON_SERVER = 'introductory-keys/published-on-server.json';

// XXX Keyring is just a storage and crypto functionality around keys


export class Keyrings {
	
	/**
	 * This is a map from correspondents' canonical addresses to key objects.
	 */
	private readonly corrKeys = new Map<string, CorrespondentKeys>();

	readonly pairIdToEmailMap = new IdToEmailMap();

	private readonly workLabel = cryptoWorkLabels.makeRandom('asmail');

	private storage: KeyringStorage = (undefined as any);
	private publishedKeys: PublishedIntroKey = (undefined as any);

	constructor(
		private readonly cryptor: AsyncSBoxCryptor,
		private readonly logger: Logger
	) {
		Object.seal(this);
	}

	private readonly asKeyPairsStorage: KeyPairsStorage = {
		pairIdToEmailMap: this.pairIdToEmailMap,
		saveChanges: this.saveChanges.bind(this)
	};

	private addCorrespondent(
		address: string|undefined, serialForm?: string
	): CorrespondentKeys {
		const ck = (serialForm ?
			new CorrespondentKeys(this.asKeyPairsStorage, undefined, serialForm) :
			new CorrespondentKeys(this.asKeyPairsStorage, address)
		);
		if (this.corrKeys.has(ck.correspondent)) {
			throw new Error(`Correspondent with address ${ck.correspondent} is already present.`);
		}
		this.corrKeys.set(ck.correspondent, ck);
		if (serialForm) {
			ck.mapAllKeysIntoRing();
		}
		return ck;
	}

	async init(
		fs: WritableFS, getSigner: GetSigner,
		pkeyOnServer: ParamOnServer<'init-pub-key'>
	): Promise<void> {
		this.publishedKeys = await PublishedIntroKey.makeAndInit(
			await fs.writableFile(FILE_FOR_INTRO_KEY_ON_SERVER),
			getSigner, pkeyOnServer
		);
		this.storage = makeKeyringStorage(fs);
		await this.storage.start();
		const serialForm = await this.storage.load();
		if (serialForm) {
			const json: RingJSON = JSON.parse(serialForm);
			// TODO check json's fields
			
			// init data
			json.corrKeys.forEach((info) => {
				this.addCorrespondent(undefined, info);
			});
		} else {
			// save initial file, as there was none initially
			this.saveChanges();
		}
	}

	forASMail(): KeyringForASMail {
		return {
			close: this.close.bind(this),
			decrypt: this.decrypt.bind(this),
			generateKeysToSend: this.generateKeysToSend.bind(this),
			needIntroKeyFor: this.needIntroKeyFor.bind(this),
			nextCrypto: this.nextCrypto.bind(this),
		};
	}

	private saveChanges(): void {
		// pack bytes that need to be encrypted and saved
		const dataToSave: RingJSON = {
			corrKeys: []
		};
		for (const corrKeys of this.corrKeys.values()) {
			dataToSave.corrKeys.push(corrKeys.serialForm());
		}
		// trigger saving utility
		this.storage.save(JSON.stringify(dataToSave));
	}

	private needIntroKeyFor(
		address: string
	): ReturnType<SendingResources['needIntroKeyFor']> {
		address = toCanonicalAddress(address);
		return !this.corrKeys.has(address);
	};

	private async generateKeysToSend(
		address: string, introPKeyFromServer?: JsonKey
	): ReturnType<SendingResources['generateKeysToSend']> {
		address = toCanonicalAddress(address);

		let ck = this.corrKeys.get(address);
		if (!ck) {
			if (!introPKeyFromServer) {
				throw new Error(`There are no known keys for given address ${address} and a key from a mail server is not given either.`);
			}
			ck = this.addCorrespondent(address);
		}

		const {
			msgMasterKey, currentPair, msgCount
		} = await ck.getSendingPair(introPKeyFromServer);

		// prepare message encryptor
		const nextNonce = await random.bytes(NONCE_LENGTH);
		const encryptor = makeEncryptor(
			this.cryptor, this.workLabel, msgMasterKey, nextNonce
		);
		msgMasterKey.fill(0);

		return { encryptor, currentPair, msgCount };
	}

	private async nextCrypto(
		address: string
	): ReturnType<SendingResources['nextCrypto']> {
		address = toCanonicalAddress(address);
		let ck = this.corrKeys.get(address);
		if (!ck) {
			throw new Error(`No correspondent keys found for ${address}`);
		}
		const suggestPair = await ck.suggestPair();
		return suggestPair;
	}

	private async decryptMsgKeyWithIntroPair(
		recipientKid: string, senderPKey: string,
		getMainObjHeader: () => Promise<Uint8Array>
	): Promise<MsgKeyInfo|undefined> {
		const recipKey = this.publishedKeys.find(recipientKid!);
		if (!recipKey) { return; }

		const h = await getMainObjHeader();
		const msgKeyPackLen = msgKeyPackSizeFor(recipKey.pair.skey.alg);
		if (h.length < msgKeyPackLen) { return; }

		const masterDecr = msgMasterDecryptor(
			this.cryptor, recipKey.pair.skey, { kid: '', k: senderPKey! }
		);
		try {
			const mainObjFileKey = await masterDecr.open(
				h.subarray(0, msgKeyPackLen)
			);
			const info: MsgKeyInfo = {
				correspondent: (undefined as any),
				keyStatus: recipKey.role,
				key: mainObjFileKey,
				msgKeyPackLen
			};
			return info;
		} catch (err) {
			if (!(err as EncryptionException).failedCipherVerification) {
				throw err;
			}
		} finally {
			masterDecr.destroy();
		}
	}

	private findEstablishedReceptionPairs(pid: string): {
		correspondent: string; role: MsgKeyRole; pair: ReceptionPair;
	}[]|undefined {
		const emails = this.pairIdToEmailMap.getEmails(pid);
		if (!emails) { return; }

		const decryptors: {
			correspondent: string; role: MsgKeyRole; pair: ReceptionPair;
		}[] = [];
		for (const email of emails) {
			const ck = this.corrKeys.get(email);
			if (!ck) { return; }
			const rp = ck.getReceivingPair(pid!);
			if (!rp) { return; }
			decryptors.push({
				correspondent: email,
				role: rp.role,
				pair: rp.pair
			});
		}
		return decryptors;
	}

	private async decryptMsgKeyWithEstablishedPair(
		pid: string, getMainObjHeader: () => Promise<Uint8Array>
	): Promise<{
		keyInfo: MsgKeyInfo;
		incrMsgCount: (msgCount: number) => void;
	}|undefined> {
		const pairs = this.findEstablishedReceptionPairs(pid);
		if (!pairs) { return; }
		
		// try to open main object's file key from a header
		const h = await getMainObjHeader();
		for (const { correspondent, pair, role } of pairs) {
			const masterKey = base64.open(pair.msgMasterKey);
			const masterDecr = makeDecryptor(
				this.cryptor, this.workLabel, masterKey
			);
			masterKey.fill(0);
			try {
				const msgKeyPackLen = msgKeyPackLenForPair(pair);
				if (h.length < msgKeyPackLen) { continue; }
				
				const mainObjFileKey = await masterDecr.open(
					h.subarray(0, msgKeyPackLen)
				);
				const keyInfo: MsgKeyInfo = {
					correspondent: correspondent,
					keyStatus: role,
					key: mainObjFileKey,
					msgKeyPackLen
				};

				// set pair as in use
				if (keyInfo.keyStatus === 'suggested') {
					const corrKeys = this.corrKeys.get(keyInfo.correspondent);
					corrKeys!.markPairAsInUse(pair);
				}

				return {
					keyInfo,
					incrMsgCount: msgCount => this.updateReceivedMsgCountIn(
						pair, msgCount
					)
				};
			} catch (err) {
				if (!(err as EncryptionException).failedCipherVerification) {
					throw err;
				}
			} finally {
				masterDecr.destroy();
			}
		}
	}

	/**
	 * This method updates message counts and a timestamp in a given reception
	 * pair.
	 * @param rp is a sending pair, in which changes should be done. Note this
	 * must be a shared structure at this point, not a copy of a pair.
	 * @param msgCount is a message count that should be added to the pair.
	 */
	private updateReceivedMsgCountIn(rp: ReceptionPair, msgCount: number): void {
		const lastTS = Date.now();
		if (!rp.receivedMsgs) {
			rp.receivedMsgs = { counts: [], lastTS };
		}
		addToNumberLineSegments(rp.receivedMsgs.counts, msgCount);
		rp.receivedMsgs.lastTS = lastTS;
		this.saveChanges();
	}

	private absorbSuggestedNextKeyPair(
		correspondent: string, pair: SuggestedNextKeyPair
	): void {
		let ck = this.corrKeys.get(correspondent);
		if (!ck) {
			ck = this.addCorrespondent(correspondent);
		}
		if (pair.isSenderIntroKey) {
			const usedIntro = this.publishedKeys.find(pair.senderKid);
			if (!usedIntro) {
				throw new Error(`Recently used published intro key is not found`);
			}
			ck.ratchetUpSendingPair(pair, usedIntro.pair);
		} else {
			ck.ratchetUpSendingPair(pair)
		}

		// if (ck) {
		// 	ck.ratchetUpSendingPair(pair);
		// } else {
		// 	if (!pair.isSenderIntroKey) {
		// 		throw new Error(`Expected addition of correspondent to be done, when new `);
		// 	}
		// 	const usedIntro = this.publishedKeys.find(pair.senderKid);
		// 	if (!usedIntro) {
		// 		throw new Error(`Recently used published intro key is not found`);
		// 	}
		// 	ck = this.addCorrespondent(correspondent);
		// 	ck.ratchetUpSendingPair(pair, usedIntro.pair);
		// }

		this.saveChanges();
	}

	private async decrypt(
		msgMeta: delivApi.msgMeta.CryptoInfo,
		getMainObjHeader: () => Promise<Uint8Array>,
		getOpenedMsg: (
			mainObjFileKey: Uint8Array, msgKeyPackLen: number
		) => Promise<OpenedMsg>,
		checkMidKeyCerts: (
			certs: PKeyCertChain
		) => Promise<{ pkey: JsonKey; address: string; }>
	): ReturnType<ReceptionResources['msgDecryptor']> {

		let decrInfo: MsgKeyInfo|undefined;
		let incrMsgCount: ((msgCount: number) => void)|undefined;
		let openedMsg: OpenedMsg;
		if (msgMeta.pid) {
			const r = await this.decryptMsgKeyWithEstablishedPair(
				msgMeta.pid, getMainObjHeader
			);
			if (!r) { return; }
			decrInfo = r.keyInfo;
			incrMsgCount = r.incrMsgCount;
			openedMsg = await getOpenedMsg(decrInfo.key!, decrInfo.msgKeyPackLen);
		} else {
			decrInfo = await this.decryptMsgKeyWithIntroPair(
				msgMeta.recipientKid!, msgMeta.senderPKey!, getMainObjHeader
			);
			if (!decrInfo) { return; }
			openedMsg = await getOpenedMsg(decrInfo.key!, decrInfo.msgKeyPackLen);
			const certs = openedMsg.introCryptoCerts;
			const { address, pkey } = await checkMidKeyCerts(certs);
			if (pkey.k !== msgMeta.senderPKey!) {
				throw new Error(`Key certificates in the message are not for a key that encrypted this message.`);
			}
			decrInfo.correspondent = toCanonicalAddress(address);
		}

		// check that sender is the same as the trusted correspondent
		const sender = openedMsg.sender;
		if (!sender || !areAddressesEqual(sender, decrInfo.correspondent)) {
			throw new Error(`Mismatch between message sender field '${sender}', and address '${decrInfo.correspondent}', associated with decrypting key.`);
		}

		// update received msg counts and a time stamp
		if (incrMsgCount) {
			incrMsgCount(openedMsg.msgCount);
		}

		// absorb next crypto
		const pair = openedMsg.nextCrypto;
		if (pair) {
			try {
				if (msgMeta.recipientKid) {
					if (!pair.isSenderIntroKey) {
						throw new Error(`Introductory message is not referencing used intro key in the next crypto`);
					}
					if (msgMeta.recipientKid !== pair.senderKid) {
						throw new Error(`Introductory message is referencing wrong key in the next crypto`);
					}
				}
				this.absorbSuggestedNextKeyPair(decrInfo.correspondent, pair);
			} catch (err) {
				this.logger.logError(err, `Fail to absorb next suggested key for messaging`);
			}
		}

		return { decrInfo, openedMsg };
	};

	async close(): Promise<void> {
		await this.publishedKeys.close();
		await this.storage.close();
	}

	makeKeyringsCAP(): Service {
		const w: Service = {
			introKeyOnASMailServer: this.publishedKeys.makeIntroKeyCAP(),
			getCorrespondentKeys: async addr => {
				const cAddr = toCanonicalAddress(addr);
				return this.corrKeys.get(cAddr)?.toInfo();
			}
		};
		return Object.freeze(w);
	}

}
Object.freeze(Keyrings.prototype);
Object.freeze(Keyrings);


function msgKeyPackLenForPair(p: ReceptionPair): number {
	return msgKeyPackSizeFor(p.recipientKey.skey.alg);
}


Object.freeze(exports);