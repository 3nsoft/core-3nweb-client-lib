/*
 Copyright (C) 2015 - 2018, 2020 3NSoft Inc.

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

import * as fs from '../../lib-common/async-fs-node';
import { maskPathInExc } from '../../lib-common/exceptions/file';
import { wrapAndSyncSource } from '../../lib-common/byte-streaming/wrapping';
import { ByteSource } from 'xsp-files';

export class DevFileByteSource implements ByteSource {
	
	private offset = 0;
	private size: number;
	
	private constructor(
		private path: string,
		private pathPrefixMaskLen: number,
		stat: fs.Stats
	) {
		this.size = stat.size;
		Object.seal(this);
	}

	static make(
		path: string, pathPrefixMaskLen: number, stat: fs.Stats
	): ByteSource {
		const src = new DevFileByteSource(path, pathPrefixMaskLen, stat);
		return wrapAndSyncSource(src);
	}
	
	async getSize(): Promise<{ size: number; isEndless: boolean; }> {
		return { size: this.size, isEndless: false };
	}
	
	async readNext(len: number): Promise<Uint8Array|undefined> {
		if (this.offset >= this.size) { return; }
		let fh: fs.FileHandle|undefined = undefined;
		try {
			fh = await fs.open(this.path, 'r');
			let buf: Buffer;
			if (typeof len === 'number') {
				len = Math.min(this.size - this.offset, len);
				buf = Buffer.allocUnsafe(len);
			} else {
				buf = Buffer.allocUnsafe(this.size - this.offset);
			}
			await fs.readToBuf(fh, this.offset, buf);
			this.offset += buf.length;
			return buf;
		} catch (e) {
			throw maskPathInExc(this.pathPrefixMaskLen, e);
		} finally {
			if (fh !== undefined) { await fh.close(); }
		}
	}
	
	async seek(offset: number): Promise<void> {
		if ((offset < 0) || (offset > this.size)) { throw new Error(
			`Given offset ${offset} is out of bounds.`); }
		this.offset = offset;
	}

	async readAt(pos: number, len: number): Promise<Uint8Array|undefined> {
		await this.seek(pos);
		return await this.readNext(len);
	}

	async getPosition(): Promise<number> {
		return this.offset;
	}

}
Object.freeze(DevFileByteSource.prototype);
Object.freeze(DevFileByteSource);

Object.freeze(exports);