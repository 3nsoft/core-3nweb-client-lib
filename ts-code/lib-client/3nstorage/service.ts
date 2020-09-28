/*
 Copyright (C) 2015 - 2017, 2020 3NSoft Inc.
 
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
 * This defines functions that implement 3NStorage protocol.
 */

import { makeException, extractIntHeader, NetClient } from '../request-utils';
import * as api from '../../lib-common/service-api/3nstorage/owner';
import { ServiceUser, IGetMailerIdSigner } from '../user-with-mid-session';
import { storageInfoAt } from '../service-locator';
import * as keyGen from '../key-derivation';
import { makeObjNotFoundExc, makeConcurrentTransExc, makeUnknownTransactionExc, makeVersionMismatchExc } from './exceptions';
import { makeSubscriber, SubscribingClient } from '../../lib-common/ipc/ws-ipc';
import { ObjId } from './xsp-fs/common';

export type FirstSaveReqOpts = api.PutObjFirstQueryOpts;
export type FollowingSaveReqOpts = api.PutObjSecondQueryOpts;

export class StorageOwner extends ServiceUser {
	
	maxChunkSize: number|undefined = undefined;
	
	constructor(
		user: string, getSigner: IGetMailerIdSigner,
		mainUrlGetter: () => Promise<string>,
		net: NetClient
	) {
		super(user,
			{
				login: api.midLogin.MID_URL_PART,
				logout: api.closeSession.URL_END,
				canBeRedirected: true
			},
			getSigner,
			async (): Promise<string> => {
				const serviceUrl = await mainUrlGetter();
				const info = await storageInfoAt(this.net, serviceUrl);
				if (!info.owner) { throw new Error(`Missing owner service url in 3NStorage information at ${serviceUrl}`); }
				return info.owner;
			},
			net);
		Object.seal(this);
	}

	async getKeyDerivParams(): Promise<keyGen.ScryptGenParams> {
		const rep = await this.doBodylessSessionRequest<keyGen.ScryptGenParams>({
			appPath: api.keyDerivParams.URL_END,
			method: 'GET',
			responseType: 'json'
		});
		if (rep.status !== api.sessionParams.SC.ok) {
			throw makeException(rep, 'Unexpected status');
		}
		const keyDerivParams = rep.data;
		if (!keyGen.checkParams(rep.data)) {
			throw makeException(rep, 'Malformed response');
		}
		return keyDerivParams;
	}

	private async setSessionParams(): Promise<void> {
		const rep = await this.doBodylessSessionRequest<api.sessionParams.Reply>({
			appPath: api.sessionParams.URL_END,
			method: 'GET',
			responseType: 'json'
		});
		if (rep.status !== api.sessionParams.SC.ok) {
			throw makeException(rep, 'Unexpected status');
		}
		if ((typeof rep.data.maxChunkSize !== 'number') ||
				(rep.data.maxChunkSize < 64*1024)) {
			throw makeException(rep, 'Malformed response');
		}
		this.maxChunkSize = rep.data.maxChunkSize;
	}
	
	/**
	 * This does MailerId login with a subsequent getting of session parameters
	 * from 
	 * @return a promise, resolvable, when mailerId login and getting parameters'
	 * successfully completes.
	 */
	async login(): Promise<void> {
		await super.login();
		await this.setSessionParams();
	}
	
	/**
	 * @param objId must be null for root object, and a string id for other ones
	 * @param transactionId
	 * @return a promise, resolvable to transaction id.
	 */
	async cancelTransaction(
		objId: ObjId, transactionId?: string
	): Promise<void> {
		const appPath = ((objId === null) ?
				api.cancelRootTransaction.getReqUrlEnd(transactionId) :
				api.cancelTransaction.getReqUrlEnd(objId, transactionId));
		const rep = await this.doBodylessSessionRequest<void>(
			{ appPath, method: 'POST' });
		if (rep.status === api.cancelTransaction.SC.ok) {
			return;
		} else if (rep.status === api.cancelTransaction.SC.missing) {
			throw makeUnknownTransactionExc(objId!);
		} else {
			throw makeException(rep, 'Unexpected status');
		}
	}
	
	/**
	 * This method returns either first part of an object, or a whole of it,
	 * depending on a given limit for segments. Returned promise resolves to a
	 * total segments length, header bytes and a first chunk of segments, which
	 * can be a whole of object segments, if chunk's length is equal to total
	 * segments length.
	 * @param objId 
	 * @param limit this is a limit on segments size that we can accept in this
	 * request.
	 */
	async getCurrentObj(
		objId: ObjId, limit: number
	): Promise<{ version: number; segsTotalLen: number;
					header: Uint8Array; segsChunk: Uint8Array; }> {
		const opts: api.GetObjQueryOpts = { header: true, limit };
		const appPath = (objId ?
			api.currentObj.getReqUrlEnd(objId, opts) :
			api.currentRootObj.getReqUrlEnd(opts));
		const rep = await this.doBodylessSessionRequest<Uint8Array>({
			appPath,
			method: 'GET',
			responseType: 'arraybuffer',
			responseHeaders: [ api.HTTP_HEADER.objVersion,
				api.HTTP_HEADER.objSegmentsLength, api.HTTP_HEADER.objHeaderLength ]
		});
		
		if (rep.status === api.currentObj.SC.okGet) {
			if (!(rep.data instanceof Uint8Array)) { throw makeException(rep,
				`Malformed response: body is not binary`); }
			const version = extractIntHeader(rep, api.HTTP_HEADER.objVersion);
			const segsTotalLen = extractIntHeader(rep,
				api.HTTP_HEADER.objSegmentsLength);
			const headerLen = extractIntHeader(rep,
				api.HTTP_HEADER.objHeaderLength);
			if (rep.data.length > (headerLen + segsTotalLen)) {
				throw makeException(rep, `Malformed response: body is too long`); }
			return {
				version, segsTotalLen,
				header: rep.data.subarray(0, headerLen),
				segsChunk: rep.data.subarray(headerLen)
			};
		} else if (rep.status === api.currentObj.SC.unknownObj) {
			throw makeObjNotFoundExc(objId!);
		} else {
			throw makeException(rep, 'Unexpected status');
		}
	}

