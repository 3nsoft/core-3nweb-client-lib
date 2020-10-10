/*
 Copyright (C) 2020 3NSoft Inc.
 
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

import { ExposedFn, ObjectsConnector } from "../ipc-via-protobuf/connector";
import { join, resolve } from "path";
import { ProtoType, ErrorValue, errFromMsg, errToMsg } from "./protobuf-msg";

type Logger = web3n.caps.common.Logger;

function loggerType<T extends object>(type: string): ProtoType<T> {
	return ProtoType.makeFrom<T>('logger.proto', `logger.${type}`);
}

interface LogRequest {
	logType: string;
	msg: string;
	err?: ErrorValue;
}
const logReqType = loggerType<LogRequest>('LogRequestBody');

export function exposeLogger(fn: Logger): ExposedFn {
	return buf => {
		const { logType, msg, err } = logReqType.unpack(buf);
		const promise = (err ?
			fn(logType as any, msg, errFromMsg(err)) :
			fn(logType as any, msg));
		return { promise };
	};
}

export function makeLogCaller(
	connector: ObjectsConnector, path: string[]
): Logger {
	return (type, msg, err) => {
		const req: LogRequest = { logType: type, msg };
		if (err) {
			req.err = errToMsg(err);
		}
		return connector.startPromiseCall(
			path, logReqType.pack(req)) as Promise<void>;
	}
}


Object.freeze(exports);