/*
 Copyright (C) 2015 - 2017, 2019, 2022 3NSoft Inc.
 
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
 * This defines interfaces for 3nstorage owner's requests.
 */

import * as midApi from '../mailer-id/login';
import { stringify as stringifyOpts } from 'querystring';

export const ERR_SC = {
	malformed: 400,
	needAuth: midApi.ERR_SC.needAuth,
	server: 500,
	contentTooLong: 413,
	contentLenMissing: 411,
	wrongContentType: 415,
	noSpace: 480
};
Object.freeze(ERR_SC);

export const HTTP_HEADER = {
	contentType: 'Content-Type',
	contentLength: 'Content-Length',
	objVersion: 'X-Obj-Version',
	objDiffLength: 'X-Obj-Diff-Length',
	objHeaderLength: 'X-Obj-Header-Length',
	objSegmentsLength: 'X-Obj-Segments-Length',
}
Object.freeze(HTTP_HEADER);

export const BIN_TYPE = 'application/octet-stream';

export namespace midLogin {

	export const MID_URL_PART = 'login/mailerid/';
	export const START_URL_END = MID_URL_PART + midApi.startSession.URL_END;
	export const AUTH_URL_END = MID_URL_PART + midApi.authSession.URL_END;

}
Object.freeze(midLogin);

export namespace closeSession {
	
	export const URL_END = 'session/close';
	
}
Object.freeze(closeSession);

export namespace sessionParams {

	export const URL_END = 'session/params';

	export interface Reply {
		maxChunkSize: number;
	}

	export const SC = {
		ok: 200,
	};
	Object.freeze(SC);

}
Object.freeze(sessionParams);

export const PARAM_SC = {
	ok: 200
};
Object.freeze(PARAM_SC);

export namespace keyDerivParams {

	export const URL_END = 'param/key-deriv';

}
Object.freeze(keyDerivParams);

export interface GetObjQueryOpts {
	/**
	 * This is a boolean flag, which true value indicates that header should be
	 * present in a response. If it is false, or is not present, header is not
	 * included in a reply.
	 */
	header?: boolean;
	
	/**
	 * This is an offset into segments. If it is not present, zero is assumed.
	 * This field must be zero or missing, when header is true.
	 */
	ofs?: number;

	/**
	 * This is a limit on number of segment bytes to be returned.
	 */
	limit?: number;

	/**
	 * This is a particular object version.
	 * This field must be present when getting archived version.
	 * When getting current version, this field is optional. If it is present,
	 * an error is returned when current version doesn't match a given one. If
	 * it is not present, then a current version is unconditionally returned,
	 * with http header indicating what this version is.
	 */
	ver?: number;
}

export interface PutObjFirstQueryOpts {

	/**
	 * This parameter is object's new version.
	 */
	ver: number;

	/**
	 * This is a length of diff, if it is sent in a request.
	 * Diff must be sent with the first request.
	 * Diff is located in http body at the very start.
	 */
	diff?: number;

	/**
	 * This is a length of header, when it is sent in a request.
	 * Header must be sent with the first request, located in http body after
	 * diff, if it is present, or at body's start.
	 */
	header: number;

	/**
	 * This field indicates the last request, closing transaction.
	 */
	last?: boolean;

}

export interface PutObjSecondQueryOpts {

	/**
	 * This is a transaction id. It is returned by server as a reply to first
	 * inconclusive request, and must be present in all subsequent requests.
	 */
	trans: string;

	/**
	 * This is an offset into segments.
	 */
	ofs: number;

	/**
	 * This field indicates the last request, closing transaction.
	 */
	last?: boolean;

}

export namespace currentObj {

	export const EXPRESS_URL_END = 'obj/:objId/current';

	export function getReqUrlEnd(objId: string, opts?: GetObjQueryOpts): string {
		return `obj/${objId}/current${opts ? `?${stringifyOpts(opts as any)}`: ''}`;
	}

	export function delReqUrlEnd(
		objId: string, ver?: number
	): string {
		return `obj/${objId}/current${ver ? `?${stringifyOpts({ ver })}`: ''}`;
	}

	export function firstPutReqUrlEnd(
		objId: string, opts: PutObjFirstQueryOpts
	): string {
		return `obj/${objId}/current?${stringifyOpts(opts as any)}`;
	}

	export function secondPutReqUrlEnd(
		objId: string, opts: PutObjSecondQueryOpts
	): string {
		return `obj/${objId}/current?${stringifyOpts(opts as any)}`;
	}

