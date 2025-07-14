/*
 Copyright (C) 2020, 2022, 2024 3NSoft Inc.
 
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

import { Caller, ExposedObj } from "../../ipc-via-protobuf/connector";
import { makeReqRepObjCaller } from "../../core-ipc/json-ipc-wrapping/caller-side-wrap";
import { wrapReqReplySrvMethod } from "../../core-ipc/json-ipc-wrapping/service-side-wrap";

type MailerId = web3n.mailerid.Service;

export function exposeMailerIdCAP(cap: MailerId): ExposedObj<MailerId> {
	return {
		getUserId: wrapReqReplySrvMethod(cap, 'getUserId'),
		login: wrapReqReplySrvMethod(cap, 'login'),
		sign: wrapReqReplySrvMethod(cap, 'sign'),
		verifySignature: wrapReqReplySrvMethod(cap, 'verifySignature')
	};
}

function callMailerId<M extends keyof MailerId>(
	caller: Caller, objPath: string[], method: M
): MailerId[M] {
	return makeReqRepObjCaller<MailerId, M>(caller, objPath, method);
}

export function makeMailerIdCaller(
	caller: Caller, objPath: string[]
): MailerId {
	return {
		getUserId: callMailerId(caller, objPath, 'getUserId'),
		login: callMailerId(caller, objPath, 'login'),
		sign: callMailerId(caller, objPath, 'sign'),
		verifySignature: callMailerId(caller, objPath, 'verifySignature')
	};
}


Object.freeze(exports);