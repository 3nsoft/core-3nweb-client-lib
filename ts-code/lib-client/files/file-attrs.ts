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
 this program. If not, see <http://www.gnu.org/licenses/>. */

import { assert } from "../../lib-common/assert";
import { toBuffer } from "../../lib-common/buffer-utils";
import { uintFrom6Bytes, uintFrom2Bytes, uintFrom4Bytes, packUintTo6Bytes, packUintTo8Bytes, packUintTo2Bytes, packUintTo4Bytes, uintFrom8Bytes, uintFrom5Bytes, uintFrom3Bytes, uintFrom7Bytes, packUintTo3Bytes, packUintTo5Bytes, packUintTo7Bytes } from "../../lib-common/big-endian";
import { copy as copyJSON } from '../../lib-common/json-utils';

/*
 * Structure of attributes array shall be as follows:
 * - FS entity type byte with value not larger than 127.
 * - Bytes with attributes.
 * - Optional pad starts with zero type byte, going to the end of attributes'
 *   buffer.
 */

type FSEntityType = 'folder-json-v1' | 'link-json-v1' |
	'file-v1-continuous' | 'file-v1-w-layout';

// FS entity type values (xx_FSE)
const FOLDER_JSON_V1_FSE = 0x01;
// const FOLDER_BIN_V1_FSE = 0x02;
const LINK_JSON_V1_FSE = 0x11;
// const LINK_BIN_V1_FSE = 0x12;
const FILE_V1_CONTINUOUS_FSE = 0x21;
const FILE_V1_WITH_LAYOUT_FSE = 0x22;
// const FILE_V1_STREAMED_FSE = 0x23;

export interface EntityAttrs {
	type: FSEntityType;
	ctime: number;
	mtime: number;
	ext: { [name: string]: NamedAttr; };
}

export interface FileAttrs extends EntityAttrs {
	type: 'file-v1-continuous' | 'file-v1-w-layout';
	size?: number;
	layoutOfs?: number;
}

export interface FolderAttrs extends EntityAttrs {
	type: 'folder-json-v1';
}

export interface LinkAttrs extends EntityAttrs {
	type: 'link-json-v1';
}

export type Attrs = FolderAttrs | FileAttrs | LinkAttrs;

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

export function attrType(value: any): NamedAttr['type'] {
	if (typeof value === 'string') {
		return 'named-utf8str';
	} else if (Buffer.isBuffer(value) || ArrayBuffer.isView(value)) {
		return 'named-binary';
	} else {
		return 'named-json';
	}
}

export function makeFileAttrs(now: number): FileAttrs {
	const attrs: FileAttrs = makeAttrs('file-v1-continuous', now);
	attrs.size = 0;
	return attrs;
}

export function makeFolderAttrs(now: number): FolderAttrs {
	return makeAttrs('folder-json-v1', now);
}

export function makeLinkAttrs(now: number): LinkAttrs {
	return makeAttrs('link-json-v1', now);
}

function makeAttrs<T extends EntityAttrs>(
	type: FSEntityType, now: number
): T {
	return { type, ctime: now, mtime: now, ext: {} } as T;
}

function readAttrs(bytes: Buffer): Attrs {
	if (bytes.length < 1) { throw parsingException(`byte array is empty`); }
	const fseByte = bytes[0];
	bytes = bytes.slice(1);
	if (fseByte === FOLDER_JSON_V1_FSE) {
		return attrV1.readFolderAttrs(bytes, 'folder-json-v1');
	} else if (fseByte === LINK_JSON_V1_FSE) {
		return attrV1.readLinkAttrs(bytes, 'link-json-v1');
	} else if (fseByte === FILE_V1_CONTINUOUS_FSE) {
		return attrV1.readFileAttrs(bytes, 'file-v1-continuous');
	} else if (fseByte === FILE_V1_WITH_LAYOUT_FSE) {
		return attrV1.readFileAttrs(bytes, 'file-v1-w-layout');
	} else {
		throw parsingException(`Type byte ${fseByte} isn't recognized`);
	}
}

