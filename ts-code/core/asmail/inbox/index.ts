/*
 Copyright (C) 2015 - 2020, 2022, 2025 - 2026 3NSoft Inc.
 
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

import { StorageGetter } from '../../../lib-client/xsp-fs/common';
import { ConnectException } from '../../../lib-common/exceptions/http';
import { NamedProcs } from '../../../lib-common/processes/synced';
import { MailRecipient, makeFailToDecryptMsgException, makeMsgNotFoundException } from '../../../lib-client/asmail/recipient';
import { ServiceLocator } from '../../../lib-client/service-locator';
import { OpenedMsg, openMsg } from '../msg/opener';
import { MsgKeyInfo } from '../../keyring';
import { makeMsgIndex } from './msg-indexing';
import { fsForAttachments } from './attachments/fs';
import { areAddressesEqual } from '../../../lib-common/canonical-address';
import { checkAndExtractPKeyWithAddress } from '../key-verification';
import * as delivApi from '../../../lib-common/service-api/asmail/delivery';
import { InboxEvents } from './inbox-events';
import { GetSigner } from '../../id-manager';
import { LogError } from '../../../lib-client/logging/log-to-file';
import { AsyncSBoxCryptor, ObjSource } from 'xsp-files';
import { ensureCorrectFS } from '../../../lib-common/exceptions/file';
import { SendingParams } from '../msg/common';
import { MsgDownloader } from './msg-downloader';
import { CachedMessages } from './cached-msgs';
import { MsgMeta } from '../../../lib-common/service-api/asmail/retrieval';
import { MsgOnDisk } from './msg-on-disk';
import { makeTimedCache } from "../../../lib-common/timed-cache";
import { NetClient } from '../../../lib-client/request-utils';
import { getOrMakeDirOnInit } from '../../../lib-client/fs-utils/fs-sync-utils';
import { AsyncRNG } from '../../../lib-common/rng-def';

type MsgInfo = web3n.asmail.MsgInfo;
type IncomingMessage = web3n.asmail.IncomingMessage;
type InboxException = web3n.asmail.InboxException;
type WritableFS = web3n.files.WritableFS;
type InboxService = web3n.asmail.InboxService;
type JsonKey = web3n.keys.JsonKey;
type PKeyCertChain = web3n.keys.PKeyCertChain;

export interface ResourcesForReceiving {
	address: string;
	getSigner: GetSigner;
	getStorages: StorageGetter;
	cryptor: AsyncSBoxCryptor;
	random: AsyncRNG;
	makeNet: () => NetClient;
	asmailResolver: ServiceLocator;

	correspondents: {

		/**
		 * This function does ring's part of a decryption process, consisting of
		 * (1) finding key material, identified in message meta,
		 * (2) checking that respective keys open the message,
		 * (3) verifying identity of introductory key,
		 * (4) checking that sender header in message corresponds to address,
		 * associated with actual keys, and
		 * (5) absorbing crypto material in the message.
		 * Returned promise resolves to an object with an opened message and a
		 * decryption info, when all goes well, or, otherwise, resolves to
		 * undefined.
		 * @param msgMeta is a plain text meta information that comes with the
		 * message
		 * @param getMainObjHeader getter of message's main object's header
		 * @param getOpenedMsg that opens the message, given file key for the main
		 * object.
		 * @param checkMidKeyCerts is a certifying function for MailerId certs.
		 */
		msgDecryptor: (
			msgMeta: delivApi.msgMeta.CryptoInfo,
			getMainObjHeader: () => Promise<Uint8Array>,
			getOpenedMsg: (
				mainObjFileKey: Uint8Array, msgKeyPackLen: number
			) => Promise<OpenedMsg>,
			checkMidKeyCerts: (
				certs: PKeyCertChain
			) => Promise<{ pkey: JsonKey; address: string; }>
		) => Promise<{ decrInfo: MsgKeyInfo; openedMsg: OpenedMsg }|undefined>;

		/**
		 * This function marks one's own sending parameters as being used by
		 * respective correspondent/sender.
		 * @param sender
		 * @param invite
		 */
		markOwnSendingParamsAsUsed: (
			sender: string, invite: string
		) => Promise<void>;

		/**
		 * This function saves sending parameters that should be used next time
		 * for sending messages to a given address.
		 * @param address
		 * @param params
		 */
		saveParamsForSendingTo: (
			address: string, params: SendingParams
		) => Promise<void>;

		midResolver: ServiceLocator;

	};

	logError: LogError;
}

