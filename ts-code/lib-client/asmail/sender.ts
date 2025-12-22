/*
 Copyright (C) 2015, 2017, 2020, 2025 3NSoft Inc.
 
 This program is free software: you can redistribute it and/or modify it under
 the terms of the GNU General Public License as published by the Free Software
 Foundation, either version 3 of the License, or (at your option) any later
 version.
 
 This program is distributed in the hope that it will be useful, but
 WITHOUT ANY WARRANTY; without even the implied warranty of
 MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 See the GNU General Public License for more details.
 
 You should have received a copy of the GNU General Public License along with
 this program. If not, see <http://www.gnu.org/licenses/>. */

/**
 * This defines functions that implement ASMail delivery protocol.
 */

import { NetClient } from '../request-utils';
import * as api from '../../lib-common/service-api/asmail/delivery';
import { asmailInfoAt, ServiceLocator } from '../service-locator';
import { parse as parseUrl } from 'url';
import { MailerIdSigner } from '../../lib-common/mailerid-sigs/user';
import { makeMalformedReplyHTTPException, makeUnexpectedStatusHTTPException } from '../../lib-common/exceptions/http';

const LIMIT_ON_MAX_CHUNK = 1024*1024;

const TOO_EARLY_RESTART_PERIOD = 5*60*1000;

type ASMailSendException = web3n.asmail.ASMailSendException;

export type FirstSaveReqOpts = api.PutObjFirstQueryOpts;
export type FollowingSaveReqOpts = api.PutObjSecondQueryOpts;

export type ServiceUrlGetter = (address: string) => Promise<string>;

export interface SessionInfo {
	uri: string;
	sessionId: string;
	msgId: string;
	maxMsgLength: number;
	maxChunkSize: number;
}

export class MailSender {
	
	sessionId: string = (undefined as any);
	maxMsgLength: number = (undefined as any);
	redirectedFrom: string = (undefined as any);
	recipientPubKeyCerts: api.initPubKey.Reply = (undefined as any);
	msgId: string = (undefined as any);
	maxChunkSize = LIMIT_ON_MAX_CHUNK;
	private sessionRestartTimeStamp: number|undefined = undefined;
	
	private uri: string = (undefined as any);
	get deliveryURI(): string {
		if (typeof this.uri !== 'string') { throw new Error(
			`Delivery uri is not initialized.`); }
		return this.uri;
	}
	private get serviceDomain(): string {
		return parseUrl(this.uri).hostname!;
	}

	private constructor(
		public readonly sender: string|undefined,
		public readonly recipient: string,
		public readonly invitation: string|undefined,
		public readonly net: NetClient
	) {
		Object.seal(this);
	}

	/**
	 * This static method creates a fresh, as apposed to restarted, sender.
	 * Returned promise resolves to it.
	 * @param net
	 * @param getDeliveryURL is a function that produces recipient's service url
	 * @param sender is a string with sender's mail address, or undefined,
	 * for anonymous sending (non-authenticated).
	 * @param recipient is a required string with recipient's mail address.
	 * @param invitation is an optional string token, used with either anonymous
	 * (non-authenticated) delivery, or in a more strict delivery control in
	 * authenticated setting.
	 */
	static async fresh(
		net: NetClient, getDeliveryURL: ServiceLocator,
		sender: string|undefined, recipient: string, invitation?: string
	): Promise<MailSender> {
		const ms = new MailSender(sender, recipient, invitation, net);
		const deliveryURL = await getDeliveryURL(recipient);
		await ms.setDeliveryUrl(deliveryURL);
		return ms;
	}

	/**
	 * This static method creates a resumed sender that can continue sending
	 * message objects.
	 * @param recipient is a required string with recipient's mail address.
	 * @param session
	 */
	static async resume(
		net: NetClient, recipient: string, session: SessionInfo
	): Promise<MailSender> {
		const ms = new MailSender(undefined, recipient, undefined, net);
		ms.uri = session.uri;
		ms.msgId = session.msgId;
		ms.sessionId = session.sessionId;
		ms.maxMsgLength = session.maxMsgLength;
		ms.maxChunkSize = session.maxChunkSize;
		return ms;
	}

	private async setDeliveryUrl(serviceUrl: string): Promise<void> {
		const info = await asmailInfoAt(this.net, serviceUrl);
		if (!info.delivery) { throw new Error(`Missing delivery service url in ASMail information at ${serviceUrl}`); }
		this.uri = info.delivery;
	}
	
	private badRedirectExc(): ASMailSendException {
		return {
			runtimeException: true,
			type: 'asmail-delivery',
			address: this.recipient,
			badRedirect: true
		};
	}
	
	private unknownRecipientExc(): ASMailSendException {
		return {
			runtimeException: true,
			type: 'asmail-delivery',
			address: this.recipient,
			unknownRecipient: true
		};
	}
	
