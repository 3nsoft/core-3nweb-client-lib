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
import { makeIPCException, EnvelopeBody } from './connector';
import { stringifyErr, errWithCause, ErrorWithCause } from '../lib-common/exceptions/error';
import * as fs from 'fs';

type RuntimeException = web3n.RuntimeException;


export class ProtoType<T extends object> {

	private constructor(
		private type: protobuf.Type
	) {
		Object.freeze(this);
	}

	static makeFrom<T extends object>(
		protoFile: string, typeName: string
	): ProtoType<T> {
		const root = loadRoot(protoFile);
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


const protosDir = resolve(__dirname, '../../protos');

const roots = new Map<string, protobuf.Root>();

function loadRoot(fileName: string): protobuf.Root {
	let root = roots.get(fileName);
	if (!root) {
		// if proto files file, we try to get definitions from the module
		try {
			root = protobuf.loadSync(join(protosDir, fileName));
		} catch (err) {
			const protos = require('./proto-defs').protos;
			if (!protos || (typeof protos !== 'object')) { throw new Error(
				`proto-defs doesn't have expected object`); }
			const initFunc = fs.readFileSync;
			try {
				(fs as any).readFileSync = (fName: string): Buffer => {
					const protoDefsStr = protos[fName];
					if (!protoDefsStr) { throw new Error(
						`Don't have in module proto definition for ${fName}`); }
					return Buffer.from(protoDefsStr, 'utf8');
				}
				root = protobuf.loadSync(fileName);
			} finally {
				(fs as any).readFileSync = initFunc;
			}
		}
		roots.set(fileName, root);
	}
	return root;
}

function commonType<T extends object>(type: string): ProtoType<T> {
	return ProtoType.makeFrom<T>('common.proto', `common.${type}`);
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
		const fixedInt = (high * 0xffffffff + low);
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