/*
 Copyright (C) 2025 3NSoft Inc.
 
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

type Keyrings = web3n.keys.Keyrings;
type IntroKeyOnASMailServer = web3n.keys.IntroKeyOnASMailServer;

export function exposeKeyringsCAP(cap: Keyrings): ExposedObj<Keyrings> {
	return {
		introKeyOnASMailServer: exposeIntroKey(cap.introKeyOnASMailServer),
	};
}

function exposeIntroKey(
	cap: Keyrings['introKeyOnASMailServer']
): ExposedObj<IntroKeyOnASMailServer> {
	return {
		getCurrent: wrapReqReplySrvMethod(cap, 'getCurrent'),
		makeAndPublishNew: wrapReqReplySrvMethod(cap, 'makeAndPublishNew'),
		remove: wrapReqReplySrvMethod(cap, 'remove'),
	};
}

function callIntroKeyOnASMailServer<M extends keyof IntroKeyOnASMailServer>(
	caller: Caller, objPath: string[], method: M
): IntroKeyOnASMailServer[M] {
	return makeReqRepObjCaller(caller, objPath, method);
}

function makeIntroKeyCaller(
	caller: Caller, objPath: string[]
): IntroKeyOnASMailServer {
	return {
		getCurrent: callIntroKeyOnASMailServer(caller, objPath, 'getCurrent'),
		makeAndPublishNew: callIntroKeyOnASMailServer(
			caller, objPath, 'makeAndPublishNew'
		),
		remove: callIntroKeyOnASMailServer(caller, objPath, 'remove'),
	};
}

export function makeKeyringsCaller(
	caller: Caller, objPath: string[]
): Keyrings {
	return {
		introKeyOnASMailServer: makeIntroKeyCaller(
			caller, objPath.concat('introKeyOnASMailServer')
		),
	};
}


Object.freeze(exports);