	private senderNotAllowedExc(): ASMailSendException {
		return {
			runtimeException: true,
			type: 'asmail-delivery',
			address: this.recipient,
			senderNotAllowed: true
		};
	}
	
	private inboxIsFullExc(): ASMailSendException {
		return {
			runtimeException: true,
			type: 'asmail-delivery',
			address: this.recipient,
			inboxIsFull: true
		};
	}
	
	private authFailedOnDeliveryExc(): ASMailSendException {
		return {
			runtimeException: true,
			type: 'asmail-delivery',
			address: this.recipient,
			authFailedOnDelivery: true
		};
	}

	private recipientHasNoPubKeyExc(): ASMailSendException {
		return {
			runtimeException: true,
			type: 'asmail-delivery',
			address: this.recipient,
			recipientHasNoPubKey: true
		};
	}

	/**
	 * This method throws, if given message size is greater that a maximum
	 * message size that server is willing to take.
	 * @param msgSize is a total number of bytes for all message objects.
	 */
	ensureMsgFitsLimits(msgSize: number): void {
		if (typeof this.maxMsgLength !== 'number') { throw new Error(`Premature call to ensure size fit: maximum message length isn't set.`); }
		if (msgSize > this.maxMsgLength) {
				const exc: ASMailSendException =  {
				runtimeException: true,
				type: 'asmail-delivery',
				address: this.recipient,
				msgTooBig: true,
				allowedSize: this.maxMsgLength
			};
			throw exc;
		}
	}
	
	private prepareRedirectOrThrowUp(rep: api.sessionStart.RedirectReply): void {
		if (("string" !== typeof rep.redirect) ||
				(rep.redirect.length === 0) ||
				(parseUrl(rep.redirect).protocol !== 'https:')) {
			throw this.badRedirectExc();
		}
		// refuse second redirect
		if (this.redirectedFrom !== undefined) {
			throw this.badRedirectExc();
		}
		// set params
		this.redirectedFrom = this.deliveryURI;
		this.uri = rep.redirect;
	}
	
	/**
	 * This performs a pre-flight, server will provide the same information,
	 * as in session start, except that non session shall be opened a session.
	 * @return a promise, resolvable to reply info object with maxMsgLength.
	 * These values are also set in the fields of this sender.
	 * Failed promise's propagated error object may have an error status field:
	 *  403 is for not allowing to leave mail,
	 *  474 indicates unknown recipient,
	 *  480 tells that recipient's mailbox full.
	 */
	async performPreFlight(): Promise<api.preFlight.Reply> {
		const reqData: api.preFlight.Request = {
			sender: this.sender,
			recipient: this.recipient,
			invitation: this.invitation
		};
		const rep = await this.net.doJsonRequest<api.preFlight.Reply>({
			url: this.deliveryURI + api.preFlight.URL_END,
			method: 'POST',
			responseType: 'json'
		}, reqData);
		if (rep.status === api.preFlight.SC.ok) {
			if (typeof rep.data.maxMsgLength !== 'number') {
				throw makeMalformedReplyHTTPException(rep, { message: 'missing number maxMsgLength' });
			}
			if (rep.data.maxMsgLength < 500) {
				throw makeMalformedReplyHTTPException(rep, { message: 'maxMsgLength is too short' });
			}
			this.maxMsgLength = rep.data.maxMsgLength;
			return rep.data;
		} else if (rep.status == api.preFlight.SC.redirect) {
			this.prepareRedirectOrThrowUp(<any> rep.data);
			return this.performPreFlight();
		} else if (rep.status == api.preFlight.SC.unknownRecipient) {
			throw this.unknownRecipientExc();
		} else if (rep.status == api.preFlight.SC.senderNotAllowed) {
			throw this.senderNotAllowedExc();
		} else if (rep.status == api.preFlight.SC.inboxFull) {
			throw this.inboxIsFullExc();
		} else {
			throw makeUnexpectedStatusHTTPException(rep);
		}
	}
	