namespace attrV1 {

	export function readFolderAttrs(
		bytes: Buffer, type: 'folder-json-v1'
	): FolderAttrs {
		const { ctime, mtime, commAttrBytes: ofs } = readCommonAttrs(bytes);
		const ext = readNamedAttrs(bytes, ofs);
		return { type, ctime, mtime, ext };
	}

	export function readLinkAttrs(
		bytes: Buffer, type: 'link-json-v1'
	): LinkAttrs {
		const { ctime, mtime, commAttrBytes: ofs } = readCommonAttrs(bytes);
		const ext = readNamedAttrs(bytes, ofs);
		return { type, ctime, mtime, ext };
	}

	export function readFileAttrs(
		bytes: Buffer, type: 'file-v1-continuous' | 'file-v1-w-layout'
	): FileAttrs {
		const { ctime, mtime, commAttrBytes } = readCommonAttrs(bytes);
		let ofs = commAttrBytes;
		const sizeOrLayoutOfs = uintFrom8Bytes(bytes, ofs);
		ofs += 8;
		const ext = readNamedAttrs(bytes, ofs);
		if (type === 'file-v1-continuous') {
			return { type, ctime, mtime, ext, size: sizeOrLayoutOfs };
		} else if (type === 'file-v1-w-layout') {
			return { type, ctime, mtime, ext, layoutOfs: sizeOrLayoutOfs };
		} else {
			throw new Error(`Unknown type`);
		}
	}

	function readCommonAttrs(
		bytes: Buffer
	): { ctime: number; mtime: number; commAttrBytes: number; } {
		if (bytes.length < (6+6)) { throw parsingException(
			`byte array is empty`); }
		const ctime = uintFrom6Bytes(bytes, 0);
		const mtime = uintFrom6Bytes(bytes, 6);
		return { ctime, mtime, commAttrBytes: 12 };
	}

	function writeCommonAttrs(bytes: Buffer, attrs: Attrs): number {
		if (attrs.type === 'file-v1-continuous') {
			bytes[0] = FILE_V1_CONTINUOUS_FSE;
		} else if (attrs.type === 'file-v1-w-layout') {
			bytes[0] = FILE_V1_WITH_LAYOUT_FSE;
		} else if (attrs.type === 'folder-json-v1') {
			bytes[0] = FOLDER_JSON_V1_FSE;
		} else if (attrs.type === 'link-json-v1') {
			bytes[0] = LINK_JSON_V1_FSE;
		} else {
			throw new Error(`Attribute type is not known`);
		}
		let ofs = 1;
		packUintTo6Bytes(attrs.ctime, bytes, ofs);
		ofs += 6;
		packUintTo6Bytes(attrs.mtime, bytes, ofs);
		ofs += 6;
		if (attrs.type === 'file-v1-continuous') {
			assert(Number.isInteger(attrs.size!) && (attrs.size! >= 0));
			packUintTo8Bytes(attrs.size!, bytes, ofs);
			ofs += 8;
		} else if (attrs.type === 'file-v1-w-layout') {
			assert(Number.isInteger(attrs.layoutOfs!) && (attrs.layoutOfs! >= 0));
			packUintTo8Bytes(attrs.layoutOfs!, bytes, ofs);
			ofs += 8;
		}
		return ofs;
	}

	function readNamedAttrs(bytes: Buffer, i: number): EntityAttrs['ext'] {
		const xattrs: EntityAttrs['ext'] = {};
		while (i < bytes.length) {
			const r = readNamedAttr(bytes, i);
			if (!r) { break; }
			i += r.bytesRead;
			xattrs[r.attr.name] = r.attr;
		}
		return xattrs;
	}

	const NAMED_BINARY = 1;
	const NAMED_UTF8_STR = 2;
	const NAMED_JSON = 3;

