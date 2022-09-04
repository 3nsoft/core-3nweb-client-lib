/*
 Copyright (C) 2015 - 2020 3NSoft Inc.
 
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

import { StorageGetter } from '../../../lib-client/3nstorage/xsp-fs/common';
import { ConnectException } from '../../../lib-common/exceptions/http';
import { errWithCause } from '../../../lib-common/exceptions/error';
import { NamedProcs } from '../../../lib-common/processes/synced';
import { MailRecipient, makeMsgNotFoundException } from '../../../lib-client/asmail/recipient';
import { ServiceLocator } from '../../../lib-client/service-locator';
import { OpenedMsg, openMsg } from '../msg/opener';
import { MsgKeyInfo } from '../keyring';
import { MsgIndex } from './msg-indexing';
import { fsForAttachments } from './attachments/fs';
import { areAddressesEqual } from '../../../lib-common/canonical-address';
import { base64 } from '../../../lib-common/buffer-utils';
import { checkAndExtractPKeyWithAddress } from '../key-verification';
import * as confApi from '../../../lib-common/service-api/asmail/config';
import * as delivApi from '../../../lib-common/service-api/asmail/delivery';
import { JsonKey } from '../../../lib-common/jwkeys';
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

type MsgInfo = web3n.asmail.MsgInfo;
type IncomingMessage = web3n.asmail.IncomingMessage;
type WritableFS = web3n.files.WritableFS;
type InboxService = web3n.asmail.InboxService;

export interface ResourcesForReceiving {
	address: string;
	getSigner: GetSigner;
	getStorages: StorageGetter;
	cryptor: AsyncSBoxCryptor;
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
		msgDecryptor: (msgMeta: delivApi.msgMeta.CryptoInfo,
				getMainObjHeader: () => Promise<Uint8Array>,
				getOpenedMsg: (mainObjFileKey: string, msgKeyPackLen: number) =>
					Promise<OpenedMsg>,
				checkMidKeyCerts: (certs: confApi.p.initPubKey.Certs) =>
					Promise<{ pkey: JsonKey; address: string; }>) =>
			Promise<{ decrInfo: MsgKeyInfo; openedMsg: OpenedMsg }|undefined>;
		
		/**
		 * This function marks one's own sending parameters as being used by
		 * respective correspondent/sender.
		 * @param sender
		 * @param invite
		 */
		markOwnSendingParamsAsUsed: (sender: string, invite: string) =>
			Promise<void>;

		/**
		 * This function saves sending parameters that should be used next time
		 * for sending messages to a given address.
		 * @param address
		 * @param params
		 */
		saveParamsForSendingTo: (address: string, params: SendingParams) =>
			Promise<void>;

		midResolver: ServiceLocator;

	};

	logError: LogError;
}

type R = ResourcesForReceiving['correspondents'];

/**
 * Instance of this class represents inbox-on-mail-server.
 * It uses api to manage messages on a ASMail server, caching and recording
 * some information to allow faster response, and to keep message keys, while
 * messages have not been removed via direct action or due to expiry.
 * This object is also responsible for expiring messages on the server.
 */
export class InboxOnServer {
	
	private readonly inboxEvents: InboxEvents;
	private readonly procs = new NamedProcs();
	private readonly recentlyOpenedMsgs = makeTimedCache<string, OpenedMsg>(
		60*1000);
	
	private constructor(
		private readonly r: R,
		private readonly msgReceiver: MailRecipient,
		private readonly storages: StorageGetter,
		private readonly cryptor: AsyncSBoxCryptor,
		private readonly downloader: MsgDownloader,
		private readonly cache: CachedMessages,
		private readonly index: MsgIndex,
		private readonly logError: LogError
	) {
		this.inboxEvents = new InboxEvents(
			this.msgReceiver, this.getMsg.bind(this), this.logError);
		Object.seal(this);
	}

	static async makeAndStart(
		cachePath: string, fs: WritableFS, r: ResourcesForReceiving
	): Promise<InboxOnServer> {
		try {
			ensureCorrectFS(fs, 'synced', true);
			const msgReceiver = new MailRecipient(
				r.address, r.getSigner,
				() => r.asmailResolver(r.address), r.makeNet());
			const downloader = new MsgDownloader(msgReceiver);
			const cache = await CachedMessages.makeFor(
				cachePath, downloader, r.logError);
			const index = await MsgIndex.makeWith(fs);
			return new InboxOnServer(
				r.correspondents, msgReceiver, r.getStorages, r.cryptor,
				downloader, cache, index, r.logError);
		} catch (err) {
			throw errWithCause(err, 'Failed to initialize Inbox');
		}
	}

