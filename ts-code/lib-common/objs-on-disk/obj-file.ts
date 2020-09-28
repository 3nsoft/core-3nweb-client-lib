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
 this program. If not, see <http://www.gnu.org/licenses/>. */

import * as fs from '../async-fs-node';
import { errWithCause } from '../exceptions/error';
import { bytesEqual } from '../bytes-equal';
import { SingleProc, defer } from '../processes';
import { toBuffer } from '../buffer-utils';
import { Layout } from 'xsp-files';
import { V1_FILE_START } from './v1-obj-file-format';
import { createReadStream } from 'fs';
import { ObjVersionBytesLayout, FiniteSegsChunk } from './file-layout';
import { FileException } from '../exceptions/file';
import { uintFrom8Bytes, packUintTo8Bytes } from '../big-endian';

(global as any).log = false;

export class ObjVersionFile {

	private readonly writeProc = new SingleProc();

	private constructor(
		private path: string,
		private readonly layout: ObjVersionBytesLayout
	) {
		Object.seal(this);
	}

	static async forExisting(path: string): Promise<ObjVersionFile> {
		const fd = await fs.open(path, 'r');
		try {
			const layout = await parseObjVersionBytesLayout(fd)
			.catch((err: ObjFileParsingException) => {
				if (err.type === 'obj-file-parsing') {
					err.path = path;
				}
				throw err;
			});
			return new ObjVersionFile(path, layout);
		} finally {
			await fs.close(fd).catch(noop);
		}
	}

	static async createNew(path: string): Promise<ObjVersionFile> {
		const layout = ObjVersionBytesLayout.forNewFile();
		const objFile = new ObjVersionFile(path, layout);
		objFile.startCreatingFileOnDisk();
		return objFile;
	}

	private startCreatingFileOnDisk(): void {
		this.writeProc.addStarted(createNewV1File(this.path));
	}

	moveFile(newPath: string): Promise<void> {
		return this.writeProc.startOrChain(async () => {
			await fs.rename(this.path, newPath);
			this.path = newPath;
		});
	}

	removeFile(): Promise<void> {
		return this.writeProc.startOrChain(() => fs.unlink(this.path));
	}

	saveLayout(): Promise<void> {
		return this.withRWFile(fd => this.recordLayout(fd));
	}

	private async recordLayout(fd: number): Promise<void> {
		const layoutBytes = this.layout.toBytes();
		const ofs = this.layout.getLayoutOfs();
		await fs.writeFromBuf(fd, ofs, layoutBytes);
		await recordLayoutOffsetInV1(fd, ofs);
		await fs.ftruncate(fd, ofs + layoutBytes.length);
	}

	private withRWFile<T>(action: (fd: number) => Promise<T>): Promise<T> {
		return this.writeProc.startOrChain(async () => {
			const fd = await fs.open(this.path, 'r+')
			.catch(exc => {
				throw errWithCause(exc, `Can't open for writing obj-version file ${this.path}`);
			});
			try {
				return await action(fd);
			} finally {
				await fs.close(fd).catch(noop);
			}
		});
	}

	getTotalSegsLen(): number {
		return this.layout.getTotalSegsLen();
	}

	isSegsLayoutSet(): boolean {
		return this.layout.isLayoutFrozen();
	}

	saveHeader(header: Uint8Array, saveLayout: boolean): Promise<void> {
		return this.withRWFile(async fd => {
			const ofs = this.layout.getLayoutOfs();
			await fs.writeFromBuf(fd, ofs, toBuffer(header));
			this.layout.addHeader(header.length, ofs);
			if (saveLayout) {
				await this.recordLayout(fd);
			}
		});
	}

	saveSegs(
		segsChunks: Uint8Array, thisVerOfs: number,
		baseVerOfs: number|undefined, saveLayout: boolean
	): Promise<void> {
		return this.withRWFile(async fd => {
			const ofs = this.layout.getLayoutOfs();
			await fs.writeFromBuf(fd, ofs, toBuffer(segsChunks));
			if (baseVerOfs === undefined) {
				this.layout.addSegsOnFile(thisVerOfs, segsChunks.length, ofs);
			} else {
				this.layout.addBaseSegsOnFile(
					thisVerOfs, baseVerOfs, segsChunks.length, ofs);
			}
			if (saveLayout) {
				await this.recordLayout(fd);
			}
		});
	}

	getBaseVersion(): number|undefined {
		return this.layout.getBaseVersion();
	}

	private async withROFile<T>(action: (fd: number) => Promise<T>): Promise<T> {
		const path = this.path;
		const fd = await fs.open(path, 'r')
		.catch((exc: FileException) => {
			if (exc.notFound && (path !== this.path)) {
				return fs.open(this.path, 'r');
			} else {
				throw exc;
			}
		})
		.catch(exc => {
			throw errWithCause(exc, `Can't open for reading obj version file ${this.path}`);
		});
		try {
			return await action(fd);
		} finally {
			await fs.close(fd).catch(err => {});
		}
	}

	getHeaderLen(): number|undefined {
		const chunkInfo = this.layout.headerLocation();
		if (!chunkInfo) { return; }
		return chunkInfo.len;
	}

	async readHeader(): Promise<Uint8Array|undefined> {
		const chunkInfo = this.layout.headerLocation();
		if (!chunkInfo) { return; }
		return this.withROFile(async fd => {
			const h = Buffer.allocUnsafe(chunkInfo.len);
			await fs.readToBuf(fd, chunkInfo.fileOfs, h);
			return h;
		});
	}