	function readNamedAttr(
		bytes: Buffer, i: number
	): { attr: NamedAttr; bytesRead: number; }|undefined {
		const t = parseTypeByte(bytes[i]);
		if (!t) { return; }

		let ofs = i+1;
		const nameLen = readLenNum(bytes, ofs, t.nameLen);
		ofs += t.nameLen;
		const contentLen = readLenNum(bytes, ofs, t.contentLen);
		ofs += t.contentLen;
		const name = bytes.slice(ofs, ofs+nameLen).toString('utf8');
		ofs += nameLen;

		const bytesRead = ofs - i + contentLen;
		if ((contentLen === 0) || (bytes.length < (i + bytesRead))) {
			throw parsingException(`Unexpected end of byte array`);
		}

		if (t.type === NAMED_UTF8_STR) {
			let value: string;
			try {
				value = bytes.slice(ofs, ofs+contentLen).toString('utf8');
			} catch (err) {
				throw parsingException(`Error in parsing `, err);
			}
			const attr: NamedStringAttr = { type: 'named-utf8str', name, value };
			return { attr, bytesRead };
		} else if (t.type === NAMED_JSON) {
			let value: any;
			try {
				value = JSON.parse(
					toBuffer(bytes).slice(ofs, ofs+contentLen).toString('utf8'));
			} catch (err) {
				throw parsingException(``, err);
			}
			const attr: NamedJsonAttr = { type: 'named-json', name, value };
			return { attr, bytesRead };
		} else if (t.type === NAMED_BINARY) {
			const attr: NamedBinaryAttr = {
				type: 'named-binary', name,
				value: bytes.slice(ofs, ofs+contentLen)
			}
			return { attr, bytesRead };
		} else {
			throw new Error(`Unknown type ${t.type} of named attribute`);
		}
	}

	function parseTypeByte(
		b: number
	): { type: 1|2|3; nameLen: number; contentLen: number; }|undefined {
		if (b === 0) { return; }
		const type = ((b & 0b11100000) >> 5) as 1|2|3;
		const nameLen = (b & 0b00011000) >> 3;
		const contentLen = (b & 0b00000111);
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
			case 5:
				return uintFrom5Bytes(bytes, i);
			case 6:
				return uintFrom6Bytes(bytes, i);
			case 7:
				return uintFrom7Bytes(bytes, i);
			default:
				throw new Error(``);
		}
	}

	function packNamedStrAttr(name: string, value: string): Buffer {
		assert((typeof name === 'string') && (name.length > 0) &&
			(typeof value === 'string') && (value.length > 0));
		const nameBin = Buffer.from(name, 'utf8');
		const valueBin = Buffer.from(value, 'utf8');
		return packNamedAttr(NAMED_UTF8_STR, nameBin, valueBin);
	}
	
	function packNamedBinaryAttr(
		name: string, value: Uint8Array
	): Buffer {
		assert((typeof name === 'string') && (name.length > 0) &&
			(value.length > 0));
		const nameBin = Buffer.from(name, 'utf8');
		return packNamedAttr(NAMED_BINARY, nameBin, value);
	}
	
	function packNamedJsonAttr(name: string, value: object): Buffer {
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
		if (nameLenLen > 3) { throw new Error(`Name is too long to pack`); }
		const contentLenLen = byteToStoreLen(value.length);
		const b = Buffer.allocUnsafe(1 + nameLenLen + contentLenLen + name.length + value.length);
		// first byte contains, left to right:
		//  - 3 bits with type,
		//  - 2 bits with number of bytes for name length, and
		//  - 3 bits with number of bytes for value length
		b[0] = (type << 5) | (nameLenLen << 3) | contentLenLen;
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
		else if (len <= 0xffffffffff) { return 5; }
		else if (len <= 0xffffffffffff) { return 6; }
		else { return 7; }
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
			case 5:
				packUintTo5Bytes(u, b, i);
				break;
			case 6:
				packUintTo6Bytes(u, b, i);
				break;
			case 7:
				packUintTo7Bytes(u, b, i);
				break;
			default:
				assert(false);
		}
	}

	const FIXED_ATTRS_LEN = 1 + 6 + 6 + 8;

	export function packAttrs(attrs: Attrs): Buffer {
		const ext: Buffer[] = [];
		for (const xattr of Object.values(attrs.ext)) {
			if (xattr.type === 'named-utf8str') {
				ext.push(packNamedStrAttr(xattr.name, xattr.value));
			} else if (xattr.type === 'named-json') {
				ext.push(packNamedJsonAttr(xattr.name, xattr.value));
			} else if (xattr.type === 'named-binary') {
				ext.push(packNamedBinaryAttr(xattr.name, xattr.value));
			} else {
				throw new Error(`Unknown type of named attribute`);
			}
		}

		let attrsLen = FIXED_ATTRS_LEN + ext.reduce((len, b) => len+b.length, 0);
		const bytes = Buffer.alloc(attrsLen, 0);
		writeCommonAttrs(bytes, attrs);

		let ofs = FIXED_ATTRS_LEN;
		for (const buf of ext) {
			bytes.set(buf, ofs);
			ofs += buf.length;
		}

		return bytes;
	}

	export function byteLenOf(attrs: EntityAttrs): number {
		return packAttrs(attrs).length;
	}

}
Object.freeze(attrV1);