	wrap(): InboxService {
		const service: InboxService = {
			getMsg: this.getMsg.bind(this),
			listMsgs: this.listMsgs.bind(this),
			removeMsg: this.removeMsg.bind(this),
			subscribe: this.inboxEvents.subscribe.bind(this.inboxEvents)
		};
		return Object.freeze(service);
	}
	
	private async removeMsg(msgId: string): Promise<void> {
		// check for an already started process
		const procId = 'removal of '+msgId;
		const promise = this.procs.latestTaskAtThisMoment<void>(procId);
		if (promise) { return promise; }
		// start removal process
		return this.procs.start<any>(procId, (async () => {
			await Promise.all([
				this.index.removeUsingIdOnly(msgId),
				this.removeMsgFromServerAndCache(msgId)
			]);
		}));
	}

	private async removeMsgFromServerAndCache(msgId: string): Promise<void> {
		await Promise.all([
			this.cache.deleteMsg(msgId),
			this.msgReceiver.removeMsg(msgId).catch(() => {})
		]);
	}

	private async msgFromDiskOrDownload(msgId: string): Promise<MsgOnDisk> {
		const msgOnDisk = await this.cache.findMsg(msgId);
		if (msgOnDisk) { return msgOnDisk; }
		const meta = await this.downloader.getMsgMeta(msgId);
		return this.cache.addMsg(msgId, meta);
	}
	
	private async startCachingAndAddKeyToIndex(msgId: string): Promise<boolean> {
		const msgOnDisk = await this.msgFromDiskOrDownload(msgId);
		const meta = await msgOnDisk.getMsgMeta();

		try {

			// setup closures, some memoized, for use by keyring
			let mainObjSrc: ObjSource|undefined = undefined;
			const mainObjId = meta.extMeta.objIds[0];
			const getMainObjHeader = async (): Promise<Uint8Array> => {
				if (!mainObjSrc) {
					mainObjSrc = await msgOnDisk.getMsgObj(mainObjId);
				}
				return mainObjSrc.readHeader();
			};
			const getOpenedMsg = async (mainObjFileKey: string,
					msgKeyPackLen: number): Promise<OpenedMsg> => {
				if (!mainObjSrc) {
					mainObjSrc = await msgOnDisk.getMsgObj(mainObjId);
				}
				const fKey = base64.open(mainObjFileKey);
				const openedMsg = await openMsg(msgId, mainObjId,
					mainObjSrc, msgKeyPackLen, fKey, this.cryptor);
				fKey.fill(0);
				return openedMsg;
			};
			const checkMidKeyCerts = (certs: confApi.p.initPubKey.Certs):
					Promise<{ pkey: JsonKey; address: string; }> => {
				return checkAndExtractPKeyWithAddress(
					this.msgReceiver.getNet(), this.r.midResolver, certs,
					Math.round(msgOnDisk.deliveryTS / 1000));
			};

			const decrOut = await this.r.msgDecryptor(
				meta.extMeta, getMainObjHeader, getOpenedMsg, checkMidKeyCerts);

			if (decrOut) {
				const { decrInfo, openedMsg } = decrOut;
				openedMsg.setMsgKeyRole(decrInfo.keyStatus);

				this.checkServerAuthIfPresent(meta, decrInfo);

				// add records cache and to index
				this.recentlyOpenedMsgs.set(msgId, openedMsg);
				const msgInfo: MsgInfo = {
					msgType: openedMsg.getSection('Msg Type'),
					msgId,
					deliveryTS: msgOnDisk.deliveryTS
				};
				await this.index.add(msgInfo, decrInfo);

				await Promise.all([
					this.absorbSendingParams(openedMsg),
					this.markOwnParams(meta, openedMsg.sender)
				]);

			} else {
				// check, if msg has already been indexed
				const knownDecr = await this.index.fKeyFor(
					{ msgId, deliveryTS: msgOnDisk.deliveryTS });
				if (!knownDecr) {
					await msgOnDisk.updateMsgKeyStatus('not-found');
					return false;
				}

				// TODO try to open main message, just as a check

			}
			await msgOnDisk.updateMsgKeyStatus('ok');
			return true;
		} catch (exc) {
			await msgOnDisk.updateMsgKeyStatus('fail');
			await this.logError(exc, `Problem with opening message ${msgId}`);
			return false;
		}
	}

	private async markOwnParams(meta: MsgMeta, sender: string): Promise<void> {
		if (!meta.invite) { return; }
		await this.r.markOwnSendingParamsAsUsed(sender, meta.invite);
	}