	export interface ReplyToPut {
		/**
		 * Transaction id field is present, when transaction hasn't been completed
		 * with this request, i.e. if it is still ongoing.
		 * This field should be missing, when request 
		 */
		transactionId?: string;
	}

	export const SC = {
		okGet: 200,
		okDelete: 200,
		okPut: 201,
		objAlreadyExists: 473,
		unknownObj: 474,
		concurrentTransaction: 483,
		unknownTransaction: 484,
		unknownObjVer: 494,
		mismatchedObjVer: 495,
		objIncomplete: 479
	};
	Object.freeze(SC);

	export interface MismatchedObjVerReply extends ErrorReply {
		current_version: number;
	}

}
Object.freeze(currentObj);

export namespace currentRootObj {

	export const EXPRESS_URL_END = 'root/current';

	export function getReqUrlEnd(opts?: GetObjQueryOpts): string {
		return `root/current${opts ? `?${stringifyOpts(opts as any)}`: ''}`;
	}

	export function firstPutReqUrlEnd(opts: PutObjFirstQueryOpts): string {
		return `root/current?${stringifyOpts(opts as any)}`;
	}

	export function secondPutReqUrlEnd(opts: PutObjSecondQueryOpts): string {
		return `root/current?${stringifyOpts(opts as any)}`;
	}

	export type ReplyToPut = currentObj.ReplyToPut;

	export const SC = currentObj.SC;

	export type MismatchedObjVerReply = currentObj.MismatchedObjVerReply;

}
Object.freeze(currentRootObj);

export namespace archivedObjVersion {

	export const EXPRESS_URL_END = '/obj/:objId/archived';

	export function getReqUrlEnd(
		objId: string, opts: GetObjQueryOpts
	): string {
		return `/obj/${objId}/archived?${stringifyOpts(opts as any)}`;
	}

	export const SC = {
		okGet: 200,
		unknownObj: 474,
		unknownObjVer: 494
	};

}
Object.freeze(archivedObjVersion);

export namespace archivedRootVersion {

	export const EXPRESS_URL_END = 'root/archived';

	export function getReqUrlEnd(opts: GetObjQueryOpts): string {
		return `root/archived?${stringifyOpts(opts as any)}`;
	}

	export const SC = archivedObjVersion.SC;

}
Object.freeze(archivedRootVersion);

export interface DiffInfo {
	
	/**
	 * This is base version for this diff.
	 */
	baseVersion: number;
	
	/**
	 * This is a length of segments, calculable from sections.
	 */
	segsSize: number;

	/**
	 * Sector is described by number array with three elements:
	 * 0th element is 0 for base bytes, and 1 for new bytes;
	 * 1st element is an offset in base/new byte array;
	 * 2nd element is a length of the sector.
	 */
	sections: [ 0|1, number, number ][];
}

/**
 * This functions returns either a checked version of given diff object, if it
 * passes as diff, or undefined, otherwise.
 * @param diff is an object that is expected to be diff
 * @param version is diff's object's version
 */
export function sanitizedDiff(
	diff: DiffInfo, version: number
): DiffInfo|undefined {
	if ((typeof diff !== 'object') || (diff === null)) { return; }
	if (!Number.isInteger(diff.baseVersion) || (diff.baseVersion < 1) ||
		(diff.baseVersion >= version)) { return; }
	if (!Array.isArray(diff.sections) || (diff.sections.length < 1)) { return; }
	let expSegs = 0;
	for (const section of diff.sections) {
		if (section.length !== 3) { return; }
		const [ isNew, sOfs, len ] = section;
		if ((isNew !== 0) && (isNew !== 1)) { return; }
		if (!Number.isInteger(sOfs) || (sOfs < 0)) { return; }
		if (!Number.isInteger(len) || (len < 1)) { return; }
		expSegs += len;
	}
	if (diff.segsSize !== expSegs) { return; }
	return {
		baseVersion: diff.baseVersion,
		segsSize: diff.segsSize,
		sections: diff.sections
	};
}

export function addDiffSectionTo(
	sections: number[][], newBytes: boolean, srcPos: number, len: number
): void {
	sections.push([ (newBytes ? 1 : 0), srcPos, len ]);
} 

export namespace cancelTransaction {

	export const EXPRESS_URL_END = 'obj/:objId/current/cancel-transaction/:transactionId';

	export function getReqUrlEnd(objId: string, transactionId?: string): string {
		return (transactionId ?
			`obj/${objId}/current/cancel-transaction/${transactionId}` :
			`obj/${objId}/current/cancel-transaction/-`);
	}

