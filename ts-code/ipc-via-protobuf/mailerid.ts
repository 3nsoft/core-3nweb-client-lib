/*
 Copyright (C) 2020, 2022 3NSoft Inc.
 
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

import { ExposedFn, Caller, makeIPCException, ExposedObj } from "./connector";
import { ProtoType } from '../lib-client/protobuf-type';
import { mailerid as pb } from '../protos/mailerid.proto';

type MailerId = web3n.mailerid.Service;

export function exposeMailerIdCAP(cap: MailerId): ExposedObj<MailerId> {
	return {
		getUserId: getUserId.wrapService(cap.getUserId),
		login: login.wrapService(cap.login)
	};
}

export function makeMailerIdCaller(
	caller: Caller, objPath: string[]
): MailerId {
	return {
		getUserId: getUserId.makeCaller(caller, objPath),
		login: login.makeCaller(caller, objPath)
	};
}


namespace getUserId {

	export function wrapService(fn: MailerId['getUserId']): ExposedFn {
		return () => {
			const promise = fn()
			.then(userId => Buffer.from(userId, 'utf8'));
			return { promise };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): MailerId['getUserId'] {
		const path = objPath.concat('getUserId');
		return () => caller.startPromiseCall(path, undefined)
		.then(buf => {
			if (!buf) { throw makeIPCException({ missingBodyBytes: true }); }
			return buf.toString('utf8');
		});
	}

}
Object.freeze(getUserId);


namespace login {

	interface Request {
		serviceUrl: string;
	}

	interface Reply {
		sessionId: string;
	}


	const requestType = ProtoType.for<Request>(pb.LoginRequestBody);
	const replyType = ProtoType.for<Reply>(pb.LoginReplyBody);

	export function wrapService(fn: MailerId['login']): ExposedFn {
		return bytes => {
			const { serviceUrl } = requestType.unpack(bytes);
			const promise = fn(serviceUrl)
			.then(sessionId => replyType.pack({ sessionId }));
			return { promise };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): MailerId['login'] {
		const path = objPath.concat('login');
		return async serviceUrl => {
			const req = requestType.pack({ serviceUrl });
			const buf = await caller.startPromiseCall(path, req)
			return replyType.unpack(buf).sessionId;
		}
	}

}
Object.freeze(getUserId);


Object.freeze(exports);