export interface ObjFileParsingException extends web3n.RuntimeException {
	type: 'attrs-parsing',
	msg: string;
}

function parsingException(msg: string, cause?: any): ObjFileParsingException {
	return {
		runtimeException: true,
		type: 'attrs-parsing',
		cause, msg
	};
}

function checkAttrs<T extends EntityAttrs>(json: T): T {
	assert(isFSEntityType(json.type) &&
		Number.isInteger(json.ctime) && Number.isInteger(json.mtime) &&
		!!json.ext && (typeof json.ext === 'object'));
	for (const n of Object.keys(json.ext)) {
		const v = json.ext[n];
		assert(isNamedAttrType(v.type) && (typeof v.name === 'string'));
		if (v.type === 'named-utf8str') {
			assert(typeof v.value === 'string');
		} else if (v.type === 'named-binary') {
			assert(Buffer.isBuffer(v.value));
		} else {
			assert((v.value !== undefined) && (typeof v.value !== 'string'));
		}
	}
	return json;
}

function isFSEntityType(type: FSEntityType): boolean {
	return ((typeof type === 'string') && (
		(type === 'file-v1-continuous') || (type === 'file-v1-w-layout') ||
		(type === 'folder-json-v1') || (type === 'link-json-v1')
	));
}

function isNamedAttrType(type: NamedAttr['type']): boolean {
	return ((typeof type === 'string') && (
		(type === 'named-binary') || (type === 'named-json') ||
		(type === 'named-utf8str')
	));
}

type XAttrsChanges = web3n.files.XAttrsChanges;


export class AttrsHolder<T extends EntityAttrs> {

	constructor(
		private readonly attrs: T,
		private modifiable = false
	) {
		Object.seal(this);
	}

	modifiableCopy(): AttrsHolder<T> {
		return new AttrsHolder<T>(copyJSON(this.attrs), true);
	}

	static fromBytesReadonly<T extends EntityAttrs>(
		bytes: Uint8Array
	): AttrsHolder<T> {
		const attrs = readAttrs(toBuffer(bytes)) as T;
		return new AttrsHolder<T>(attrs, false);
	}

	static fromJSONReadonly<T extends EntityAttrs>(attrs: T): AttrsHolder<T> {
		return new AttrsHolder<T>(checkAttrs(attrs), false);
	}

	static makeReadonlyForFile(now: number): AttrsHolder<FileAttrs> {
		const attrs = makeFileAttrs(now);
		return new AttrsHolder<FileAttrs>(attrs, false);
	}

