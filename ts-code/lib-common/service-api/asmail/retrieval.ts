/*
 Copyright (C) 2015, 2017, 2019, 2025 3NSoft Inc.
 
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
 * This defines interfaces for mail retrieval requests.
 */

import * as midApi from '../mailer-id/login';
import * as deliveryApi from './delivery';
import { stringify as stringifyOpts } from 'querystring';

export const BIN_TYPE = 'application/octet-stream';

export const HTTP_HEADER = {
	contentType: 'Content-Type',
	contentLength: 'Content-Length',
	objHeaderLength: 'X-Obj-Header-Length',
	objSegmentsLength: 'X-Obj-Segments-Length',
}
Object.freeze(HTTP_HEADER);
export const ERR_SC = {
	malformed: 400,
	needAuth: midApi.ERR_SC.needAuth,
	server: 500
};
Object.freeze(ERR_SC);

export namespace midLogin {

	export const MID_URL_PART = 'login/mailerid/';
	export const START_URL_END = MID_URL_PART + midApi.startSession.URL_END;
	export const AUTH_URL_END = MID_URL_PART + midApi.authSession.URL_END;

}
Object.freeze(midLogin);

export namespace closeSession {

	export const URL_END = 'close-session';

}
Object.freeze(closeSession);

export interface ListMsgsOpts {
	from?: number;
	to?: number;
}

export namespace listMsgs {

	export const EXPRESS_URL_END = 'msg/ids';

	export function genUrlEnd(opts?: ListMsgsOpts): string {
		let optStr = (opts ? '?'+stringifyOpts(opts as any) : '');
		return `msg/ids${optStr}`;
	}

	export interface Reply extends Array<string> {}

	export const SC = {
		ok: 200,
	};
	Object.freeze(SC);

}
Object.freeze(listMsgs);

export namespace rmMsg {

	export const EXPRESS_URL_END = 'msg/:msgId';

	export function genUrlEnd(msgId: string): string {
		return 'msg/'+msgId;
	}

	export const SC = {
		ok: 200,
		unknownMsg: 474
	};
	Object.freeze(SC);

}
Object.freeze(rmMsg);

export interface ObjSize {
	header: number;
	segments: number|undefined;
}

export interface ObjStatus {
	completed?: boolean;
	size: ObjSize;
}

export interface MsgMeta  {
	recipient: string;
	extMeta: deliveryApi.msgMeta.Request;
	deliveryStart: number;
	authSender: string|undefined;
	invite: string|undefined;
	maxMsgLength: number;
	deliveryCompletion?: number;
	objs: { [objId: string]: ObjStatus; };
}

export namespace msgMetadata {

	export const EXPRESS_URL_END = 'msg/:msgId/meta';

	export function genUrlEnd(msgId: string): string {
		return 'msg/'+msgId+'/meta';
	}

	export interface Reply extends MsgMeta {}

	export const SC = {
		ok: 200,
		unknownMsg: 474
	};
	Object.freeze(SC);

}
Object.freeze(msgMetadata);

/**
 * This function returns either a checked version of given meta object, if it
 * passes as message meta, or undefined, otherwise.
 * @param meta is an object that is expected to be message meta
 */
export function sanitizedMeta(meta: MsgMeta): MsgMeta|undefined {
	if (typeof meta !== 'object') { return; }
	if (typeof meta.objs !== 'object') { return; }
	for (const objId of Object.keys(meta.objs)) {
		const st = meta.objs[objId];
		if (typeof st.size.header !== 'number') { return; }
		if (st.completed &&
				(st.size.segments === undefined)) { return; }
	}
	// TODO add more checks and return new object instead of a given one
	return meta;
}

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
}

export namespace msgObj {

	export const EXPRESS_URL_END = 'msg/:msgId/obj/:objId';

	export function genUrlEnd(msgId: string, objId: string,
			opts?: GetObjQueryOpts): string {
		let optStr = (opts ? '?'+stringifyOpts(opts as any) : '');
		return `msg/${msgId}/obj/${objId}${optStr}`;
	}

	export const SC = {
		ok: 200,
		unknownMsgOrObj: 474
	};
	Object.freeze(SC);

}
Object.freeze(msgObj);

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

export namespace msgRecievedCompletely {

	export const EVENT_NAME = 'msg-received-completely';

	export interface Event {
		msgId: string;
	}

}
Object.freeze(msgRecievedCompletely);

// XXX this event should be triggered by big messages with more than one obj
export namespace msgMainObjRecieved {

	export const EVENT_NAME = 'msg-main-obj-received';

	export interface Event {
		msgId: string;
	}

}
Object.freeze(msgMainObjRecieved);

// XXX add event about message removal
//   it is useful in multi-device case, pass implicit implicit signal that will
//   have context-specific meaning.
	
Object.freeze(exports);