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

import { ExposedFn, Caller } from "../ipc-via-protobuf/connector";
import { ErrorValue, errFromMsg, errToMsg } from "./protobuf-msg";
import { ProtoType } from '../lib-client/protobuf-type';
import { logger as pb } from '../protos/logger.proto';

type Logger = web3n.caps.common.Logger;

interface LogRequest {
	logType: string;
	msg: string;
	err?: ErrorValue;
}
const logReqType = ProtoType.for<LogRequest>(pb.LogRequestBody);

export function exposeLogger(fn: Logger): ExposedFn {
	return buf => {
		const { logType, msg, err } = logReqType.unpack(buf);
		const promise = (err ?
			fn(logType as any, msg, errFromMsg(err)) :
			fn(logType as any, msg));
		return { promise };
	};
}

export function makeLogCaller(caller: Caller, path: string[]): Logger {
	return (type, msg, err) => {
		const req: LogRequest = { logType: type, msg };
		if (err) {
			req.err = errToMsg(err);
		}
		return caller.startPromiseCall(
			path, logReqType.pack(req)) as Promise<void>;
	}
}


Object.freeze(exports);