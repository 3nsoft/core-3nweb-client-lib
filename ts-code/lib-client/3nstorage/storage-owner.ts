/*
 Copyright (C) 2015 - 2017, 2020, 2022, 2025 3NSoft Inc.
 
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
import * as api from '../../lib-common/service-api/3nstorage/owner';
import { ServiceUser, IGetMailerIdSigner, ServiceAccessParams } from '../user-with-mid-session';
import { storageInfoAt } from '../service-locator';
import * as keyGen from '../key-derivation';
import { makeObjNotFoundExc, makeConcurrentTransExc, makeUnknownTransactionExc, makeVersionMismatchExc, makeObjExistsExc, makeObjVersionNotFoundExc } from '../xsp-fs/exceptions';
import { makeSubscriber, SubscribingClient } from '../../lib-common/ipc/ws-ipc';
import { ObjId } from '../xsp-fs/common';
import { assert } from '../../lib-common/assert';
import { LogError } from '../logging/log-to-file';

export type FirstSaveReqOpts = api.PutObjFirstQueryOpts;
export type FollowingSaveReqOpts = api.PutObjSecondQueryOpts;

const storageAccessParams: ServiceAccessParams = {
	login: api.midLogin.MID_URL_PART,
	logout: api.closeSession.URL_END,
	canBeRedirected: true
};


export class StorageOwner extends ServiceUser {
	
	maxChunkSize: number|undefined = undefined;
	
	private constructor(
		user: string, getSigner: IGetMailerIdSigner|undefined,
		mainUrlGetter: () => Promise<string>, net: NetClient
	) {
		super(
			user, storageAccessParams, getSigner,
			serviceUriGetter(net, mainUrlGetter), net
		);
		Object.seal(this);
	}

	static make(
		user: string, getSigner: IGetMailerIdSigner,
		mainUrlGetter: () => Promise<string>, net: NetClient
	): StorageOwner {
		const remote = new StorageOwner(user, getSigner, mainUrlGetter, net);
		return remote;
	}

	static makeBeforeMidSetup(
		user: string,
		mainUrlGetter: () => Promise<string>, net: NetClient
	): {
		remote: StorageOwner; setMid: (getSigner: IGetMailerIdSigner) => void;
	} {
		const remote = new StorageOwner(user, undefined, mainUrlGetter, net);
		return {
			remote,
			setMid: getSigner => remote.setGetterOfSigner(getSigner)
		};
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
	): Promise<{
		version: number; segsTotalLen: number;
		header: Uint8Array; segsChunk: Uint8Array;
	}> {
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
			throw makeObjNotFoundExc(objId!, true);
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
			throw makeObjNotFoundExc(objId!, true);
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
	 * @param fstReq is options object for the first request
	 * @param followReq is options object for subsequent request(s)
	 * @param bytes is an object with header, diff and segs bytes to upload
	 */
	async saveNewObjVersion(
		objId: ObjId,
		fstReq: { ver: number; last?: true; }|undefined,
		followReq: { trans: string; ofs: number; last?: boolean; }|undefined,
		{ header, diff, segs }: {
			header?: Uint8Array; diff?: Uint8Array;
			segs?: Uint8Array|Uint8Array[];
		}
	): Promise<string|undefined> {
		let appPath: string;
		if (fstReq) {
			assert(!!header);
			const { ver, last } = fstReq;
			const reqOpts: FirstSaveReqOpts = {
				ver, last,
				header: header!.length,
				diff: (diff ? diff.length : undefined)
			};
			appPath = (objId ?
				api.currentObj.firstPutReqUrlEnd(objId, reqOpts):
				api.currentRootObj.firstPutReqUrlEnd(reqOpts));
		} else if (followReq) {
			const { ofs, trans, last } = followReq;
			// XXX segs argument will introduce difference between these two
			const reqOpts: FollowingSaveReqOpts = {
				ofs, trans, last
			};
			appPath = (objId ?
				api.currentObj.secondPutReqUrlEnd(objId, reqOpts):
				api.currentRootObj.secondPutReqUrlEnd(reqOpts));
		} else {
			throw new Error(`Missing request options`);
		}

		// ordering body bytes in accordance with protocol expectation
		const bytes: Uint8Array[] = [];
		if (diff) {
			bytes.push(diff);
		}
		if (header) {
			bytes.push(header);
		}
		if (segs) {
			if (Array.isArray(segs)) {
				bytes.push(...segs);
			} else {
				bytes.push(segs);
			}
		}

		const rep = await this.doBinarySessionRequest<api.currentObj.ReplyToPut>(
			{ appPath, method: 'PUT', responseType: 'json' }, bytes);
		if (rep.status === api.currentObj.SC.okPut) {
			return rep.data.transactionId;
		} else if (rep.status === api.currentObj.SC.objAlreadyExists) {
			throw makeObjExistsExc(objId!, undefined, true);
		} else if (rep.status === api.currentObj.SC.unknownObj) {
			throw makeObjNotFoundExc(objId!, true);
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

	async archiveObjVersion(objId: ObjId, currentVer: number): Promise<void> {
		const rep = await this.doBodylessSessionRequest<void>({
			appPath: (objId ?
				api.archiveObj.postAndDelReqUrlEnd(objId, currentVer) :
				api.archiveRoot.postAndDelReqUrlEnd(currentVer)),
			method: 'POST'
		});
		if (rep.status === api.archiveObj.SC.okPost) {
			return;
		} else if (rep.status === api.currentObj.SC.unknownObj) {
			throw makeObjNotFoundExc(objId!, true);
		} else if (rep.status === api.currentObj.SC.unknownObjVer) {
			throw makeObjVersionNotFoundExc(objId!, currentVer, true);
		} else {
			throw makeException(rep, 'Unexpected status');
		}
	}

	async getObjStatus(objId: ObjId): Promise<api.ObjStatus> {
		const rep = await this.doBodylessSessionRequest<api.ObjStatus>({
			appPath: (objId ?
				api.objStatus.getReqUrlEnd(objId) :
				api.rootStatus.getReqUrlEnd()),
			method: 'GET',
			responseType: 'json'
		});
		if (rep.status === api.objStatus.SC.ok) {
			// XXX we may want to add sanity check(s)
			return rep.data;
		} else if (rep.status === api.objStatus.SC.unknownObj) {
			throw makeObjNotFoundExc(objId!, true);
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
			appPath: api.currentObj.delReqUrlEnd(objId),
			method: 'DELETE'
		});
		if ((rep.status === api.currentObj.SC.okDelete)
		|| (rep.status === api.currentObj.SC.unknownObj)) {
			return;
		} else if (rep.status === api.currentObj.SC.concurrentTransaction) {
			throw makeConcurrentTransExc(objId);
		} else {
			throw makeException(rep, 'Unexpected status');
		}
	}

	async openEventSource(): Promise<ReturnType<typeof makeSubscriber>> {
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


function serviceUriGetter(
	net: NetClient, mainUrlGetter: () => Promise<string>
): () => Promise<string> {
	return async () => {
		const serviceUrl = await mainUrlGetter();
		const info = await storageInfoAt(net, serviceUrl);
		if (!info.owner) {
			throw new Error(
				`Missing owner service url in 3NStorage information at ${serviceUrl}`
			);
		}
		return info.owner;
	};
}


Object.freeze(exports);