	private async absorbSendingParams(openedMsg: OpenedMsg): Promise<void> {
		const sendingParams = openedMsg.nextSendingParams;
		if (!sendingParams) { return; }
		const address = openedMsg.sender;
		await this.r.saveParamsForSendingTo(address, sendingParams);
	}
	
	private checkServerAuthIfPresent(meta: MsgMeta, decrInfo: MsgKeyInfo): void {
		// if sender authenticated to server, check that it matches address,
		// recovered from message decryption 
		if (meta.authSender &&
				!areAddressesEqual(meta.authSender, decrInfo.correspondent)) {
			throw new Error(`Sender authenticated to server as ${meta.authSender}, while decrypting key is associated with ${decrInfo.correspondent}`);
		}
	}
	
	private async listMsgs(fromTS?: number): Promise<MsgInfo[]> {
		const checkServer = true;	// XXX in future this will be an option from req
		if (!checkServer) { return this.index.listMsgs(fromTS); }

		// check for an already started process
		const procId = 'listing msgs';
		const promise = this.procs.latestTaskAtThisMoment<MsgInfo[]>(procId);
		if (promise) { return promise; }
		// start message listing process
		return this.procs.start(procId, async () => {
			// message listing info is located in index, yet, process involves
			// getting and caching messages' metadata
			let msgIds: string[];
			try {
				msgIds = await this.msgReceiver.listMsgs(fromTS);
			} catch (exc) {
				if ((exc as ConnectException).type !== 'http-connect') {
					throw exc; }
				return this.index.listMsgs(fromTS);
			}
			const indexedMsgs = await this.index.listMsgs(fromTS);
			for (const info of indexedMsgs) {
				const ind = msgIds.indexOf(info.msgId);
				if (ind >= 0) {
					msgIds.splice(ind, 1);
				}
			}
			if (msgIds.length === 0) { return indexedMsgs; }
			const keying = msgIds.map(msgId =>
				this.startCachingAndAddKeyToIndex(msgId).catch(async (exc) => {
					await this.logError(
						exc, `Failed to start caching message ${msgId}`);
				}));
			await Promise.all(keying);
			return this.index.listMsgs(fromTS);
		});
	}

	private async getMsg(msgId: string): Promise<IncomingMessage> {
		if (!msgId || (typeof msgId !== 'string')) {
			throw `Given message id is not a non-empty string`; }
		const procId = `get msg #${msgId}`;
		const promise = this.procs.latestTaskAtThisMoment<IncomingMessage>(procId);
		if (promise) { return promise; }
		return this.procs.start(procId, async () => {
			
			const msgOnDisk = await this.msgFromDiskOrDownload(msgId);
			
			let msg = this.recentlyOpenedMsgs.get(msgId);
			if (msg) {
				return this.msgToUIForm(msg, msgOnDisk.deliveryTS, msgOnDisk);
			}
				
			if ((msgOnDisk.keyStatus === 'not-found') ||
					(msgOnDisk.keyStatus === 'fail')) {
				// XXX 
				// message cannot be opened, and should be removed
				// await Promise.all([
				// 	this.index.remove(msgInfo),
				// 	this.removeMsgFromServerAndCache(msgId)
				// ]);
				throw makeMsgNotFoundException(msgId);
			} else if (msgOnDisk.keyStatus === 'not-checked') {
				await this.startCachingAndAddKeyToIndex(msgId);
			} else if (msgOnDisk.keyStatus !== 'ok') {
				throw new Error(`Unknown message key status ${msgOnDisk.keyStatus}`);
			}

			const meta = await msgOnDisk.getMsgMeta();
			const mainObjId = meta.extMeta.objIds[0];
			const mainObj = await msgOnDisk.getMsgObj(mainObjId);
			const msgKey = await this.index.fKeyFor(
				{ msgId, deliveryTS: meta.deliveryCompletion! });
			if (!msgKey) {
				throw makeMsgNotFoundException(msgId);
			}
			
			msg = await openMsg(msgId, mainObjId, mainObj,
				msgKey.mainObjHeaderOfs, msgKey.msgKey, this.cryptor);
			msg.setMsgKeyRole(msgKey.msgKeyRole);
			return this.msgToUIForm(msg, msgOnDisk.deliveryTS, msgOnDisk);
		});
	}

	private msgToUIForm(
		msg: OpenedMsg, deliveryTS: number, msgOnDisk: MsgOnDisk
	): IncomingMessage {
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
			m.attachments = fsForAttachments(
				msgOnDisk, attachments, this.storages, this.cryptor, this.logError
			);
		}
		return m;
	}
	
}
Object.freeze(InboxOnServer.prototype);
Object.freeze(InboxOnServer);

Object.freeze(exports);