	static makeReadonlyForFolder(now: number): AttrsHolder<FolderAttrs> {
		const attrs = makeFolderAttrs(now);
		return new AttrsHolder<FolderAttrs>(attrs, false);
	}

	static makeReadonlyForLink(now: number): AttrsHolder<LinkAttrs> {
		const attrs = makeLinkAttrs(now);
		return new AttrsHolder<LinkAttrs>(attrs, false);
	}

	toBytes(): Buffer {
		return attrV1.packAttrs(this.attrs);
	}

	setReadonly(): void {
		this.modifiable = false;
	}

	get isReadonly(): boolean {
		return !this.modifiable;
	}

	private throwIfReadonly(): void {
		if (!this.modifiable) { throw new Error(
			`Can't change readonly attributes`); }
	}

	get ctime(): number {
		return this.attrs.ctime;
	}
	set ctime(epoch: number) {
		this.throwIfReadonly();
		this.attrs.ctime = epoch;
	}

	get mtime(): number {
		return this.attrs.mtime;
	}
	set mtime(epoch: number) {
		this.throwIfReadonly();
		this.attrs.mtime = epoch;
	}

	get type(): T['type'] {
		return this.attrs.type;
	}

	get serializedLen(): number {
		return attrV1.byteLenOf(this.attrs);
	}

	getFileLayoutOfs(): number|undefined {
		if (this.attrs.type !== 'file-v1-w-layout') { return; }
		return (this.attrs as FileAttrs).layoutOfs;
	}

	getFileSize(): number|undefined {
		if (this.attrs.type !== 'file-v1-continuous') { return; }
		return (this.attrs as FileAttrs).size;
	}

	setFileLayoutOfs(ofs: number): void {
		this.throwIfReadonly();
		assert(Number.isInteger(ofs) && (ofs >= 0));
		if (this.attrs.type === 'file-v1-w-layout') {
			(this.attrs as FileAttrs).layoutOfs = ofs;
		} else if (this.attrs.type === 'file-v1-continuous') {
			delete (this.attrs as FileAttrs).size;
			this.attrs.type = 'file-v1-w-layout';
			(this.attrs as FileAttrs).layoutOfs = ofs;
		} else {
			throw new Error(`Layout is not supported in attributes ${this.attrs.type}`);
		}
	}

	setContinuousFileSize(size: number): void {
		this.throwIfReadonly();
		assert(Number.isInteger(size) && (size >= 0));
		if (this.attrs.type === 'file-v1-continuous') {
			(this.attrs as FileAttrs).size = size;
		} else if (this.attrs.type === 'file-v1-w-layout') {
			delete (this.attrs as FileAttrs).layoutOfs;
			this.attrs.type = 'file-v1-continuous';
			(this.attrs as FileAttrs).size = size;
		} else {
			throw new Error(`File size is not supported in attributes ${this.attrs.type}`);
		}
	}

	getXAttr(xaName: string): any {
		const namedAttr = this.attrs.ext[xaName];
		if (!namedAttr) { return; }
		return namedAttr.value;
	}

	updateXAttrs(changes: XAttrsChanges): void {
		this.throwIfReadonly();
		if (Array.isArray(changes.remove)) {
			for (const xaName of changes.remove) {
				delete this.attrs.ext[xaName];
			}
		}
		if ((typeof changes.set === 'object') && changes.set) {
			for (const xaName of Object.keys(changes.set)) {
				const value = changes.set[xaName];
				if (value === undefined) { continue; }
				this.attrs.ext[xaName] = {
					name: xaName,
					type: attrType(value),
					value
				};
			}
		}
	}

	listXAttrs(): string[] {
		return Object.keys(this.attrs.ext);
	}

}
Object.freeze(AttrsHolder.prototype);
Object.freeze(AttrsHolder);


Object.freeze(exports);