/*
 Copyright (C) 2015, 2017, 2025 3NSoft Inc.
 
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

import { makeException, extractIntHeader, NetClient } from '../request-utils';
import * as api from '../../lib-common/service-api/asmail/retrieval';
import { ServiceUser, IGetMailerIdSigner, ServiceAccessParams } from '../user-with-mid-session';
import { asmailInfoAt } from '../service-locator';
import { makeSubscriber, SubscribingClient } from '../../lib-common/ipc/ws-ipc';

type InboxException = web3n.asmail.InboxException;

export function makeMsgNotFoundException(msgId: string): InboxException {
	const exc: InboxException = {
		runtimeException: true,
		type: 'inbox',
		msgId,
		msgNotFound: true
	};
	return exc;
}

export function makeObjNotFoundException(msgId: string, objId: string):
		InboxException {
	const exc: InboxException = {
		runtimeException: true,
		type: 'inbox',
		msgId,
		objNotFound: true,
		objId
	};
	return exc;
}

export function makeMsgIsBrokenException(msgId: string): InboxException {
	const exc: InboxException = {
		runtimeException: true,
		type: 'inbox',
		msgId,
		msgIsBroken: true
	};
	return exc;
}

const inboxAccessParams: ServiceAccessParams = {
	login: api.midLogin.MID_URL_PART,
	logout: api.closeSession.URL_END,
	canBeRedirected: true
};


export class MailRecipient extends ServiceUser {
	
	constructor(
		user: string, getSigner: IGetMailerIdSigner,
		mainUrlGetter: () => Promise<string>,
		net: NetClient
	) {
		super(
			user, inboxAccessParams, getSigner,
			serviceUriGetter(net, mainUrlGetter), net
		);
		Object.seal(this);
	}

	getNet(): NetClient {
		return this.net;
	}

	async listMsgs(fromTS: number|undefined): Promise<api.listMsgs.Reply> {
		
		// XXX modify request to take fromTS parameter to limit number of msgs
		
		const rep = await this.doBodylessSessionRequest<api.listMsgs.Reply>({
			appPath: api.listMsgs.URL_END,
			method: 'GET',
			responseType: 'json'
		});
		if (rep.status === api.listMsgs.SC.ok) {
			if (!Array.isArray(rep.data)) {
				throw makeException(rep, 'Malformed response');
			}
			return rep.data;
		} else {
			throw makeException(rep, 'Unexpected status');
		}
	}

	async getMsgMeta(msgId: string): Promise<api.MsgMeta> {
		const rep = await this.doBodylessSessionRequest<api.MsgMeta>({
			appPath: api.msgMetadata.genUrlEnd(msgId),
			method: 'GET',
			responseType: 'json'
		});
		if (rep.status === api.msgMetadata.SC.ok) {
			const meta = api.sanitizedMeta(rep.data);
			if (!meta) { throw makeException(rep, 'Malformed response'); }
			return meta;
		} else if (rep.status === api.msgMetadata.SC.unknownMsg) {
			throw makeMsgNotFoundException(msgId);
		} else {
			throw makeException(rep, 'Unexpected status');
		}
	}

	/**
	 * This method returns either first part of message object, or a whole of it,
	 * depending on a given limit for segments. Returned promise resolves to a
	 * total segments length, header bytes and a first chunk of segments, which
	 * can be a whole of object segments, if chunk's length is equal to total
	 * segments length.
	 * @param msgId 
	 * @param objId 
	 * @param limit this is a limit on segments size that we can accept in this
	 * request.
	 */
	async getObj(msgId: string, objId: string, limit: number): Promise<{
			segsTotalLen: number; header: Uint8Array; segsChunk: Uint8Array; }> {
		const opts: api.GetObjQueryOpts = { header: true, limit };
		const rep = await this.doBodylessSessionRequest<Uint8Array>({
			appPath: api.msgObj.genUrlEnd(msgId, objId, opts),
			method: 'GET',
			responseType: 'arraybuffer',
			responseHeaders: [ api.HTTP_HEADER.objSegmentsLength,
				api.HTTP_HEADER.objHeaderLength ]
		});

		if (rep.status === api.msgObj.SC.ok) {
			if (!(rep.data instanceof Uint8Array)) { throw makeException(rep,
				`Malformed response: body is not binary`); }
			const segsTotalLen = extractIntHeader(rep,
				api.HTTP_HEADER.objSegmentsLength);
			const headerLen = extractIntHeader(rep,
				api.HTTP_HEADER.objHeaderLength);
			if (rep.data.length > (headerLen + segsTotalLen)) {
				throw makeException(rep, `Malformed response: body is too long`); }
			return {
				segsTotalLen,
				header: rep.data.subarray(0, headerLen),
				segsChunk: rep.data.subarray(headerLen)
			};
		} else if (rep.status === api.msgObj.SC.unknownMsgOrObj) {
			throw makeObjNotFoundException(msgId, objId);
		} else {
			throw makeException(rep, 'Unexpected status');
		}
	}

	/**
	 * This method reads particular part of object's segments.
	 * @param msgId 
	 * @param objId 
	 * @param start is a start read position in segments
	 * @param end is an end, excluded, read position in segments
	 */
	async getObjSegs(msgId: string, objId: string, start: number, end: number):
			Promise<Uint8Array> {
		if (start >= end) { throw new Error(
			`Start parameter ${start} is not smaller than end ${end}`); }
		const opts: api.GetObjQueryOpts = { ofs: start, limit: end - start };
		const rep = await this.doBodylessSessionRequest<Uint8Array>({
			appPath: api.msgObj.genUrlEnd(msgId, objId, opts),
			method: 'GET',
			responseType: 'arraybuffer',
			responseHeaders: [ api.HTTP_HEADER.objSegmentsLength,
				api.HTTP_HEADER.objHeaderLength ]
		});

		if (rep.status === api.msgObj.SC.ok) {
			if (!(rep.data instanceof Uint8Array)) { throw makeException(rep,
				`Malformed response: body is not binary`); }
			return rep.data;
		} else if (rep.status === api.msgObj.SC.unknownMsgOrObj) {
			throw makeObjNotFoundException(msgId, objId);
		} else {
			throw makeException(rep, 'Unexpected status');
		}
	}

	async removeMsg(msgId: string): Promise<void> {
		const rep = await this.doBodylessSessionRequest<void>({
			appPath: api.rmMsg.genUrlEnd(msgId),
			method: 'DELETE'
		});
		if (rep.status === api.rmMsg.SC.ok) {
			return;
		} else if (rep.status === api.rmMsg.SC.unknownMsg) {
			throw makeMsgNotFoundException(msgId);
		} else {
			throw makeException(rep, 'Unexpected status');
		}
	}

	async openEventSource(): Promise<SubscribingClient> {
		const rep = await this.openWS(api.wsEventChannel.URL_END);
		if (rep.status === api.wsEventChannel.SC.ok) {
			return makeSubscriber(rep.data, undefined);
		} else {
			throw makeException(rep, 'Unexpected status');
		}
	}
	
}
Object.freeze(MailRecipient);
Object.freeze(MailRecipient.prototype);


function serviceUriGetter(
	net: NetClient, mainUrlGetter: () => Promise<string>
): () => Promise<string> {
	return async (): Promise<string> => {
		const serviceUrl = await mainUrlGetter();
		const info = await asmailInfoAt(net, serviceUrl);
		if (!info.retrieval) {
			throw new Error(
				`Missing retrieval service url in ASMail information at ${serviceUrl}`
			);
		}
		return info.retrieval;
	}
}


Object.freeze(exports);