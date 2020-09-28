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

import * as protobuf from 'protobufjs';
import { join, resolve } from 'path';
import { makeIPCException, EnvelopeBody, Envelope } from './connector';
import { stringifyErr, errWithCause, ErrorWithCause } from '../lib-common/exceptions/error';

type RuntimeException = web3n.RuntimeException;


export class ProtoType<T extends object> {

	private constructor(
		private type: protobuf.Type
	) {
		Object.freeze(this);
	}

	private static roots = new Map<string, protobuf.Root>();

	static makeFrom<T extends object>(
		protoFile: string, typeName: string
	): ProtoType<T> {
		let root = ProtoType.roots.get(protoFile);
		if (!root) {
			root = protobuf.loadSync(protoFile);
			ProtoType.roots.set(protoFile, root);
		}
		const type = root.lookupType(typeName);
		return new ProtoType<T>(type);
	}

	pack(msg: T): Buffer {
		const err = this.type.verify(msg);
		if (err) { throw new Error(err); }
		return this.type.encode(msg).finish() as Buffer;
	}

	unpack(bytes: Buffer|void): T {
		if (!bytes) { throw makeIPCException({ missingBodyBytes: true }); }
		return this.type.decode(bytes) as T;
	}

	packToBase64(msg: T): string {
		return this.pack(msg).toString('base64');
	}

	unpackFromBase64(str: string): T {
		return this.unpack(Buffer.from(str, 'base64'));
	}

}
Object.freeze(ProtoType.prototype);
Object.freeze(ProtoType);


const commonProtos = join(resolve(__dirname, '../../protos'), 'common.proto');
function commonType<T extends object>(type: string): ProtoType<T> {
	return ProtoType.makeFrom<T>(commonProtos, `common.${type}`);
}

export type ExposedObjType = 'FileByteSink' | 'FileByteSource' |
	'UnsubscribeFn' | 'Observer' | 'FileImpl' | 'FSImpl' | 'SymLinkImpl' |
	'FSCollection' | 'FSItemsIter';

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

type Long = { high: number; low: number; };
const MAX_HIGH = 0b111111111111111111111;
export function fixInt(uint64: number): number {
	const { high, low } = uint64 as any as Long;
	if (high > MAX_HIGH) {
		throw makeIPCException({
			invalidNumInBody: true,
			message: 'Integer is greater than 2^53-1'
		});
	}
	return (high*0xffffffff + low);
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
export function errFromMsg(msg: ErrorValue): RuntimeException|ErrorWithCause {
	if (msg.runtimeExcJson) {
		return JSON.parse(msg.runtimeExcJson) as RuntimeException;
	} else {
		return errWithCause(msg.err, 'Error from other side of ipc');
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
	return ((json === undefined) ?
		undefined : toVal(JSON.stringify(json)));
}


Object.freeze(exports);