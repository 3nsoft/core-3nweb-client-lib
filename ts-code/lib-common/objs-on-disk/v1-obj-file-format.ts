/*
 Copyright (C) 2019 - 2020 3NSoft Inc.
 
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

import { HeaderChunkInfo, SegsChunk } from "./file-layout";
import { uintFrom4Bytes, packUintTo4Bytes, uintFrom8Bytes, packUintTo8Bytes } from "../big-endian";

export const V1_FILE_START = Buffer.from('1xsp', 'utf8');

namespace headerChunkInfo {

	export function toBytes(hInfo: HeaderChunkInfo): Buffer {
		const buf = Buffer.allocUnsafe(12);
		packUintTo4Bytes(hInfo.len, buf, 0);
		packUintTo8Bytes(hInfo.fileOfs, buf, 4);
		return buf;
	}

	export function fromBytes(
		b: Uint8Array, i: number
	): { hInfo: HeaderChunkInfo; bytesRead: number; } {
		let bytesRead = 0;
		const len = uintFrom4Bytes(b, i + bytesRead);
		bytesRead += 4;
		const fileOfs = uintFrom8Bytes(b, i + bytesRead);
		bytesRead += 8;
		const hInfo: HeaderChunkInfo = { len, fileOfs };
		return { hInfo: Object.freeze(hInfo), bytesRead };
	}

}
Object.freeze(headerChunkInfo);

namespace segsChunkInfo {

	const IS_ENDLESS_BITMASK = 0b00000001;
	const FILE_OFS_PRESENT_BITMASK = 0b00000010;
	const BASE_VER_OFS_PRESENT_BITMASK = 0b00000100;

	export function toBytes(sInfo: SegsChunk): Buffer {
		let flag = 0;
		let bufSize = 17;
		if ((sInfo.type === 'new-on-disk') || (sInfo.type === 'base-on-disk')) {
			flag |= FILE_OFS_PRESENT_BITMASK;
			bufSize += 8;
		}
		if ((sInfo.type === 'base') || (sInfo.type === 'base-on-disk')) {
			flag |= BASE_VER_OFS_PRESENT_BITMASK;
			bufSize += 8;
		}
		const buf = Buffer.allocUnsafe(bufSize);
		let i = 0;
		buf[i] = flag;
		i += 1;
		packUintTo8Bytes(sInfo.thisVerOfs, buf, i);
		i += 8;
		if (sInfo.type !== 'new-endless') {
			packUintTo8Bytes(sInfo.len, buf, 9);
			i += 8;
		}
		if ((sInfo.type === 'new-on-disk') || (sInfo.type === 'base-on-disk')) {
			packUintTo8Bytes(sInfo.fileOfs, buf, i);
			i += 8;
		}
		if ((sInfo.type === 'base') || (sInfo.type === 'base-on-disk')) {
			packUintTo8Bytes(sInfo.baseVerOfs, buf, i);
		}
		return buf;
	}

	export function fromBytes(
		b: Uint8Array, i: number
	): { sInfo: SegsChunk; bytesRead: number; } {
		let bytesRead = 0
		const flag = b[i + bytesRead];
		bytesRead += 1;
		const thisVerOfs = uintFrom8Bytes(b, i + bytesRead);
		bytesRead += 8;
		let len: number|undefined = undefined;
		if ((flag & IS_ENDLESS_BITMASK) === 0) {
			len = uintFrom8Bytes(b, i + bytesRead);
			bytesRead += 8;
		}
		let fileOfs: number|undefined = undefined;
		if (flag & FILE_OFS_PRESENT_BITMASK) {
			fileOfs = uintFrom8Bytes(b, i + bytesRead);
			bytesRead += 8;
		}
		let baseVerOfs: number|undefined = undefined;
		if (flag & BASE_VER_OFS_PRESENT_BITMASK) {
			baseVerOfs = uintFrom8Bytes(b, i + bytesRead);
			bytesRead += 8;
		}
		const isOnDisk = (fileOfs !== undefined);
		const isBase = (baseVerOfs !== undefined);
		const isFinite = (len !== undefined);
		let sInfo: SegsChunk;
		if (isOnDisk) {
			if (!isFinite) { throw new Error(`Obj file segments chunk flag says that bytes are on disk, when chunk is infinite`); }
			if (isBase) {
				sInfo = {
					type: 'base-on-disk',
					thisVerOfs,
					len: len!,
					fileOfs: fileOfs!,
					baseVerOfs: baseVerOfs!
				};
			} else {
				sInfo = {
					type: 'new-on-disk',
					thisVerOfs,
					len: len!,
					fileOfs: fileOfs!
				};
			}
		} else {
			if (isBase) {
				sInfo = {
					type: 'base',
					thisVerOfs,
					len: len!,
					baseVerOfs: baseVerOfs!
				};
			} else if (isFinite) {
				sInfo = {
					type: 'new',
					thisVerOfs,
					len: len!
				};
			} else {
				sInfo = {
					type: 'new-endless',
					thisVerOfs
				};
			}
		}
		return { sInfo, bytesRead };
	}

}
Object.freeze(segsChunkInfo);

export namespace layoutV1 {

	const HEADER_PRESENT_BITMASK = 0b00000001;
	const BASE_PRESENT_BITMASK = 0b00000010;
	const SEGS_LAYOUT_FROZEN_BITMASK = 0b00000100;
	const TOTAL_SIZE_NOT_SET_BITMASK = 0b00001000;
	const VERSION_FILE_COMPLETE_BITMASK = 0b00010000;
	const ALL_BASE_BYTES_IN_FILE_BITMASK = 0b00100000;

	export interface Attrs {
		fileComplete: boolean;
		segsChunks: SegsChunk[];
		headerChunk?: HeaderChunkInfo;
		segsLayoutFrozen: boolean;
		baseVersion?: number;
		sizeUnknown: boolean;
		allBaseBytesInFile: boolean;
	}

	function validateAttrs(attrs: Attrs): void {
		// XXX check consistency of attrs
	
	}

	export function toBytes(a: Attrs): Buffer {
		let flag = 0;
		let baseBytes: Buffer|undefined = undefined;
		if (a.baseVersion !== undefined) {
			flag |= BASE_PRESENT_BITMASK;
			baseBytes = Buffer.allocUnsafe(8);
			packUintTo8Bytes(a.baseVersion, baseBytes, 0);
			if (a.allBaseBytesInFile) {
				flag |= ALL_BASE_BYTES_IN_FILE_BITMASK;
			}
		}
		let headerInfoBytes: Buffer|undefined = undefined;
		if (a.headerChunk) {
			flag |= HEADER_PRESENT_BITMASK;
			headerInfoBytes = headerChunkInfo.toBytes(a.headerChunk);
			if (a.fileComplete) {
				flag |= VERSION_FILE_COMPLETE_BITMASK;
			}
		}
		if (a.segsLayoutFrozen) {
			flag |= SEGS_LAYOUT_FROZEN_BITMASK;
		}
		if (a.sizeUnknown) {
			flag |= TOTAL_SIZE_NOT_SET_BITMASK;
		}
		const segsInfoBytes = a.segsChunks.map(s => segsChunkInfo.toBytes(s));
		const buf = Buffer.allocUnsafe(1 +
			(baseBytes ? 8 : 0) +
			(headerInfoBytes ? headerInfoBytes.length : 0) +
			totalLenOf(segsInfoBytes));
		buf[0] = flag;
		let i = 1;
		if (baseBytes) {
			buf.set(baseBytes, i);
			i += 8;
		}
		if (headerInfoBytes) {
			buf.set(headerInfoBytes, i);
			i += headerInfoBytes.length;
		}
		for (const chunk of segsInfoBytes) {
			buf.set(chunk, i);
			i += chunk.length;
		}
		return buf;
	}

	export function fromBytes(b: Uint8Array, i: number): Attrs {
		const flag = b[i];
		i += 1;
		let baseVersion: number|undefined = undefined;
		if (flag & BASE_PRESENT_BITMASK) {
			baseVersion = uintFrom8Bytes(b, i);
			i += 8;
		}
		let headerChunk: HeaderChunkInfo|undefined = undefined;
		if (flag & HEADER_PRESENT_BITMASK) {
			const { hInfo, bytesRead } = headerChunkInfo.fromBytes(b, i);
			headerChunk = hInfo;
			i += bytesRead;
		}
		const fileComplete = !!(flag & VERSION_FILE_COMPLETE_BITMASK);
		const segsLayoutFrozen = !!(flag & SEGS_LAYOUT_FROZEN_BITMASK);
		const sizeUnknown = !!(flag & TOTAL_SIZE_NOT_SET_BITMASK);
		const allBaseBytesInFile = !!(flag && ALL_BASE_BYTES_IN_FILE_BITMASK);
		const segsChunks: SegsChunk[] = [];
		while (i < b.length) {
			const { sInfo, bytesRead } = segsChunkInfo.fromBytes(b, i);
			segsChunks.push(sInfo);
			i += bytesRead;
		}
		const attrs = { fileComplete, segsChunks, headerChunk, segsLayoutFrozen,
			baseVersion, sizeUnknown, allBaseBytesInFile };
		validateAttrs(attrs);
		return attrs;
	}

}
Object.freeze(layoutV1);

function totalLenOf(arrs: Uint8Array[]): number {
	let totalLen = 0;
	for (const arr of arrs) {
		totalLen += arr.length;
	}
	return totalLen;
}


Object.freeze(exports);