	async streamHeaderInto(sink: NodeJS.WritableStream): Promise<void> {
		const chunkInfo = this.layout.headerLocation();
		if (!chunkInfo) { return; }
		await this.withROFile(async fd => {
			const src = createReadStream('', {
				fd,
				autoClose: false,
				start: chunkInfo.fileOfs,
				end: chunkInfo.fileOfs + chunkInfo.len - 1
			});
			return pipeBytes(src, sink);
		});
	}

	async readSegs(thisVerOfs: number, len: number): Promise<Uint8Array[]> {
		const chunks = this.layout.segsLocations(thisVerOfs, len);
		return this.withROFile(async fd => {
			const sections: Uint8Array[] = [];
			for (const chunk of chunks) {
				if ((chunk.type === 'new-on-disk')
				|| (chunk.type === 'base-on-disk')) {
					const s = Buffer.allocUnsafe(chunk.len);
					await fs.readToBuf(fd, chunk.fileOfs, s);
					sections.push(s);
				} else {
					throw new Error(`Part of requested segments is not on a disk`);
				}
			}
			return sections;
		});
	}

	async streamSegsInto(
		sink: NodeJS.WritableStream, thisVerOfs: number, len: number
	): Promise<void> {
		const chunks = this.layout.segsLocations(thisVerOfs, len);
		await this.withROFile(async fd => {
			for (const chunk of chunks) {
				if ((chunk.type === 'new-on-disk')
				|| (chunk.type === 'base-on-disk')) {
					const src = createReadStream('', {
						fd,
						autoClose: false,
						start: chunk.fileOfs,
						end: chunk.fileOfs + chunk.len - 1
					});
					await pipeBytes(src, sink);
				} else {
					throw new Error(`Part of requested segments is not on a disk`);
				}
			}
		});
	}

	segsLocations(thisVerOfs: number, len: number): FiniteSegsChunk[] {
		return this.layout.segsLocations(thisVerOfs, len);
	}

	setSegsLayout(layout: Layout, saveLayout: boolean): Promise<void> {
		this.layout.setAndFreezeWith(layout);
		return this.withRWFile(async fd => {
			if (saveLayout) {
				await this.recordLayout(fd);
			}
		});
	}

	truncateEndlessLayout(): void {
		this.layout.truncateIfEndless();
	}

	isFileComplete(): boolean {
		return this.layout.isFileComplete();
	}

}
Object.freeze(ObjVersionFile.prototype);
Object.freeze(ObjVersionFile);

function noop () {}

async function pipeBytes(
	src: NodeJS.ReadableStream, sink: NodeJS.WritableStream
): Promise<void> {
	const deferred = defer<void>();
	src.pipe(sink, { end: false });
	src.on('error', (err) => {
		deferred.reject(err);
		src.unpipe(sink);
	});
	src.on('end', () => {
		src.unpipe(sink);
		deferred.resolve();
	});
	return deferred.promise;
}

export interface ObjFileParsingException extends web3n.RuntimeException {
	type: 'obj-file-parsing',
	msg: string;
	path: string;
}

function parsingException(msg: string, cause?: any): ObjFileParsingException {
	return {
		runtimeException: true,
		type: 'obj-file-parsing',
		cause, msg,
		path: ''
	};
}

/**
 * This parses obj version file's informational parts.
 * @param fd is an open file descriptor, of a file to parse
 */
async function parseObjVersionBytesLayout(fd: number):
		Promise<ObjVersionBytesLayout> {
	const fstBytes = Buffer.allocUnsafe(12);
	await fs.readToBuf(fd, 0, fstBytes).catch((exc: fs.FileException) => {
		if (exc.endOfFile) { throw parsingException(
			'File is too short to contain object'); }
		throw exc;
	});
	const fileStart = fstBytes.slice(0, 4);
	if (bytesEqual(fileStart, V1_FILE_START)) {
		const layoutOfs = uintFrom8Bytes(fstBytes, 4);
		if (layoutOfs === 0) { throw parsingException(
			`Obj version file is in incomplete state`); }
		if (layoutOfs > Number.MAX_SAFE_INTEGER) { throw parsingException(
			`This implementation can't handle files with length over 2^53`); }
		const fileSize = (await fs.fstat(fd)).size;
		if (layoutOfs >= fileSize) { throw parsingException(
			`Layout offset is greater than file size`); }
		const layoutBytes = Buffer.allocUnsafe(fileSize - layoutOfs);
		await fs.readToBuf(fd, layoutOfs, layoutBytes);
		return ObjVersionBytesLayout.fromV1Bytes(layoutOfs, layoutBytes);
	} else {
		throw parsingException(`Obj version file does not have recognizable byte signature at its start`);
	}	
}

async function createNewV1File(path: string): Promise<void> {
	const initContent = Buffer.alloc(V1_FILE_START.length + 8, 0);
	initContent.set(V1_FILE_START);
	// note that all 8 bytes of layout offset are zeros
	await fs.writeFile(path, initContent, { flag: 'wx' });
}

async function recordLayoutOffsetInV1(fd: number, ofs: number): Promise<void> {
	const ofsInBytes = Buffer.allocUnsafe(8);
	packUintTo8Bytes(ofs, ofsInBytes, 0);
	await fs.writeFromBuf(fd, V1_FILE_START.length, ofsInBytes)
	.catch(exc => {
		throw errWithCause(exc, `Can't record layout offset in obj file`);
	});
}


Object.freeze(exports);