/*
 Copyright (C) 2018 - 2020, 2022 3NSoft Inc.

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

import { joinByteArrs } from '../../lib-common/buffer-utils';
import { ObjId } from '../3nstorage/xsp-fs/common';
import { ObjSource, Subscribe, Layout, ByteSource } from 'xsp-files';
import { wrapAndSyncSource } from '../../lib-common/byte-streaming/wrapping';
import { assert } from '../../lib-common/assert';
import { FileWritingProc, FileWrite } from './file-writing-proc';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { ObjVersionFile } from '../../lib-common/objs-on-disk/obj-file';
import { NotOnDiskFiniteChunk, BaseSegsChunk, FiniteChunk, FiniteSegsChunk, NewSegsChunk } from '../../lib-common/objs-on-disk/file-layout';
import { flatTap, allowOnlySingleStart } from '../../lib-common/utils-for-observables';
import { DiffInfo } from '../../lib-common/service-api/3nstorage/owner';

export type GetBaseSegsOnDisk = (
	version: number, ofs: number, len: number
) => Promise<(Uint8Array|NotOnDiskFiniteChunk)[]>;

export class ObjOnDisk {

	private proxiedHeader: Uint8Array|undefined = undefined;

	private constructor(
		public readonly objId: ObjId,
		public readonly version: number,
		private readonly objFile: ObjVersionFile,
		private readonly downloader: ObjDownloader|undefined,
		private readable: boolean,
		private readonly getBaseSegsOnDisk: GetBaseSegsOnDisk|undefined
	) {
		Object.seal(this);
	}

	static async forExistingFile(
		objId: ObjId, version: number, path: string,
		downloader?: ObjDownloader, getBase?: GetBaseSegsOnDisk
	): Promise<ObjOnDisk> {
		const objFile = await ObjVersionFile.forExisting(path);
		return new ObjOnDisk(objId, version, objFile, downloader, true, getBase);
	}

	static async createFileForExistingVersion(
		objId: ObjId, version: number, path: string,
		downloader: ObjDownloader, getBase?: GetBaseSegsOnDisk,
		initDownload?: InitDownloadParts
	): Promise<ObjOnDisk> {
		if (!initDownload) {
			initDownload =
				await downloader.getLayoutWithHeaderAndFirstSegs(objId, version);
		}
		const { layout, header, segs } = initDownload;
		if (layout.base !== undefined) {
			// XXX with diff-ed downloads can't assume segs' offset to be 0
			throw new Error(`Current implementation cannot consume diff-ed downloads`);
		}
		const objFile = await ObjVersionFile.createNew(path);
		const obj = new ObjOnDisk(
			objId, version, objFile, downloader, true, getBase
		);
		await objFile.setSegsLayout(layout, false);
		await objFile.saveHeader(header, !segs);
		if (segs) {
			await objFile.saveSegs(segs, 0, undefined, true);
		}
		return obj;
	}

	static async createFileForWriteOfNewVersion(
		objId: ObjId, version: number, path: string, encSub: Subscribe,
		downloader?: ObjDownloader, getBase?: GetBaseSegsOnDisk
	): Promise<{ obj: ObjOnDisk; write$: Observable<FileWrite[]>; }> {
		const objFile = await ObjVersionFile.createNew(path);
		const obj = new ObjOnDisk(
			objId, version, objFile, downloader, false, getBase
		);
		const write$ = FileWritingProc.makeFor(objFile, encSub)
		.pipe(
			tap({
				complete: () => {
					obj.readable = true;
				}
			}),
			flatTap(undefined, () => objFile.removeFile()),
			allowOnlySingleStart()
		);
		return { obj, write$ };
	}

	async moveFileAndProxyThis(
		newPath: string, objVersionChange: {
			version: number; newHeader: Uint8Array; originalHeader: Uint8Array;
		}|undefined
	): Promise<ObjOnDisk> {
		const newObjOnDisk = new ObjOnDisk(
			this.objId,
			(objVersionChange? objVersionChange.version : this.version),
			this.objFile,
			this.downloader,
			this.readable,
			this.getBaseSegsOnDisk
		);
		if (objVersionChange) {
			this.proxiedHeader = objVersionChange.originalHeader;
		}
		await this.objFile.moveFile(newPath, objVersionChange?.newHeader);
		return newObjOnDisk;
	}

	async removeFile(): Promise<void> {
		await this.objFile.removeFile();
	}

	private async readHeader(): Promise<Uint8Array> {
		if (this.proxiedHeader) {
			return this.proxiedHeader;
		}
		let h = await this.objFile.readHeader();
		if (h) { return h; }
		if (!this.downloader) {
			throw new Error(`Object ${this.objId} header is not on a disk.`);
		}
		// XXX although we may get header, there is a question about layout,
		// which should've been set and written to file with header in current
		// implementation.
		throw new Error(`Current implementation assumes presence of header in a file at this stage of reading`);
	}

	private async readSegs(offset: number, len: number): Promise<Uint8Array> {
		const bytes: Uint8Array[] = [];
		const fromDisk = await this.readSegsOnlyFromDisk(offset, len);
		for (const chunk of fromDisk) {
			if (!(chunk as NotOnDiskFiniteChunk).type) {
				bytes.push(chunk as Uint8Array);
			} else {
				const chunkBytes = await this.downloadAndSaveSegsChunk(
					chunk as NotOnDiskFiniteChunk
				);
				bytes.push(chunkBytes);
			}
		}
		return joinByteArrs(bytes);
	}

	async readSegsOnlyFromDisk(
		offset: number, len: number
	): Promise<(Uint8Array|NotOnDiskFiniteChunk)[]> {
		const segsLocations = this.objFile.segsLocations(offset, len);
		const bytesAndChunks: (Uint8Array|NotOnDiskFiniteChunk)[] = [];
		for (const chunk of segsLocations) {
			if ((chunk.type === 'new-on-disk')
			|| (chunk.type === 'base-on-disk')) {
				bytesAndChunks.push(...(
					await this.objFile.readSegs(chunk.thisVerOfs, chunk.len)
				));
			} else if (chunk.type === 'base') {
				bytesAndChunks.push(...(
					await this.readBaseBytesFromOtherFilesOnDisk(chunk)
				));
			} else {
				bytesAndChunks.push(chunk);
			}
		}
		return bytesAndChunks;
	}

	private async readBaseBytesFromOtherFilesOnDisk(
		chunk: BaseSegsChunk
	): Promise<(Uint8Array|BaseSegsChunk)[]> {
		const baseVersion = this.objFile.getBaseVersion();
		if (baseVersion === undefined) {
			throw new Error(`File for object ${this.objId}, version ${this.version} points to base, but base is not set`);
		}
		if (!this.getBaseSegsOnDisk) {
			throw new Error(`Object ${this.objId}, version ${this.version} doesn't have a getter of base source`);
		}
		const baseBytesAndChunks = await this.getBaseSegsOnDisk(
			baseVersion, chunk.baseVerOfs, chunk.len
		);
		// now we should convert new->base, adjusting all offsets, cause all those
		// labels are relative to base version, and we need 'em to be relative to
		// this version
		const bytesAndChunks: (Uint8Array|BaseSegsChunk)[] = [];
		let thisVerOfs = chunk.thisVerOfs;
		let baseVerOfs = chunk.baseVerOfs;
		for (const bytesOrChunk of baseBytesAndChunks) {
			if (!(bytesOrChunk as NotOnDiskFiniteChunk).type) {
				const bytes = bytesOrChunk as Uint8Array;
				bytesAndChunks.push(bytes);
				thisVerOfs += bytes.length;
				baseVerOfs += bytes.length;
			} else {
				const len = (bytesOrChunk as NotOnDiskFiniteChunk).len;
				bytesAndChunks.push({ type: 'base', thisVerOfs, baseVerOfs, len });
				thisVerOfs += len;
				baseVerOfs += len;
			}
		}
		return bytesAndChunks;
	}

	private async downloadAndSaveSegsChunk(
		chunk: NotOnDiskFiniteChunk
	): Promise<Uint8Array> {
		if (!this.downloader) {
			throw new Error(`Object ${this.objId}, version ${this.version}, segments section ofs=${chunk.thisVerOfs}, len=${chunk.len} is not on a disk.`);
		}
		const chunkBytes = await this.downloader.getSegs(
			this.objId, this.version,
			chunk.thisVerOfs, chunk.thisVerOfs + chunk.len
		);
		if (chunkBytes.length !== chunk.len) {
			throw new Error(`Download yielded a different length of a segment section`);
		}
		const baseVerOfs = ((chunk.type === 'base') ?
			chunk.baseVerOfs : undefined
		);
		await this.objFile.saveSegs(
			chunkBytes, chunk.thisVerOfs, baseVerOfs, true
		);
		return chunkBytes;
	}

	getSrc(): ObjSource {
		if (!this.readable) {
			throw new Error(`Version ${this.version} of obj ${this.objId} is not readable, yet`);
		}
		const segSrc = wrapAndSyncSource(new ByteSourceFromObjOnDisk(
			(ofs, len) => this.readSegs(ofs, len),
			() => this.objFile.getTotalSegsLen()
		));
		const objSrc: ObjSource = {
			readHeader: () => this.readHeader(),
			segSrc,
			version: this.version
		};
		return Object.freeze(objSrc);
	}

	getBaseVersion(): number|undefined {
		return this.objFile.getBaseVersion();
	}

	absorbImmediateBaseVersion(baseVer: number, path: string): Promise<void> {
		return this.objFile.absorbImmediateBaseVersion(baseVer, path);
	}

	diffFromBase(): { diff: DiffInfo; newSegsPackOrder: FiniteChunk[]; } {
		return this.objFile.diffFromBase();
	}

	private segsThatNeedDownload(): NewSegsChunk[] {
		const totalLen = this.objFile.getTotalSegsLen();
		const allSegs = this.objFile.segsLocations(0, totalLen);
		return allSegs.filter(({ type }) => (type === 'new')) as NewSegsChunk[];
	}

	doesFileNeedDownload(): boolean {
		return (this.segsThatNeedDownload().length === 0);
	}

	async downloadMissingSections(): Promise<void> {
		const needDownload = this.segsThatNeedDownload();
		for (const chunk of needDownload) {
			await this.downloadAndSaveSegsChunk(chunk);
		}
	}

}
Object.freeze(ObjOnDisk.prototype);
Object.freeze(ObjOnDisk);


export interface ObjDownloader {

	getLayoutWithHeaderAndFirstSegs: (
		objId: ObjId, version: number
	) => Promise<InitDownloadParts>;

	getSegs: (
		objId: ObjId, version: number, start: number, end: number
	) => Promise<Uint8Array>;

}

export interface InitDownloadParts {
	layout: Layout;
	header: Uint8Array;
	segs?: Uint8Array;
}

class ByteSourceFromObjOnDisk implements ByteSource {

	private segsPointer = 0;
	
	constructor(
		private readonly readSegs: ObjOnDisk['readSegs'],
		private readonly totalSegsLen: () => number|undefined
	) {
		Object.seal(this);
	}

	async readNext(len: number): Promise<Uint8Array|undefined> {
		assert((Number.isInteger(len) && (len >= 0)) || (len === undefined),
			'Illegal length parameter given: '+len);
		const start = this.segsPointer;
		if (len === undefined) {
			const segsLen = this.totalSegsLen();
			if (segsLen === undefined) {
				throw new Error(`Current implementation has stricter assumptions about use cases, and a state with unknown length of obj file is not expected.`);
			}
			len = segsLen - start;
		}
		const chunk = await this.readSegs(start, len);
		if (chunk.length === 0) { return undefined; }
		this.segsPointer += chunk.length;
		return chunk;
	}
	
	async getSize(): Promise<{ size: number; isEndless: boolean; }> {
		const size = this.totalSegsLen();
		return ((typeof size === 'number') ?
			{ size, isEndless: false } :
			{ size: 0, isEndless: true });
	}
	
	async seek(offset: number): Promise<void> {
		assert(Number.isInteger(offset) && (offset >= 0),
			'Illegal offset is given to seek: '+offset);
		const segsLen = this.totalSegsLen();
		if (segsLen === undefined) {
			this.segsPointer = offset;
		} else {
			this.segsPointer = Math.min(offset, segsLen);
		}
	}

	async readAt(pos: number, len: number): Promise<Uint8Array|undefined> {
		await this.seek(pos);
		return await this.readNext(len);
	}

	async getPosition(): Promise<number> {
		return this.segsPointer;
	}
}
Object.freeze(ByteSourceFromObjOnDisk.prototype);
Object.freeze(ByteSourceFromObjOnDisk);


Object.freeze(exports);