	/**
	 * This performs the very first, mandatory request to server, telling server
	 * who message is intended to, and whether this is an anonymous sender
	 * delivery.
	 * @return a promise, resolvable to reply info object with sessionId and
	 * maxMsgLength.
	 * These values are also set in the fields of this sender.
	 * Failed promise's propagated error object may have an error status field:
	 *  403 is for not allowing to leave mail,
	 *  474 indicates unknown recipient,
	 *  480 tells that recipient's mailbox full.
	 */
	async startSession(): Promise<api.sessionStart.Reply> {
		const reqData: api.sessionStart.Request = {
			sender: this.sender,
			recipient: this.recipient,
			invitation: this.invitation
		};
		const rep = await this.net.doJsonRequest<api.sessionStart.Reply>({
			url: this.deliveryURI + api.sessionStart.URL_END,
			method: 'POST',
			responseType: 'json'
		}, reqData);
		if (rep.status == api.sessionStart.SC.ok) {
			if (typeof rep.data.maxMsgLength !== 'number') {
				throw makeMalformedReplyHTTPException(rep, { message: 'missing number maxMsgLength' });
			}
			if (rep.data.maxMsgLength < 500) {
				throw makeMalformedReplyHTTPException(rep, { message: 'maxMsgLength is too short' });
			}
			this.maxMsgLength = rep.data.maxMsgLength;
			if ('string' !== typeof rep.data.sessionId) {
				throw makeMalformedReplyHTTPException(rep, { message: 'missing sessionId string' });
			}
			this.sessionId = rep.data.sessionId;
			delete (rep.data as any).sessionId;
			return rep.data;
		} else if (rep.status == api.sessionStart.SC.redirect) {
			this.prepareRedirectOrThrowUp(<any> rep.data);
			return this.startSession();
		} else if (rep.status == api.sessionStart.SC.unknownRecipient) {
			throw this.unknownRecipientExc();
		} else if (rep.status == api.sessionStart.SC.senderNotAllowed) {
			throw this.senderNotAllowedExc();
		} else if (rep.status == api.sessionStart.SC.inboxFull) {
			throw this.inboxIsFullExc();
		} else {
			throw makeUnexpectedStatusHTTPException(rep);
		}
	}

	private async restartSession(): Promise<void> {
		if (this.sessionId || !this.msgId || !this.recipient) { throw new Error(
			`Invalid state for session restart.`); }
		const reqData: api.sessionRestart.Request = {
			recipient: this.recipient,
			msgId: this.msgId
		};
		const rep = await this.net.doJsonRequest<api.sessionRestart.Reply>({
			url: this.deliveryURI + api.sessionRestart.URL_END,
			method: 'POST',
			responseType: 'json'
		}, reqData);
		if (rep.status == api.sessionRestart.SC.ok) {
			if (typeof rep.data.maxMsgLength !== 'number') {
				throw makeMalformedReplyHTTPException(rep, { message: 'missing number maxMsgLength' });
			}
			if (rep.data.maxMsgLength < 500) {
				throw makeMalformedReplyHTTPException(rep, { message: 'maxMsgLength is too short' });
			}
			this.maxMsgLength = rep.data.maxMsgLength;
			if (typeof rep.data.sessionId !== 'string') {
				throw makeMalformedReplyHTTPException(rep, { message: 'missing sessionId string' });
			}
			this.sessionId = rep.data.sessionId;
			if ((typeof rep.data.maxChunkSize === 'number') &&
					(rep.data.maxChunkSize < this.maxChunkSize)) {
				this.maxChunkSize = rep.data.maxChunkSize!;
			}
			return;
		} else if (rep.status == api.sessionRestart.SC.redirect) {
			this.prepareRedirectOrThrowUp(<any> rep.data);
			return this.restartSession();
		} else if (rep.status == api.sessionRestart.SC.unknownRecipient) {
			throw this.unknownRecipientExc();
		} else {
			throw makeUnexpectedStatusHTTPException(rep);
		}
	}

	/**
	 * This sends mailerId assertion for sender authorization.
	 * @param assertionSigner is a MailerId assertion signer
	 * @return a promise for request completion.
	 * Rejected promise passes an error object, conditionally containing
	 * status field.
	 */
	async authorizeSender(assertionSigner: MailerIdSigner): Promise<void> {
		const assertion = assertionSigner.generateAssertionFor(
			this.serviceDomain, this.sessionId);
		const reqData: api.authSender.Request = {
			assertion: assertion,
			userCert: assertionSigner.userCert,
			provCert: assertionSigner.providerCert
		};
		const rep = await this.net.doJsonRequest<void>({
			url: this.deliveryURI.toString() + api.authSender.URL_END,
			method: 'POST',
			sessionId: this.sessionId
		}, reqData);
		if (rep.status === api.authSender.SC.ok) { return; }
		this.sessionId = (undefined as any);
		if (rep.status === api.authSender.SC.authFailed) {
			throw this.authFailedOnDeliveryExc();
		} else {
			throw makeUnexpectedStatusHTTPException(rep);
		}
	}

