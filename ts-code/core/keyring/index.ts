/*
 Copyright (C) 2015 - 2018, 2022, 2025 - 2026 3NSoft Inc.
 
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

import { makePeersKeyring } from './peer-keys';
import { ASMailKeyPair, JWKeyPair, MsgKeyRole, generateKeyPair, msgKeyPackSizeFor } from './common';
import { makeEncryptor, makeDecryptor } from '../../lib-common/async-cryptor-wrap';
import { NONCE_LENGTH, AsyncSBoxCryptor } from 'xsp-files';
import { OpenedMsg } from '../asmail/msg/opener';
import { areAddressesEqual, toCanonicalAddress } from '../../lib-common/canonical-address';
import { ResourcesForSending } from '../asmail/delivery/common';
import { ResourcesForReceiving } from '../asmail/inbox';
import * as delivApi from '../../lib-common/service-api/asmail/delivery';
import { cryptoWorkLabels } from '../../lib-client/cryptor-work-labels';
import { makeHolderOfPublishedIntroKey } from './introductory-keys/published-intro-key';
import { GetSigner } from '../id-manager';
import { ParamOnServer } from '../../lib-client/asmail/service-config';
import { Logger } from '../../lib-client/logging/log-to-file';
import { AsyncRNG } from '../../lib-common/rng-def';
import { getOrMakeDirOnInit } from '../../lib-client/fs-utils/fs-sync-utils';
import { box } from 'ecma-nacl';
import { base64 } from '../../lib-common/buffer-utils';

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

type WritableFS = web3n.files.WritableFS;
type Service = web3n.keys.Keyrings;

type SendingResources = ResourcesForSending['correspondents'];
type ReceptionResources = ResourcesForReceiving['correspondents'];

export interface KeyringForASMail {
	needIntroKeyFor: SendingResources['needIntroKeyFor'];
	generateIntroKeysToSendMsg: SendingResources['generateIntroKeysToSendMsg'];
	getEstablishedKeysToSendMsg: SendingResources['getEstablishedKeysToSendMsg'];
	decrypt: ReceptionResources['msgDecryptor'];
	close(): Promise<void>;
}

const INTRO_KEYS_FOLDER = 'introductory-keys';


export async function makeKeyrings(
	cryptor: AsyncSBoxCryptor, random: AsyncRNG, logger: Logger,
	fs: WritableFS, localFS: WritableFS, getSigner: GetSigner, pkeyOnServer: ParamOnServer<'init-pub-key'>
) {

	const workLabel = cryptoWorkLabels.makeRandom('asmail');

	const introKeysFS = await getOrMakeDirOnInit(fs, INTRO_KEYS_FOLDER);
	const publishedKeys = await makeHolderOfPublishedIntroKey(introKeysFS, getSigner, random, pkeyOnServer);

	const peerKeys = await makePeersKeyring(fs, localFS, random, logger);

	async function generateIntroKeysToSendMsg(
		address: string, introPKeyFromServer: JsonKey
	): ReturnType<SendingResources['generateIntroKeysToSendMsg']> {
		if (introPKeyFromServer.alg !== box.JWK_ALG_NAME) {
			// XXX make some standard runtime exception, for unknown alg
			throw new Error(`Unknown alg in introductory key: ${introPKeyFromServer.alg}`);
		}
		const oneTime = await generateKeyPair(random);
		const currentPair: ASMailKeyPair = {
			recipientKid: introPKeyFromServer.kid,
			senderPKey: oneTime.pkey
		};
		const msgMasterKey = box.calc_dhshared_key(base64.open(introPKeyFromServer.k), base64.open(oneTime.skey.k));
		const nextNonce = await random(NONCE_LENGTH);
		const encryptor = makeEncryptor(cryptor, workLabel, msgMasterKey, nextNonce);
		msgMasterKey.fill(0);
		const nextMsgCrypto = await peerKeys.suggestPairForPeerIntroKey(address, introPKeyFromServer);
		return { encryptor, currentPair, msgCount: 1, nextMsgCrypto };
	}

	async function getEstablishedKeysToSendMsg(
		address: string
	): ReturnType<SendingResources['getEstablishedKeysToSendMsg']> {
		const {
			msgMasterKey, currentPair, msgCount, nextMsgCrypto
		} = await peerKeys.getSendingCryptoWithinEstablishedPair(toCanonicalAddress(address));
		// prepare message encryptor
		const nextNonce = await random(NONCE_LENGTH);
		const encryptor = makeEncryptor(cryptor, workLabel, msgMasterKey, nextNonce);
		msgMasterKey.fill(0);
		return { encryptor, currentPair, msgCount, nextMsgCrypto };
	}

	async function decryptMsgKeyWithIntroPair(
		recipientKid: string, senderPKey: string,
		getMainObjHeader: () => Promise<Uint8Array>
	): Promise<{ decrInfo: MsgKeyInfo; introKey: JWKeyPair; }|undefined> {
		const recipKey = publishedKeys.find(recipientKid!);
		if (!recipKey) { return; }

		const h = await getMainObjHeader();
		const msgKeyPackLen = msgKeyPackSizeFor(recipKey.pair.skey.alg);
		if (h.length < msgKeyPackLen) { return; }

		const msgMasterKey = box.calc_dhshared_key(base64.open(senderPKey), base64.open(recipKey.pair.skey.k));
		const masterDecr = makeDecryptor(cryptor, workLabel, msgMasterKey);
		try {
			const mainObjFileKey = await masterDecr.open(h.subarray(0, msgKeyPackLen));
			const decrInfo: MsgKeyInfo = {
				correspondent: (undefined as any),
				keyStatus: recipKey.role,
				key: mainObjFileKey,
				msgKeyPackLen
			};
			return { decrInfo, introKey: recipKey.pair };
		} catch (err) {
			if (!(err as EncryptionException).failedCipherVerification) {
				throw err;
			}
		} finally {
			masterDecr.destroy();
		}
	}

	async function decryptMsgKeyWithEstablishedPair(
		pid: string, getMainObjHeader: () => Promise<Uint8Array>
	): Promise<{
		keyInfo: MsgKeyInfo;
		incrMsgCount: (msgCount: number) => void;
	}|undefined> {
		const pairs = peerKeys.findEstablishedReceptionPairs(pid);
		if (!pairs) { return; }
		
		// try to open main object's file key from a header
		const h = await getMainObjHeader();
		for (const { msgMasterKey, pairAlg, peerCAddr, ratchetStage, peerKId, recipientKId } of pairs) {
			const masterDecr = makeDecryptor(cryptor, workLabel, msgMasterKey);
			msgMasterKey.fill(0);
			try {
				const msgKeyPackLen = msgKeyPackSizeFor(pairAlg);
				if (h.length < msgKeyPackLen) { continue; }
				
				const mainObjFileKey = await masterDecr.open(h.subarray(0, msgKeyPackLen));
				const keyInfo: MsgKeyInfo = {
					correspondent: peerKeys.getPeerAddressForCanonical(peerCAddr) || peerCAddr,
					keyStatus: ratchetStage,
					key: mainObjFileKey,
					msgKeyPackLen
				};

				// set pair as in use
				if (keyInfo.keyStatus === 'suggested') {
					await peerKeys.markPairAsInUse(peerCAddr, peerKId, recipientKId);
				}

				return {
					keyInfo,
					incrMsgCount: msgCount => peerKeys.updateReceivedMsgCountIn(
						peerCAddr, peerKId, recipientKId, msgCount, Date.now()
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

	async function decrypt(
		msgMeta: delivApi.msgMeta.CryptoInfo,
		getMainObjHeader: () => Promise<Uint8Array>,
		getOpenedMsg: (mainObjFileKey: Uint8Array, msgKeyPackLen: number) => Promise<OpenedMsg>,
		checkMidKeyCerts: (certs: PKeyCertChain) => Promise<{ pkey: JsonKey; address: string; }>
	): ReturnType<ReceptionResources['msgDecryptor']> {

		let decrInfo: MsgKeyInfo;
		let introKey: JWKeyPair|undefined = undefined;
		let incrMsgCount: ((msgCount: number) => void)|undefined;
		let openedMsg: OpenedMsg;
		if (msgMeta.pid) {
			const r = await decryptMsgKeyWithEstablishedPair(msgMeta.pid, getMainObjHeader);
			if (!r) { return; }
			decrInfo = r.keyInfo;
			incrMsgCount = r.incrMsgCount;
			openedMsg = await getOpenedMsg(decrInfo.key!, decrInfo.msgKeyPackLen);
		} else {
			const r = await decryptMsgKeyWithIntroPair(
				msgMeta.recipientKid!, msgMeta.senderPKey!, getMainObjHeader
			);
			if (!r) { return; }
			decrInfo = r.decrInfo;
			introKey = r.introKey;
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
		const suggestedPair = openedMsg.nextCrypto;
		if (suggestedPair) {
			try {
				if (introKey) {
					if (introKey.pkey.kid !== suggestedPair.senderKid) {
						throw new Error(`Introductory message is referencing wrong key in the next crypto`);
					}
					await peerKeys.absorbNextPairSuggestedByPeer(decrInfo.correspondent, suggestedPair, introKey);
				} else {
					await peerKeys.absorbNextPairSuggestedByPeer(decrInfo.correspondent, suggestedPair);
				}
			} catch (err) {
				logger.logError(err, `Fail to absorb next suggested key for messaging`);
			}
		}

		return { decrInfo, openedMsg };
	};

	async function close(): Promise<void> {
		await publishedKeys.close();
		await peerKeys.close();
	}

	function makeKeyringsCAP(): Service {
		const w: Service = {
			introKeyOnASMailServer: publishedKeys.makeIntroKeyCAP(),
			getCorrespondentKeys: async (peerAddr) => peerKeys.getPeerKeysInfo(peerAddr)
		};
		return Object.freeze(w);
	}

	function forASMail(): KeyringForASMail {
		return {
			close,
			decrypt,
			generateIntroKeysToSendMsg,
			getEstablishedKeysToSendMsg,
			needIntroKeyFor: peerKeys.needIntroKeyFor
		};
	}

	return {
		close,
		makeKeyringsCAP,
		forASMail
	};
}


Object.freeze(exports);