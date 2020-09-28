/*
 Copyright (C) 2015, 2017, 2019 3NSoft Inc.
 
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
 * This defines interfaces for mail delivery requests.
 */

import * as jwk from '../../jwkeys';
import * as config from './config';
import { stringify as stringifyOpts } from 'querystring';

export const HTTP_HEADER = {
	contentType: 'Content-Type',
	contentLength: 'Content-Length',
}
Object.freeze(HTTP_HEADER);

export const ERR_SC = {
	duplicateReq: 475,
	earlyReq: 476,
	malformed: 400,
	needSession: 401,
	server: 500,
	contentTooLong: 413,
	contentLenMissing: 411,
	wrongContentType: 415,
	objIncomplete: 479
};
Object.freeze(ERR_SC);

export namespace preFlight {
	
	export const URL_END = 'pre-flight';
	
	export interface Request extends sessionStart.Request { }
	
	export interface Reply {
		maxMsgLength: number;
	}
	
	export interface RedirectReply {
		redirect: string;
	}
	
	export const SC = {
		ok: 200,
		unknownRecipient: 474,
		senderNotAllowed: 403,
		inboxFull: 480,
		redirect: 373
	};
	Object.freeze(SC);
	
}
Object.freeze(preFlight);

export namespace sessionStart {
	
	export const URL_END = 'start-session';
	
	export interface Request {
		sender?: string;
		recipient: string;
		invitation?: string;
	}
	
	export interface Reply extends preFlight.Reply {
		sessionId: string;
	}
	
	export interface RedirectReply extends preFlight.RedirectReply {}
	
	export const SC = preFlight.SC;
	
}
Object.freeze(sessionStart);

export namespace sessionRestart {
	
	export const URL_END = 'restart-session';
	
	export interface Request {
		recipient: string;
		msgId: string;
	}
	
	export interface Reply extends preFlight.Reply {
		sessionId: string;
		maxChunkSize? : number;
	}
	
	export interface RedirectReply extends preFlight.RedirectReply {}
	
	export const SC = {
		ok: 200,
		unknownRecipient: 474,
		unknownMsg: 473,
		redirect: 373
	};
	Object.freeze(SC);
	
}
Object.freeze(sessionRestart);

export namespace authSender {
	
	export const URL_END = 'authorize-sender';
	
	export interface Request {
		assertion: jwk.SignedLoad;
		userCert: jwk.SignedLoad;
		provCert: jwk.SignedLoad;
	}
	
	export const SC = {
		ok: 200,
		authFailed: 403
	};
	Object.freeze(SC);
	
}
Object.freeze(authSender);

export namespace initPubKey {
	
	export const URL_END = 'init-pub-key';
	
	export interface Reply extends config.p.initPubKey.Certs {}
	
	export const SC = {
		ok: 200,
		pkeyNotRegistered: 474
	};
	Object.freeze(SC);
	
}
Object.freeze(initPubKey);

export namespace msgMeta {
	
	export const URL_END = 'msg/meta';
	
	export interface CryptoInfo {
		pid?: string;
		recipientKid?: string;
		senderPKey?: string;
	}
	
	export interface Request extends CryptoInfo {
		objIds: string[];
	}
	
	export interface Reply {
		msgId: string;
		maxChunkSize? : number;
	}
	
	export const SC = {
		ok: 201
	};
	
}
Object.freeze(msgMeta);

export interface PutObjFirstQueryOpts {

	/**
	 * This is a length of header, when it is sent in a request.
	 * Header must be sent with the first request, located in http body start.
	 */
	header: number;

	/**
	 * This is a boolean flag, which true value indicates that this is the last
	 * request in sending the object.
	 */
	last?: boolean;

}

export interface PutObjSecondQueryOpts {

	/**
	 * This is an offset into segments.
	 */
	ofs: number;

	/**
	 * This is a boolean flag, which true value indicates that this is the last
	 * request in sending the object.
	 */
	last?: boolean;

}

export namespace msgObj {
	
	export const EXPRESS_URL_END = 'msg/obj/:objId';
	
	export function firstPutReqUrlEnd(objId: string,
			opts: PutObjFirstQueryOpts): string {
		return `msg/obj/${objId}?${stringifyOpts(opts as any)}`;
	}
	
	export function secondPutReqUrlEnd(objId: string,
			opts: PutObjSecondQueryOpts): string {
		return `msg/obj/${objId}?${stringifyOpts(opts as any)}`;
	}
	
	export const SC = {
		ok: 201,
		objAlreadyExists: 473,
		unknownObj: 474
	};
	Object.freeze(SC);
	
}
Object.freeze(msgObj);

export namespace completion {
	
	export const URL_END = 'msg-complete';
	
	export const SC = {
		ok: 200,
	};
	Object.freeze(SC);
	
}
Object.freeze(completion);

export interface ErrorReply {
	error: string;
}

Object.freeze(exports);