	/**
	 * This gets recipients initial public key to launch message exchange.
	 * @return a promise resolvable to certificates, received from server.
	 * Certificates are also set in the field of this sender.
	 * Rejected promise passes an error object, conditionally containing
	 * status field.
	 */
	async getRecipientsInitPubKey(): Promise<api.initPubKey.Reply> {
		const rep = await this.net.doBodylessRequest<api.initPubKey.Reply>({
			url: this.deliveryURI + api.initPubKey.URL_END,
			method: 'GET',
			sessionId: this.sessionId,
			responseType: 'json'
		});
		if (rep.status === api.initPubKey.SC.ok) {
			this.recipientPubKeyCerts = rep.data;
			return this.recipientPubKeyCerts;
		} else if (rep.status === api.initPubKey.SC.pkeyNotRegistered) {
			throw this.recipientHasNoPubKeyExc();
		} else {
			throw makeUnexpectedStatusHTTPException(rep);
		}
	}

	/**
	 * This method sends message metadata. Returned promise resolves to
	 * session info, which can be used for delivery resumption/restart.
	 * @param md is a json-shaped message metadata, to be send to server
	 * @return a promise, resolvable on 201-OK response to json with msgId,
	 * and optional min and max limits on object chunks.
	 * These values are also set in the fields of this sender.
	 * Not-OK responses reject promises.
	 */
	async sendMetadata(meta: api.msgMeta.Request): Promise<SessionInfo> {
		const rep = await this.net.doJsonRequest<api.msgMeta.Reply>({
			url: this.deliveryURI + api.msgMeta.URL_END,
			method: 'PUT',
			sessionId: this.sessionId,
			responseType: 'json'
		}, meta);
		if (rep.status == api.msgMeta.SC.ok) {
			if (('string' !== typeof rep.data.msgId)
			|| (rep.data.msgId.length === 0)) {
				throw makeMalformedReplyHTTPException(rep, { message: 'msgId string is missing' });
			}
			this.msgId = rep.data.msgId;
			if (typeof rep.data.maxChunkSize === 'number') {
				if (rep.data.maxChunkSize < 64*1024) {
				throw makeMalformedReplyHTTPException(rep, { message: 'maxChunkSize is too small' });
				} else if (rep.data.maxChunkSize < this.maxChunkSize) {
					this.maxChunkSize = rep.data.maxChunkSize;
				}
			}
			return {
				uri: this.uri,
				msgId: this.msgId,
				sessionId: this.sessionId,
				maxChunkSize: this.maxChunkSize,
				maxMsgLength: this.maxMsgLength
			};
		} else {
			throw makeUnexpectedStatusHTTPException(rep);
		}
	}
	
	private async trySessionRestart(): Promise<boolean> {

		// check and set timestamp for session restarts
		const now = Date.now();
		if ((typeof this.sessionRestartTimeStamp === 'number') &&
				(now <= (this.sessionRestartTimeStamp+TOO_EARLY_RESTART_PERIOD))) {
			return false;
		}
		this.sessionRestartTimeStamp = now;

		// do restart
		await this.restartSession();
		return true;
	}

	async sendObj(objId: string, bytes: Uint8Array|Uint8Array[],
			fstReq: FirstSaveReqOpts|undefined,
			followReq: FollowingSaveReqOpts|undefined): Promise<void> {
		// prepare request url
		let url = (fstReq ? api.msgObj.firstPutReqUrlEnd(objId, fstReq) :
			(followReq ? api.msgObj.secondPutReqUrlEnd(objId, followReq) :
			undefined));
		if (!url) { throw new Error(`Missing request options`); }
		url = this.deliveryURI + url;

		// make request
		const rep = await this.net.doBinaryRequest<void>({
			url,
			method: 'PUT',
			sessionId: this.sessionId
		}, bytes);
		if (rep.status === api.ERR_SC.needSession) {
			// restart session, and call this method again
			this.sessionId = (undefined as any);
			const restart = await this.trySessionRestart();
			if (restart) {
				return this.sendObj(objId, bytes, fstReq, followReq);
			} else {
				throw makeUnexpectedStatusHTTPException(rep, {
					message: 'Unexpected status, when session restart is not expected to happen'
				});
			}
		} else if (rep.status === api.msgObj.SC.ok) {
			// normal return
			return;
		} else {
			throw makeUnexpectedStatusHTTPException(rep);
		}
	}
	
	/**
	 * @return a promise, resolvable when message delivery closing.
	 */
	async completeDelivery(): Promise<void> {
		const rep = await this.net.doBodylessRequest<void>({
			url: this.deliveryURI.toString() + api.completion.URL_END,
			method: 'POST',
			sessionId: this.sessionId
		});
		if (rep.status === api.completion.SC.ok) {
			this.sessionId = (undefined as any);
		} else {
			throw makeUnexpectedStatusHTTPException(rep);
		}
	}

	async cancelDelivery(): Promise<void> {
		if (!this.sessionId) { throw new Error(`Delivery session is not opened, and cannot be cancelled.`); }

		// XXX make delivery canceling request within session
		
	}
	
}
Object.freeze(MailSender);
Object.freeze(MailSender.prototype);

Object.freeze(exports);