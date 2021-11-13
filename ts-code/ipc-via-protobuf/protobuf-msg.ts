/*
 Copyright (C) 2020 - 2021 3NSoft Inc.
 
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

import { makeIPCException, EnvelopeBody } from './connector';
import { stringifyErr } from '../lib-common/exceptions/error';
import { toBuffer } from '../lib-common/buffer-utils';
import { ProtoType } from '../lib-client/protobuf-loader';

type RuntimeException = web3n.RuntimeException;

export function makeProtobufTypeFrom<T extends object>(
	protoFile: string, typeName: string
): ProtoType<T> {
	try {
		// make sure to copy protos with compile step (use npm script)
		return ProtoType.makeFrom(__dirname, protoFile, typeName);
	} catch (err) {
		// we won't get here if referenced  module exists, but metro packager
		// in LiqudCore needs static path require
		require('./proto-defs');
		return ProtoType.makeFrom(__dirname, protoFile, typeName);
	}
}

function commonType<T extends object>(type: string): ProtoType<T> {
	return makeProtobufTypeFrom<T>('common.proto', `common.${type}`);
}

export type ExposedObjType = 'FileByteSink' | 'FileByteSource' |
	'FileImpl' | 'FSImpl' | 'SymLinkImpl' | 'FSCollection' | 'FSItemsIter';

export interface ObjectReference {
	objType: ExposedObjType;
	path: string[];
}
export const objRefType = commonType<ObjectReference>('ObjectReference');

export interface BooleanValue {
	value: boolean;
}
export const boolValType = commonType<BooleanValue>('BooleanValue');

export interface StringArrayValue {
	values: string[];
}
export const strArrValType = commonType<StringArrayValue>('StringArrayValue');

export function fixArray<T>(arr: T[]): T[] {
	return (arr ? arr : []);
}

const MAX_HIGH = 0b111111111111111111111;
export function fixInt(uint64: number): number {
	if (typeof uint64 === 'object') {
		const { high, low } = uint64;
		if (high > MAX_HIGH) {
				throw makeIPCException({
					invalidNumInBody: true,
					message: 'Integer is greater than 2^53-1'
				});
		}
		const fixedInt = 0x100000000*high + ((low < 0) ? 0x100000000+low : low);
		if (isNaN(fixedInt)) {
				throw new TypeError(`Can't construct integer from a given object`);
		} else {
				return fixedInt;
		}
	} else if (typeof uint64 === 'string') {
		return Number.parseInt(uint64);
	} else if (typeof uint64 === 'number') {
		return uint64;
	} else {
		throw new TypeError(`Can't extract integer from ${typeof uint64}`);
	}
}
export function valOfOptInt(uint64: Value<number>|undefined): number|undefined {
	if (!uint64) { return; }
	return fixInt(valOf(uint64));
}

const numValType = commonType<Value<number>>('UInt64Value');
export function packInt(uint64: number): Buffer {
	return numValType.pack({ value: uint64 });
}
export function unpackInt(buf: EnvelopeBody): number {
	return fixInt(valOf(numValType.unpack(buf)));
}

export interface ErrorValue {
	runtimeExcJson?: string;
	err?: string;
}
export const errBodyType = commonType<ErrorValue>('ErrorValue');

export function errToMsg(err: any): ErrorValue {
	if (typeof err !== 'object') {
		return { err: JSON.stringify(err) };
	} else if ((err as RuntimeException).runtimeException) {
		return { runtimeExcJson: JSON.stringify(err) };
	} else {
		return { err: stringifyErr(err) };
	}
}
export function errFromMsg(msg: ErrorValue): RuntimeException|Error {
	if (msg.runtimeExcJson) {
		return JSON.parse(msg.runtimeExcJson) as RuntimeException;
	} else {
		return new Error(`Error from other side of ipc:\n${msg.err}`);
	}
}

export interface Value<T> {
	value: T;
}

export function toVal<T>(value: T): Value<T> {
	return { value };
}

export function toOptVal<T>(value: T|undefined): Value<T>|undefined {
	return ((value === undefined) ? undefined : { value });
}

export function valOf<T>(valObj: Value<T>): T {
	return valObj.value;
}

export function valOfOpt<T>(valObj: Value<T>|undefined): T|undefined {
	return (valObj ? valObj.value : undefined);
}

export function valOfOptJson(valObj: Value<string>|undefined): any|undefined {
	try {
		return (valObj ? JSON.parse(valObj.value) : undefined);
	} catch (err) {
		throw makeIPCException({ cause: err, badReply: true });
	}
}

export function toOptJson(json: any): Value<string>|undefined {
	return ((json === undefined) ? undefined : toVal(JSON.stringify(json)));
}

export interface AnyValue {
	json?: Value<string>;
	bytes?: Value<Buffer>;
}

export function toOptAny(value: any|undefined): AnyValue|undefined {
	if (value === undefined) {
		return undefined;
	} else if (Buffer.isBuffer(value)) {
		return { bytes: toVal(value) };
	} else if (ArrayBuffer.isView(value)) {
		return { bytes: toVal(toBuffer(value as Buffer)) };
	} else {
		return { json: toVal(JSON.stringify(value)) };
	}
}

export function valOfOptAny(valObj: AnyValue|undefined): any|undefined {
	if (!valObj) {
		return undefined;
	} else if (valObj.json) {
		return JSON.parse(valOf(valObj.json));
	} else {
		return valOfOpt(valObj.bytes);
	}
}


Object.freeze(exports);