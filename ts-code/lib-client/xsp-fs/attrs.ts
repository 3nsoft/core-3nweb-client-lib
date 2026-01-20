/*
 Copyright (C) 2020, 2022, 2026 3NSoft Inc.
 
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

import { assert } from "../../lib-common/assert";
import { toBuffer } from "../../lib-common/buffer-utils";
import { uintFrom6Bytes, uintFrom2Bytes, uintFrom4Bytes, packUintTo6Bytes, packUintTo2Bytes, packUintTo4Bytes, uintFrom3Bytes, packUintTo3Bytes } from "../../lib-common/big-endian";
import { Attrs } from "./node-persistence";
import { getStackHere } from "../../lib-common/exceptions/runtime";

export class CommonAttrs {

	constructor(
		public ctime: number,
		public mtime: number
	) {
		Object.seal(this);
	}

	static makeForTimeNow(): CommonAttrs {
		const now = Date.now();
		return new CommonAttrs(now, now);
	}

	static fromAttrs(attrs: Attrs): CommonAttrs {
		return new CommonAttrs(attrs.ctime, attrs.mtime);
	}

	static readonly PACK_LEN = 6 + 6;

	static parse(bytes: Uint8Array): CommonAttrs {
		if (bytes.length < CommonAttrs.PACK_LEN) {
			throw parsingException(`byte array is too short`);
		}
		const ctime = uintFrom6Bytes(bytes, 0);
		const mtime = uintFrom6Bytes(bytes, 6);
		return new CommonAttrs(ctime, mtime);
	}

	pack(): Buffer {
		const bytes = Buffer.allocUnsafe(CommonAttrs.PACK_LEN);
		packUintTo6Bytes(this.ctime, bytes, 0);
		packUintTo6Bytes(this.mtime, bytes, 6);
		return bytes;
	}

	copy(): CommonAttrs {
		return new CommonAttrs(this.ctime, this.mtime);
	}

	updateMTime(): void {
		this.mtime = Date.now();
	}

}
Object.freeze(CommonAttrs.prototype);
Object.freeze(CommonAttrs);


export class XAttrs {

	private readonly attrs = new Map<string, {
		binVal?: Uint8Array;
		strVal?: string;
		jsonVal?: any;
	}>();

	private constructor() {
		Object.seal(this);
	}

	static makeEmpty(): XAttrs {
		return new XAttrs();
	}

	static parseFrom(sections: Uint8Array[]): XAttrs {
		const xattrs = new XAttrs();
		for (const bytes of sections) {
			let i = 0;
			while (i < bytes.length) {
				const {
					bytesRead, binVal, strVal, jsonVal, xaName
				} = extAttrs.readNamedAttr(toBuffer(bytes), i);
				xattrs.attrs.set(xaName, { binVal, strVal, jsonVal });
				i += bytesRead;
			}
		}
		return xattrs;
	}

	copy(): XAttrs {
		const copy = new XAttrs();
		for (const [xaName, xaVal] of this.attrs.entries()) {
			copy.attrs.set(xaName, xaVal);
		}
		return copy;
	}

	makeUpdated(changes: XAttrsChanges): XAttrs {
		const updated = this.copy();
		if (changes.remove && (changes.remove.length > 0)) {
			for (const xaName of changes.remove) {
				updated.attrs.delete(xaName);
			}
		}
		if (changes.set && (Object.keys(changes.set).length > 0)) {
			for (const [xaName, value] of Object.entries(changes.set)) {
				if (typeof value === 'string') {
					updated.attrs.set(xaName, { strVal: value });
				} else if (Buffer.isBuffer(value) || ArrayBuffer.isView(value)) {
					updated.attrs.set(xaName, { binVal: value as Uint8Array });
				} else if (value !== undefined) {
					updated.attrs.set(xaName, { jsonVal: value });
				}
			
			}
		}
		return updated;
	}

	get(xaName: string): any {
		const val = this.attrs.get(xaName);
		if (!val) {
			return;
		} else if (val.strVal !== undefined) {
			return val.strVal;
		} else if (val.binVal) {
			return val.binVal;
		} else if (val.jsonVal !== undefined) {
			return val.jsonVal;
		}
	}

	list(): string[] {
		return Array.from(this.attrs.keys());
	}

	get isEmpty(): boolean {
		return (this.attrs.size === 0);
	}

	pack(): Uint8Array[]|undefined {
		if (this.isEmpty) { return; }
		const bytes: Uint8Array[] = [];
		for (const [ xaName, v ] of this.attrs.entries()) {
			if (v.strVal !== undefined) {
				bytes.push(extAttrs.packNamedStrAttr(xaName, v.strVal));
			} else if (v.binVal) {
				bytes.push(extAttrs.packNamedBinaryAttr(xaName, v.binVal));
			} else {
				assert(v.jsonVal !== undefined);
				bytes.push(extAttrs.packNamedJsonAttr(xaName, v.jsonVal));
			}
		}
		return bytes;
	}

}
Object.freeze(XAttrs.prototype);
Object.freeze(XAttrs);


type XAttrsChanges = web3n.files.XAttrsChanges;


namespace extAttrs {

	export type XAttrs = { [name: string]: NamedAttr; };
	
	export interface NamedBinaryAttr {
		type: 'named-binary';
		name: string;
		value: Uint8Array;
	}
	
	export interface NamedStringAttr {
		type: 'named-utf8str';
		name: string;
		value: string;
	}
	
	export interface NamedJsonAttr {
		type: 'named-json';
		name: string;
		value: any;
	}
	
	export type NamedAttr = NamedBinaryAttr | NamedStringAttr | NamedJsonAttr;

	const NAMED_BINARY = 1;
	const NAMED_UTF8_STR = 2;
	const NAMED_JSON = 3;

	export function readNamedAttr(bytes: Buffer, i: number): {
		binVal?: Uint8Array; strVal?: string; jsonVal?: any;
		xaName: string, bytesRead: number;
	} {
		const t = parseTypeByte(bytes[i]);

		let ofs = i+1;
		const nameLen = readLenNum(bytes, ofs, t.nameLen);
		ofs += t.nameLen;
		const contentLen = readLenNum(bytes, ofs, t.contentLen);
		ofs += t.contentLen;
		const xaName = bytes.slice(ofs, ofs+nameLen).toString('utf8');
		ofs += nameLen;

		const bytesRead = ofs - i + contentLen;
		if ((contentLen === 0) || (bytes.length < (i + bytesRead))) {
			throw parsingException(`Unexpected end of byte array`);
		}

		try {
			if (t.type === NAMED_UTF8_STR) {
				return {
					bytesRead, xaName,
					strVal: bytes.slice(ofs, ofs+contentLen).toString('utf8'),
				};
			} else if (t.type === NAMED_JSON) {
				return {
					bytesRead, xaName,
					jsonVal: JSON.parse(
						toBuffer(bytes).slice(ofs, ofs+contentLen).toString('utf8')),
				};
			} else if (t.type === NAMED_BINARY) {
				return {
					bytesRead, xaName,
					binVal: bytes.slice(ofs, ofs+contentLen),
				};
			} else {
				throw new Error(`Unknown type ${t.type} of named attribute`);
			}
		} catch (err) {
			throw parsingException(`Error in parsing `, err);
		}
	}

	function parseTypeByte(
		b: number
	): { type: 1|2|3; nameLen: number; contentLen: number; } {
		const type =      ((b & 0b11111000) >> 3) as 1|2|3;
		const nameLen =   ((b & 0b00000100) >> 2) + 1;
		const contentLen = (b & 0b00000011) + 1;
		return { type, contentLen, nameLen };
	}

	function readLenNum(bytes: Uint8Array, i: number, len: number): number {
		switch (len) {
			case 1:
				return bytes[i];
			case 2:
				return uintFrom2Bytes(bytes, i);
			case 3:
				return uintFrom3Bytes(bytes, i);
			case 4:
				return uintFrom4Bytes(bytes, i);
			default:
				throw parsingException(`Too many bytes for xattr length`);
		}
	}

	export function packNamedStrAttr(name: string, value: string): Buffer {
		assert(
			(typeof name === 'string') && (name.length > 0) &&
			(typeof value === 'string')
		);
		const nameBin = Buffer.from(name, 'utf8');
		const valueBin = Buffer.from(value, 'utf8');
		return packNamedAttr(NAMED_UTF8_STR, nameBin, valueBin);
	}
	
	export function packNamedBinaryAttr(
		name: string, value: Uint8Array
	): Buffer {
		assert((typeof name === 'string') && (name.length > 0));
		const nameBin = Buffer.from(name, 'utf8');
		return packNamedAttr(NAMED_BINARY, nameBin, value);
	}
	
	export function packNamedJsonAttr(name: string, value: object): Buffer {
		assert((typeof name === 'string') && (name.length > 0) &&
			(value !== undefined));
		const nameBin = Buffer.from(name, 'utf8');
		const valueBin = Buffer.from(JSON.stringify(value), 'utf8');
		return packNamedAttr(NAMED_JSON, nameBin, valueBin);
	}

	function packNamedAttr(
		type: 1|2|3, name: Buffer, value: Uint8Array
	): Buffer {
		const nameLenLen = byteToStoreLen(name.length);
		if (nameLenLen > 2) { throw new Error(`Name is too long to pack`); }
		const contentLenLen = byteToStoreLen(value.length);
		if (contentLenLen > 4) { throw new Error(`Value is too long to pack`); }
		const b = Buffer.allocUnsafe(1 + nameLenLen + contentLenLen + name.length + value.length);
		// first byte contains, left to right:
		//  - 5 bits with type,
		//  - 1 bits with number of bytes for name length, and
		//  - 2 bits with number of bytes for value length
		b[0] = (type << 3) | ((nameLenLen - 1) << 2) | (contentLenLen - 1);
		// bytes with length of name
		let i = 1
		packUint(name.length, b, i, nameLenLen);
		// bytes with length of content
		i += nameLenLen;
		packUint(value.length, b, i, contentLenLen);
		// bytes with name
		i += contentLenLen;
		b.set(name, i);
		// bytes with content
		i += name.length;
		b.set(value, i);
		return b;
	}

	function byteToStoreLen(len: number): number {
		if (len <= 0xff) { return 1; }
		else if (len <= 0xffff) { return 2; }
		else if (len <= 0xffffff) { return 3; }
		else if (len <= 0xffffffff) { return 4; }
		else { return 5; }
	}

	function packUint(u: number, b: Buffer, i: number, byteToUse: number): void {
		switch (byteToUse) {
			case 1:
				b[i] = u;
				break;
			case 2:
				packUintTo2Bytes(u, b, i);
				break;
			case 3:
				packUintTo3Bytes(u, b, i);
				break;
			case 4:
				packUintTo4Bytes(u, b, i);
				break;
			default:
				assert(false);
		}
	}

}
Object.freeze(extAttrs);


interface AttrsParsingException extends web3n.RuntimeException {
	type: 'attrs-parsing',
	msg: string;
}

function parsingException(msg: string, cause?: any): AttrsParsingException {
	return {
		runtimeException: true,
		type: 'attrs-parsing',
		cause, msg,
		stack: getStackHere(1)
	};
}


Object.freeze(exports);