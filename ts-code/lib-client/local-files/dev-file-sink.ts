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
 this program. If not, see <http://www.gnu.org/licenses/>. */

import * as fs from '../../lib-common/async-fs-node';
import { maskPathInExc } from '../../lib-common/exceptions/file';
import { wrapAndSyncFileSink } from '../../lib-common/byte-streaming/wrapping';
import { assert } from '../../lib-common/assert';
import { toBuffer } from '../../lib-common/buffer-utils';

type FileByteSink = web3n.files.FileByteSink;
type Layout = web3n.files.FileLayout;

export class DevFileByteSink implements FileByteSink {

	private constructor(
		private readonly path: string,
		private readonly pathPrefixMaskLen: number,
		private size: number
	) {
		Object.seal(this);
	}

	static make(
		path: string, pathPrefixMaskLen: number, stat: fs.Stats
	): FileByteSink {
		assert(Number.isInteger(stat.size) && (stat.size >= 0));
		const sink = new DevFileByteSink(path, pathPrefixMaskLen, stat.size!);
		return wrapAndSyncFileSink(sink);
	}

	async done(): Promise<void> {}
	
	async getSize(): Promise<number> {
		return this.size;
	}
	
	async showLayout(): Promise<Layout> {
		return {
			sections: ((this.size === 0) ?
				[] : [ { src: 'new', ofs: 0, len: this.size } ])
		};
	}

	async truncate(size: number): Promise<void> {
		assert(Number.isInteger(size) && (size >= 0), `Invalid parameters given`);
		await fs.truncate(this.path, size);
		this.size = size;
	}

	async splice(pos: number, del: number, bytes?: Uint8Array): Promise<void> {
		assert(Number.isInteger(pos) && (pos >= 0)
			&& Number.isInteger(del) && (del >= 0), `Invalid parameters given`);
		const ins = (bytes ? bytes.length : 0);
		if ((del === 0) && (ins === 0)) { return; }
		if (this.size <= (pos+del)) {
			if (pos < this.size) {
				await fs.truncate(this.path, pos);
			}
			this.size = pos + ins;
		} else {
			const delta = ins-del;
			if (delta !== 0) {
				await this.shiftBytes(pos, delta, this.size);
				this.size += delta;
			}
		}
		if (!bytes) { return; }
		let fd: number|undefined = undefined;
		try {
			fd = await fs.open(this.path, 'r+');
			await fs.writeFromBuf(fd, pos, toBuffer(bytes));
		} catch (e) {
			throw maskPathInExc(this.pathPrefixMaskLen, e);
		} finally {
			if (fd !== undefined) { await fs.close(fd); }
		}
	}

	private async shiftBytes(
		pos: number, delta: number, initFileLen: number
	): Promise<void> {
		if (delta === 0) { return; }
		assert(Number.isInteger(pos) && (pos >= 0)
			&& Number.isInteger(delta) && Number.isInteger(initFileLen)
			&& (pos <= initFileLen), `Invalid parameters given`);
		if (delta > 0) {
			await this.insFileBytesAt(pos, delta, initFileLen);
		} else {
			await this.rmFileBytesAt(pos, -delta, initFileLen);
		}

	}

	private async insFileBytesAt(
		pos: number, ins: number, initFileLen: number
	): Promise<void> {
		const bytesToMove = Math.max(0, initFileLen - pos);
		const buf = Buffer.allocUnsafe(
			Math.min(MAX_SHIFT_BUFFER_SIZE, bytesToMove));
		let fd: number|undefined = undefined;
		try {
			fd = await fs.open(this.path, 'r+');
			await fs.ftruncate(fd, initFileLen + ins);
			let bytesLeft = bytesToMove;
			let readPos = initFileLen;
			let writePos = initFileLen + ins;
			while (bytesLeft > 0) {
				const chunk = ((buf.length <= bytesLeft) ?
					buf : buf.slice(0, bytesLeft));
				readPos -= chunk.length;
				writePos -= chunk.length;
				await fs.readToBuf(fd, readPos, chunk);
				await fs.writeFromBuf(fd, writePos, chunk);
				bytesLeft -= chunk.length;
			}
		} catch (e) {
			throw maskPathInExc(this.pathPrefixMaskLen, e);
		} finally {
			if (fd !== undefined) { await fs.close(fd); }
		}
	}

	private async rmFileBytesAt(
		pos: number, del: number, initFileLen: number
	): Promise<void> {
		const bytesToMove = Math.max(0, initFileLen - pos - del);
		const buf = Buffer.allocUnsafe(
			Math.min(MAX_SHIFT_BUFFER_SIZE, bytesToMove));
		let fd: number|undefined = undefined;
		try {
			fd = await fs.open(this.path, 'r+');
			let bytesLeft = bytesToMove;
			let readPos = pos + del;
			let writePos = pos;
			while (bytesLeft > 0) {
				const chunk = ((buf.length <= bytesLeft) ?
					buf : buf.slice(0, bytesLeft));
				await fs.readToBuf(fd, readPos, chunk);
				await fs.writeFromBuf(fd, writePos, chunk);
				bytesLeft -= chunk.length;
				readPos += chunk.length;
				writePos += chunk.length;
			}
			await fs.ftruncate(fd, pos + bytesToMove);
		} catch (e) {
			throw maskPathInExc(this.pathPrefixMaskLen, e);
		} finally {
			if (fd !== undefined) { await fs.close(fd); }
		}
	}

}
Object.freeze(DevFileByteSink.prototype);
Object.freeze(DevFileByteSink);

const MAX_SHIFT_BUFFER_SIZE = 4*1024*1024;


Object.freeze(exports);