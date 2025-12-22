/*
 Copyright (C) 2019 3NSoft Inc.
 
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

import { Layout, LayoutBaseSection, LayoutNewSection } from 'xsp-files';
import { defer, Deferred } from '../processes/deferred';
import { DiffInfo } from '../service-api/3nstorage/owner';
import { ObjVersionFile } from './obj-version-file';
import { Readable } from 'stream';
import { makeFileException } from '../exceptions/file';
import { assert } from '../assert';
import { BytesFIFOBuffer } from '../byte-streaming/bytes-fifo-buffer';

export function diffToLayout(diff: DiffInfo): Layout {
	const layout: Layout = {
		base: diff.baseVersion,
		sections: []
	};
	let ofs = 0;
	for (const [ isNew, sOfs, len ] of diff.sections) {
		let section: LayoutBaseSection|LayoutNewSection;
		if (isNew === 1) {
			section = { src: 'new', len, ofs };
		} else {
			section = { src: 'base', ofs, len, baseOfs: sOfs }
		}
		ofs += len;
		layout.sections.push(section);
	}
	return layout;
}

export interface ChunkWithHeader {
	type: 'header';
	len: number;
}

export interface ChunkWithSegs {
	type: 'segs';
	len: number;
	segsOfs: number;
}

export type Chunk = ChunkWithHeader | ChunkWithSegs;

export async function streamToObjFile(
	file: ObjVersionFile, content: Chunk[], src: Readable, maxBufferLen: number
): Promise<void> {
	let deferred: Deferred<void>|undefined = defer<void>();
	const contentIter = content.values();
	let chunk: Chunk|undefined = undefined;
	let buf = new BytesFIFOBuffer();
	let chunkBytesWritten = 0;

	// file.saveXXX(...)'s take care of ordering operations, hence, we need no
	// awaits. At the same time completion of streaming deferred should happen
	// after the last save operation.

	const complete = (err?: any): void => {
		if (!deferred) { return; }
		const d = deferred;
		deferred = undefined;
		file.saveLayout()
		.then(() => {
			if (err) { d.reject(err); }
			else { d.resolve(); }
		})
		.catch(exc => d.reject(err ? err : exc));
	};

	src.on('data', (data: Buffer) => {
		let ofsInData = 0;
		while (ofsInData < data.length) {
			if (!deferred) { return; }
			if (!chunk) {
				const { value, done } = contentIter.next();
				if (done) {
					complete(new Error(`There are more bytes than expected by content info`));
					return;
				}
				chunk = value as Chunk;
			}

			const bytesToSelect = chunk.len - (buf.length + chunkBytesWritten)
			const bytes = data.subarray(ofsInData, ofsInData + bytesToSelect);
			ofsInData += bytes.length;
			buf.push(bytes);

			if ((buf.length + chunkBytesWritten) === chunk.len) {
				const chunkBytes = buf.getBytes(undefined)!;
				if (chunk.type === 'header') {
					file.saveHeader(chunkBytes, false)
					.catch(err => complete(err));
				} else {
					const segsOfs = chunk.segsOfs + chunkBytesWritten;
					file.saveSegs(chunkBytes, segsOfs, undefined, false)
					.catch(err => complete(err));
				}
				chunk = undefined;
				chunkBytesWritten = 0;
			} else if ((chunk.type === 'segs') &&
					((buf.length >= maxBufferLen) || (buf.queueLength > 30))) {
				const chunkBytes = buf.getBytes(undefined)!;
				const segsOfs = chunk.segsOfs + chunkBytesWritten;
				file.saveSegs(chunkBytes, segsOfs, undefined, false)
				.catch(err => complete(err));
				chunkBytesWritten += chunkBytes.length;
			}
		}
	});
	
	src.on('end', () => {
		if (chunk) {
			complete(makeFileException('endOfFile', '<input stream>'));
		} else {
			complete();
		}
	});
	
	src.on('error', err => complete(err));

	src.resume();	// noop, if stream wasn't paused

	return deferred.promise;
}

export function chunksInOrderedStream(
	len: number, headerLen: undefined|number, segsOfs: number
): Chunk[] {
	const chunks: Chunk[] = [];
	if (typeof headerLen === 'number') {
		assert(len >= headerLen);
		chunks.push({ type: 'header', len: headerLen });
		len -= headerLen;
	}
	if (len === 0) { return chunks; }
	chunks.push({ type: 'segs', segsOfs, len });
	return chunks;
}

export type ObjPipe = (outStream: NodeJS.WritableStream) => Promise<void>;

export type GetObjFile =
	(objId: string|null, version: number) => Promise<ObjVersionFile>;

export function makeObjPipe(
	file: ObjVersionFile, header: boolean, segsOfs: number, segsLen: number,
	objId: string|null, getObjFile: GetObjFile
): ObjPipe {
	const baseVersion = file.getBaseVersion();
	if (baseVersion === undefined) {
		return makeNoBaseObjPipe(file, header, segsOfs, segsLen);
	}

	segsLen = Math.min(segsLen, file.getTotalSegsLen());
	const segsInRange = file.segsLocations(segsOfs, segsLen);
	return async (outStream: NodeJS.WritableStream): Promise<void> => {
		if (header) {
			await file.streamHeaderInto(outStream);
		}
		for (const s of segsInRange) {
			if ((s.type === 'new-on-disk') || (s.type === 'base-on-disk')) {
				await file.streamSegsInto(outStream, s.thisVerOfs, s.len);
			} else if (s.type === 'base') {
				const base = await getObjFile(objId, baseVersion);
				const pipeBase = makeObjPipe(
					base, false, s.baseVerOfs, s.len, objId, getObjFile);
				await pipeBase(outStream);
			} else {
				throw new Error(`Segment bytes from offset ${s.thisVerOfs} and length ${s.len} are not on the disk`);
			}
		}
	};
}

export function makeNoBaseObjPipe(
	file: ObjVersionFile, header: boolean, segsOfs: number, segsLen: number
): ObjPipe {
	return async (outStream: NodeJS.WritableStream): Promise<void> => {
		if (header) {
			await file.streamHeaderInto(outStream);
		}
		await file.streamSegsInto(outStream, segsOfs, segsLen);
	};
}


Object.freeze(exports);