type R = ResourcesForReceiving['correspondents'];

const MSG_INDEX_FOLDER = 'msg-index';

/**
 * Instance of this class represents inbox-on-mail-server.
 * It uses api to manage messages on a ASMail server, caching and recording
 * some information to allow faster response, and to keep message keys, while
 * messages have not been removed via direct action or due to expiry.
 * This object is also responsible for expiring messages on the server.
 */
export type InboxOnServer = Awaited<ReturnType<typeof makeInboxOnServer>>;

export async function makeInboxOnServer(
	cachePath: string, syncedFS: WritableFS, localFS: WritableFS, r: ResourcesForReceiving
) {

	const procs = new NamedProcs();
	const recentlyOpenedMsgs = makeTimedCache<string, OpenedMsg>(60*1000);
	const {
		getStorages, cryptor, random, logError,
	} = r;

	ensureCorrectFS(syncedFS, 'synced', true);
	const indexSyncedFS = await getOrMakeDirOnInit(syncedFS, MSG_INDEX_FOLDER);
	const indexLocalFS = await localFS.writableSubRoot(MSG_INDEX_FOLDER);

	const msgReceiver = new MailRecipient(
		r.address, r.getSigner, () => r.asmailResolver(r.address), r.makeNet()
	);
	const downloader = new MsgDownloader(msgReceiver);
	const cache = await CachedMessages.makeFor(cachePath, downloader, r.logError);
	const index = await makeMsgIndex(indexSyncedFS, indexLocalFS, r.logError);
	const inboxEvents = new InboxEvents(msgReceiver, getMsg, listNewMsgs, removeMsg, r.logError);

	async function close(): Promise<void> {
		index.stopSyncing();
		inboxEvents.close();
	}

	function makeCAP(): InboxService {
		const service: InboxService = {
			getMsg,
			listMsgs,
			removeMsg,
			subscribe: inboxEvents.subscribe.bind(inboxEvents)
		};
		return Object.freeze(service);
	}

	async function removeMsg(msgId: string): Promise<void> {
		// check for an already started process
		const procId = 'removal of '+msgId;
		const promise = procs.latestTaskAtThisMoment<void>(procId);
		if (promise) { return promise; }
		// start removal process
		return procs.start<any>(procId, (async () => {
			await Promise.all([
				index.remove(msgId),
				removeMsgFromServerAndCache(msgId)
			]);
		}));
	}

	async function removeMsgFromServerAndCache(msgId: string): Promise<void> {
		await Promise.all([
			cache.deleteMsg(msgId),
			// XXX the following is suspicious, as it swallows other exceptions too
			msgReceiver.removeMsg(msgId).catch(() => {})
		]);
	}

	async function msgFromDiskOrDownload(msgId: string): Promise<MsgOnDisk> {
		const msgOnDisk = await cache.findMsg(msgId);
		if (msgOnDisk) { return msgOnDisk; }
		const meta = await downloader.getMsgMeta(msgId, false);
		return await cache.addMsg(msgId, meta);
	}

	function checkerOfMidKeyCerts(deliveryTS: number) {
		return (certs: PKeyCertChain) => checkAndExtractPKeyWithAddress(
			msgReceiver.getNet(), r.correspondents.midResolver, certs, Math.round(deliveryTS / 1000)
		);
	}

	function msgReadingAndOpening(msgId: string, mainObjId: string, msgOnDisk: MsgOnDisk) {
		// lazy main obj source
		let mainObjSrc: ObjSource|undefined = undefined;
		async function getMainObjHeader() {
			if (!mainObjSrc) {
				mainObjSrc = await msgOnDisk.getMsgObj(mainObjId);
			}
			return mainObjSrc.readHeader();
		}
		async function getOpenedMsg(mainObjFileKey: Uint8Array, msgKeyPackLen: number): Promise<OpenedMsg> {
			if (!mainObjSrc) {
				mainObjSrc = await msgOnDisk.getMsgObj(mainObjId);
			}
			return await openMsg(msgId, mainObjId, mainObjSrc, msgKeyPackLen, mainObjFileKey, cryptor);
		}
		return {
			getMainObjHeader, getOpenedMsg
		};
	}

	async function startCachingAndAddKeyToIndex(msgId: string): Promise<boolean> {
		const msgOnDisk = await msgFromDiskOrDownload(msgId);
		const meta = await msgOnDisk.getMsgMeta();
		const {
			getMainObjHeader, getOpenedMsg
		} = msgReadingAndOpening(msgId, meta.extMeta.objIds[0], msgOnDisk);
		try {
			const decrOut = await r.correspondents.msgDecryptor(
				meta.extMeta, getMainObjHeader, getOpenedMsg, checkerOfMidKeyCerts(msgOnDisk.deliveryTS)
			);
			if (decrOut) {
				const { decrInfo, openedMsg } = decrOut;
				openedMsg.setMsgKeyRole(decrInfo.keyStatus);
				// XXX we have never used this part of protocol, should it be removed at all from ASMail protocol?
				checkServerAuthIfPresent(meta, decrInfo);
				// add records cache and to index
				recentlyOpenedMsgs.set(msgId, openedMsg);
				const msgInfo: MsgInfo = {
					msgType: openedMsg.getSection('Msg Type'),
					msgId,
					deliveryTS: msgOnDisk.deliveryTS
				};
				await index.add(msgInfo, decrInfo);
				await Promise.all([
					absorbSendingParams(openedMsg),
					markOwnParams(meta, openedMsg.sender)
				]);
			} else {
				// check, if msg has already been indexed
				const knownDecr = await index.getKeyFor(msgId, msgOnDisk.deliveryTS);
				if (!knownDecr) {
					return false;
				}
			}
			return true;
		} catch (exc) {
			await logError(exc, `Problem with opening message ${msgId}`);
			return false;
		}
	}

	async function markOwnParams(meta: MsgMeta, sender: string): Promise<void> {

		// DEBUG
		// console.log(`  markOwnParams (if invite used) ->`, {sender, 'meta.invite':meta.invite});

		if (!meta.invite) { return; }
		await r.correspondents.markOwnSendingParamsAsUsed(sender, meta.invite);
	}

	async function absorbSendingParams(openedMsg: OpenedMsg): Promise<void> {
		const sendingParams = openedMsg.nextSendingParams;

		// DEBUG
		// console.log(`  openedMsg.nextSendingParams ->`, openedMsg.nextSendingParams);

		if (!sendingParams) { return; }
		const address = openedMsg.sender;
		await r.correspondents.saveParamsForSendingTo(address, sendingParams);
	}

	function debouncingProc<T>(procId: string, action: () => Promise<T>): Promise<T> {
		const promise = procs.latestTaskAtThisMoment<T>(procId);
		if (promise) {
			return promise;
		}
		return procs.start(procId, action);
	}

	async function listMsgs(fromTS?: number): Promise<MsgInfo[]> {
		const checkServer = true;	// XXX in future this will be an option from req
		if (!checkServer) {
			return index.listMsgs(fromTS);
		}
		return debouncingProc('listing msgs', async () => {
			// message listing info is located in index, yet, process involves
			// getting and caching messages' metadata
			let msgIds: string[];
			try {
				msgIds = await msgReceiver.listMsgs(fromTS);
			} catch (exc) {
				if ((exc as ConnectException).type !== 'connect') {
					throw exc;
				}
				return index.listMsgs(fromTS);
			}
			const indexedMsgs = await index.listMsgs(fromTS);
			for (const info of indexedMsgs) {
				const ind = msgIds.indexOf(info.msgId);
				if (ind >= 0) {
					msgIds.splice(ind, 1);
				}
			}
			if (msgIds.length === 0) { return indexedMsgs; }
			await Promise.all(msgIds.map(msgId =>
				startCachingAndAddKeyToIndex(msgId)
				.catch(async (exc: InboxException) => {
					if (!exc.incompleteDelivery && !exc.msgNotFound) {
						await logError(exc, `Failed to start caching message ${msgId}`);
					}
				})
			));
			return index.listMsgs(fromTS);
		});
	}

	async function listNewMsgs(fromTS: number): Promise<MsgInfo[]> {
		const msgIds = await msgReceiver.listMsgs(fromTS);
		// remove from listing messages already in index
		const indexedMsgs = await index.listMsgs(fromTS);
		for (const info of indexedMsgs) {
			const ind = msgIds.indexOf(info.msgId);
			if (ind >= 0) {
				msgIds.splice(ind, 1);
			}
		}
		if (msgIds.length === 0) { return []; }
		// cache and index these
		await Promise.all(msgIds.map(msgId =>
			startCachingAndAddKeyToIndex(msgId)
			.catch(async (exc: InboxException) => {
				if (!exc.incompleteDelivery && !exc.msgNotFound) {
					await logError(exc, `Failed to start caching message ${msgId}`);
				}
			})
		));
		// get info's from index, focusing on specific messages only
		return (await index.listMsgs(fromTS)).filter(({ msgId }) => msgIds.includes(msgId));
	}

	async function getMsg(msgId: string): Promise<IncomingMessage> {
		if (!msgId || (typeof msgId !== 'string')) {
			throw `Given message id is not a non-empty string`;
		}
		return debouncingProc(`get msg #${msgId}`, async () => {
			const msgOnDisk = await msgFromDiskOrDownload(msgId);
			let msg = recentlyOpenedMsgs.get(msgId);
			if (msg) {
				return msgToUIForm(msg, msgOnDisk.deliveryTS, msgOnDisk);
			}
			const meta = await msgOnDisk.getMsgMeta();
			const mainObjId = meta.extMeta.objIds[0];
			const mainObj = await msgOnDisk.getMsgObj(mainObjId);
			let msgKey = await index.getKeyFor(msgId, meta.deliveryCompletion!);
			if (!msgKey) {
				if (!(await startCachingAndAddKeyToIndex(msgId))) {
					throw makeFailToDecryptMsgException(msgId);
				}
				msgKey = await index.getKeyFor(msgId, meta.deliveryCompletion!);
				if (!msgKey) {
					throw makeFailToDecryptMsgException(msgId);
				}
			}
			msg = await openMsg(msgId, mainObjId, mainObj, msgKey.mainObjHeaderOfs, msgKey.msgKey, cryptor);
			msg.setMsgKeyRole(msgKey.msgKeyRole);
			return msgToUIForm(msg, msgOnDisk.deliveryTS, msgOnDisk);
		});
	}

	function msgToUIForm(msg: OpenedMsg, deliveryTS: number, msgOnDisk: MsgOnDisk): IncomingMessage {
		const m: IncomingMessage = {
			sender: msg.sender,
			establishedSenderKeyChain: msg.establishedKeyChain,
			msgId: msg.msgId,
			deliveryTS,
			msgType: msg.getSection('Msg Type'),
			subject: msg.getSection('Subject'),
			carbonCopy: msg.getSection('Cc'),
			recipients: msg.getSection('To')
		};
		const body = msg.mainBody;
		if (body.text) {
			if (typeof body.text.plain === 'string') {
				m.plainTxtBody = body.text.plain;
			}
			if (typeof body.text.html === 'string') {
				m.htmlTxtBody = body.text.html;
			}
		}
		if (body.json !== undefined) {
			m.jsonBody = body.json;
		}
		const attachments = msg.attachmentsJSON;
		if (attachments) {
			m.attachments = fsForAttachments(msgOnDisk, attachments, getStorages, cryptor, random, logError);
		}
		return m;
	}

	return {
		connectivityEvent$: inboxEvents.connectionEvent$,
		resumeNetworkActivity: inboxEvents.resumeNetworkActivity.bind(inboxEvents),
		suspendNetworkActivity: inboxEvents.suspendNetworkActivity.bind(inboxEvents),

		close,
		makeCAP
	}
}


function checkServerAuthIfPresent(meta: MsgMeta, { correspondent }: MsgKeyInfo): void {
	// if sender authenticated to server, check that it matches address,
	// recovered from message decryption 
	if (meta.authSender && !areAddressesEqual(meta.authSender, correspondent)) {
		throw new Error(
			`Sender authenticated to server as ${meta.authSender}, while decrypting key is associated with ${correspondent}`
		);
	}
}


Object.freeze(exports);