	/**
	 * This method reads particular part of object's segments.
	 * @param objId 
	 * @param version is object's expected current version. If object's current
	 * version on server has already changed, exception will be thrown.
	 * @param start is a start read position in segments
	 * @param end is an end, excluded, read position in segments
	 */
	async getCurrentObjSegs(
		objId: ObjId, version: number, start: number, end: number
	): Promise<Uint8Array> {
		if (end <= start) { throw new Error(`Given out of bounds parameters: start is ${start}, end is ${end}, -- for downloading obj ${objId}, version ${version}`); }
		const limit = end - start;
		
		const opts: api.GetObjQueryOpts = { ofs: start, limit, ver: version };
		const appPath = (objId ?
			api.currentObj.getReqUrlEnd(objId, opts) :
			api.currentRootObj.getReqUrlEnd(opts));
		const rep = await this.doBodylessSessionRequest<Uint8Array>({
			appPath,
			method: 'GET',
			responseType: 'arraybuffer',
		});
		
		if (rep.status === api.currentObj.SC.okGet) {
			if (!(rep.data instanceof Uint8Array)) { throw makeException(rep,
				`Malformed response: body is not binary`); }
			return rep.data;
		} else if (rep.status === api.currentObj.SC.unknownObj) {
			throw makeObjNotFoundExc(objId!);
		} else {
			throw makeException(rep, 'Unexpected status');
		}
	}

	/**
	 * This upload given bytes as a new version of a given object.
	 * Returned promise resolves either to undefined, when object upload is
	 * complete, or to a transaction id, which must be used for subsequent
	 * request(s).
	 * @param objId is object's id, with null value for root object
	 * @param bytes are bytes to upload
	 * @param fstReq is options object for the first request
	 * @param followReq is options object for subsequent request(s)
	 */
	async saveNewObjVersion(
		objId: ObjId, bytes: Uint8Array|Uint8Array[],
		fstReq: FirstSaveReqOpts|undefined,
		followReq: FollowingSaveReqOpts|undefined
	): Promise<string|undefined> {
		let appPath: string;
		if (fstReq) {
			appPath = (objId ?
				api.currentObj.firstPutReqUrlEnd(objId, fstReq):
				api.currentRootObj.firstPutReqUrlEnd(fstReq));
		} else if (followReq) {
			appPath = (objId ?
				api.currentObj.secondPutReqUrlEnd(objId, followReq):
				api.currentRootObj.secondPutReqUrlEnd(followReq));
		} else {
			throw new Error(`Missing request options`);
		}
		
		const rep = await this.doBinarySessionRequest<api.currentObj.ReplyToPut>(
			{ appPath, method: 'PUT', responseType: 'json' }, bytes);
		if (rep.status === api.currentObj.SC.okPut) {
			return rep.data.transactionId;
		} else if (rep.status === api.currentObj.SC.unknownObj) {
			throw makeObjNotFoundExc(objId!);
		} else if (rep.status === api.currentObj.SC.concurrentTransaction) {
			throw makeConcurrentTransExc(objId!);
		} else if (rep.status === api.currentObj.SC.unknownTransaction) {
			throw makeUnknownTransactionExc(objId!);
		} else if (rep.status === api.currentObj.SC.mismatchedObjVer) {
			const curVer = (rep as any as api.currentObj.MismatchedObjVerReply).current_version;
			if (!Number.isInteger(curVer)) { throw new Error(
				`Got non-integer current object version value from a version mismatch reply ${curVer}`); }
			throw makeVersionMismatchExc(objId!, curVer);
		} else {
			throw makeException(rep, 'Unexpected status');
		}
	}
	
	/**
	 * This deletes object from being available as currently existing one.
	 * But, it does not remove archived versions of it, even if current varsion
	 * has been already archived.
	 * @param objId
	 * @return a promise, resolvable, when an object is deleted.
	 */
	async deleteObj(objId: string): Promise<void> {
		const rep = await this.doBodylessSessionRequest<void>({
			appPath: api.currentObj.getReqUrlEnd(objId),
			method: 'DELETE'
		});
		if (rep.status === api.currentObj.SC.okDelete) {
			return;
		} else if (rep.status === api.currentObj.SC.concurrentTransaction) {
			throw makeConcurrentTransExc(objId);
		} else if (rep.status === api.currentObj.SC.unknownObj) {
			throw makeObjNotFoundExc(objId);
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
Object.freeze(StorageOwner.prototype);
Object.freeze(StorageOwner);

Object.freeze(exports);