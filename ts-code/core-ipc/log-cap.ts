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

import { ExposedFn, Caller } from "../ipc-via-protobuf/connector";
import { stringifyErr } from "../lib-common/exceptions/error";
import { makeReqRepFuncCaller } from "./json-ipc-wrapping/caller-side-wrap";
import { wrapReqReplyFunc } from "./json-ipc-wrapping/service-side-wrap";

type Logger = web3n.caps.common.Logger;

export function exposeLogger(fn: Logger): ExposedFn {
	return wrapReqReplyFunc(fn);
}

export function makeLogCaller(caller: Caller, path: string[]): Logger {
	const log = makeReqRepFuncCaller<Logger>(caller, path);
	return (type, msg, err) => log(type, msg, stringifyErr(err)).catch(noop);
}

function noop() {}


Object.freeze(exports);