	export const SC = {
		ok: 200,
		missing: 474
	};
	Object.freeze(SC);

}
Object.freeze(cancelTransaction);

export namespace cancelRootTransaction {

	export const EXPRESS_URL_END = 'root/current/cancel-transaction/:transactionId';

	export function getReqUrlEnd(transactionId?: string): string {
		return (transactionId ?
			`root/current/cancel-transaction/${transactionId}` :
			`root/current/cancel-transaction/-`);
	}

	export const SC = cancelTransaction.SC;

}
Object.freeze(cancelRootTransaction);

export interface ObjStatus {
	current?: number;
	archived?: number[];
}

export namespace objStatus {

	export const EXPRESS_URL_END = 'obj/:objId/status';

	export function getReqUrlEnd(objId: string): string {
		return `obj/${objId}/status`;
	}

	export type Reply = ObjStatus;

	export const SC = {
		ok: 200,
		unknownObj: 474,
	};

}
Object.freeze(objStatus);

export namespace rootStatus {

	export const EXPRESS_URL_END = 'root/status';

	export function getReqUrlEnd(): string {
		return 'root/status';
	}

	export type Reply = ObjStatus;

	export const SC = objStatus.SC;

}
Object.freeze(rootStatus);

export namespace archiveObj {

	export const EXPRESS_URL_END = 'obj/:objId/archive';

	export function postAndDelReqUrlEnd(objId: string, version: number): string {
		return `obj/${objId}/archive?ver=${version}`;
	}

	export type VersionsList = number[];

	export const SC = {
		okPost: 200,
		okDelete: 200,
		unknownObj: 474,
		unknownObjVer: 494
	};

}
Object.freeze(archiveObj);

export namespace archiveRoot {

	export const EXPRESS_URL_END = 'root/archive';

	export function postAndDelReqUrlEnd(version: number): string {
		return `root/archive?ver=${version}`;
	}

	export type VersionsList = archiveObj.VersionsList;

	export const SC = archiveObj.SC;

}
Object.freeze(archiveRoot);

export interface ErrorReply {
	error: string;
}

export namespace wsEventChannel {

	export const URL_END = 'events';

	export const SC = {
		ok: 200,
	};
	Object.freeze(SC);

}
Object.freeze(wsEventChannel);

export namespace events {

	export namespace objChanged {

		export const EVENT_NAME = 'obj-changed';

		export interface Event {
			/**
			 * This indentifies a non-root object by its string id, while null
			 * value identifies root object.
			 */
			objId: string|null;
			/**
			 * New current version on the server.
			 */
			newVer: number;
		}

	}
	Object.freeze(objChanged);

	export namespace objRemoved {

		export const EVENT_NAME = 'obj-removed';

		export interface Event {
			/**
			 * This indentifies a removed non-root object by its string id.
			 */
			objId: string;
		}

	}
	Object.freeze(objRemoved);

	export namespace objVersionArchived {

		export const EVENT_NAME = 'obj-ver-archived';

		export interface Event {
			/**
			 * This indentifies a non-root object by its string id, while null
			 * value identifies root object.
			 */
			objId: string|null;
			/**
			 * Version that was set archived on the server.
			 */
			archivedVer: number;
		}

	}
	Object.freeze(objVersionArchived);

	export namespace objArchivedVersionRemoved {

		export const EVENT_NAME = 'obj-ver-removed';

		export interface Event {
			/**
			 * This indentifies a non-root object by its string id, while null
			 * value identifies root object.
			 */
			objId: string|null;
			/**
			 * Archived version that was removed on the server.
			 */
			archivedVer: number;
		}

	}
	Object.freeze(objArchivedVersionRemoved);

	export const all = [
		objChanged.EVENT_NAME,
		objRemoved.EVENT_NAME,
		objVersionArchived.EVENT_NAME,
		objArchivedVersionRemoved.EVENT_NAME,
	];

	export type EventNameType =
		(typeof objChanged.EVENT_NAME) |
		(typeof objRemoved.EVENT_NAME) |
		(typeof objVersionArchived.EVENT_NAME) |
		(typeof objArchivedVersionRemoved.EVENT_NAME);

	export type AllTypes =
		objChanged.Event |
		objRemoved.Event |
		objVersionArchived.Event |
		objArchivedVersionRemoved.Event;

}
Object.freeze(events);

Object.freeze(exports);