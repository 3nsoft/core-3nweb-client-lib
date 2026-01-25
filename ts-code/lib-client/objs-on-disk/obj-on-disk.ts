/*
 Copyright (C) 2018 - 2020, 2022, 2025 - 2026 3NSoft Inc.

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
import { DownloadEventSink, ObjId } from '../xsp-fs/common';
import { ObjSource, Subscribe, Layout, ByteSource } from 'xsp-files';
import { wrapAndSyncSource } from '../../lib-common/byte-streaming/wrapping';
import { assert } from '../../lib-common/assert';
import { FileWritingProc, FileWrite } from './file-writing-proc';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { ObjVersionFile } from '../../lib-common/objs-on-disk/obj-version-file';
import { NotOnDiskFiniteChunk, BaseSegsChunk, FiniteChunk } from '../../lib-common/objs-on-disk/file-layout';
import { flatTap, allowOnlySingleStart } from '../../lib-common/utils-for-observables';
import { DiffInfo } from '../../lib-common/service-api/3nstorage/owner';
import { isPromise } from 'util/types';
import { defer, Deferred } from '../../lib-common/processes/deferred';

type DownloadEvent = web3n.files.DownloadEvent;
type ConnectException = web3n.ConnectException;

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
		private readonly getBaseSegsOnDisk: GetBaseSegsOnDisk|undefined,
		private downloadsInProgress: Download|undefined = undefined
	) {
		if (this.downloadsInProgress) {
			this.downloadsInProgress.saveSegs = this.objFile.saveSegs.bind(this.objFile);
			this.downloadsInProgress.segsThatNeedDownload = this.segsThatNeedDownload.bind(this)
		}
		Object.seal(this);
	}

	static async forExistingFile(
		objId: ObjId, version: number, path: string, downloader?: ObjDownloader, getBase?: GetBaseSegsOnDisk
	): Promise<ObjOnDisk> {
		const objFile = await ObjVersionFile.forExisting(path);
		return new ObjOnDisk(objId, version, objFile, downloader, true, getBase);
	}

	static async createFileForExistingVersion(
		objId: ObjId, version: number, path: string, downloader: ObjDownloader,
		getBase?: GetBaseSegsOnDisk, initDownload?: InitDownloadParts
	): Promise<ObjOnDisk> {
		let download: Download|undefined;
		if (!initDownload) {
			download = new Download(objId, version, downloader);
			initDownload = await download.getInitParts();
		} else {
			download = undefined;
		}
		const { header, layout, segs } = initDownload;
		if (layout.base !== undefined) {
			// XXX with diff-ed downloads can't assume segs' offset to be 0
			throw new Error(`Current implementation cannot consume diff-ed downloads`);
		}
		const objFile = await ObjVersionFile.createNew(path);
		const obj = new ObjOnDisk(objId, version, objFile, downloader, true, getBase, download);
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
		const obj = new ObjOnDisk(objId, version, objFile, downloader, false, getBase);
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
				const chunkBytes = await this.downloads().downloadAndSaveSegsChunk(chunk as NotOnDiskFiniteChunk);
				bytes.push(chunkBytes);
			}
		}
		return joinByteArrs(bytes);
	}

	private downloads(): Download {
		if (!this.downloadsInProgress) {
			if (!this.downloader) {
				throw new Error(`Object ${this.objId}, version ${this.version}, is not on a disk.`);
			}
			this.downloadsInProgress = new Download(
				this.objId, this.version, this.downloader,
				this.objFile.saveSegs.bind(this.objFile), this.segsThatNeedDownload.bind(this)
			);
		}
		return this.downloadsInProgress;
	}

	async readSegsOnlyFromDisk(offset: number, len: number): Promise<(Uint8Array|NotOnDiskFiniteChunk)[]> {
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

	private async readBaseBytesFromOtherFilesOnDisk(chunk: BaseSegsChunk): Promise<(Uint8Array|BaseSegsChunk)[]> {
		const baseVersion = this.objFile.getBaseVersion();
		if (baseVersion === undefined) {
			throw new Error(`File for object ${this.objId}, version ${this.version} points to base, but base is not set`);
		}
		if (!this.getBaseSegsOnDisk) {
			throw new Error(`Object ${this.objId}, version ${this.version} doesn't have a getter of base source`);
		}
		const baseBytesAndChunks = await this.getBaseSegsOnDisk(baseVersion, chunk.baseVerOfs, chunk.len);
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

	getSrc(): ObjSource {
		if (!this.readable) {
			throw new Error(`Version ${this.version} of obj ${this.objId} is not readable, yet`);
		}
		const segSrc = wrapAndSyncSource(new ByteSourceFromObjOnDisk(
			this.readSegs.bind(this),
			this.objFile.getTotalSegsLen.bind(this.objFile)
		));
		const objSrc: ObjSource = {
			readHeader: this.readHeader.bind(this),
			segSrc,
			version: this.version
		};
		return Object.freeze(objSrc);
	}

	getBaseVersion(): number|undefined {
		return this.objFile.getBaseVersion();
	}

	absorbImmediateBaseVersion(baseVer: number, basePath: string): Promise<void> {
		return this.objFile.absorbImmediateBaseVersion(baseVer, basePath);
	}

	diffFromBase(): { diff: DiffInfo; newSegsPackOrder: FiniteChunk[]; } {
		return this.objFile.diffFromBase();
	}

	private segsThatNeedDownload(): NotOnDiskFiniteChunk[] {
		const totalLen = this.objFile.getTotalSegsLen();
		const allSegs = this.objFile.segsLocations(0, totalLen);
		return allSegs.filter(({ type }) => ((type === 'new') || (type === 'base'))) as NotOnDiskFiniteChunk[];
	}

	doesFileNeedDownload(): boolean {
		return (this.segsThatNeedDownload().length !== 0);
	}

	numOfBytesNeedingDownload(): number {
		let totalLen = 0;
		for (const { len } of this.segsThatNeedDownload()) {
			totalLen += len;
		}
		return totalLen;
	}

	startDownloadInBackground(eventSink: DownloadEventSink): number|undefined {
		return this.downloads().downloadAllInBackground(eventSink);
	}

}
Object.freeze(ObjOnDisk.prototype);
Object.freeze(ObjOnDisk);


export class Download {

	private readonly segsAsapRequest: {
		chunk: NotOnDiskFiniteChunk;
		deferred: Deferred<Uint8Array>;
		chunkBytes: Uint8Array[];
		segments: (SectionsToDownload|Promise<Uint8Array>)[];
	}[] = [];

	private initDataRequest: Deferred<InitDownloadParts>|undefined = undefined;

	private inBkgrnd: {
		downloadTaskId: number;
		eventSink: DownloadEventSink;
		totalBytesToDownload: number;
		chunks?: NotOnDiskFiniteChunk[];
		runData?: {
			generator: ReturnType<typeof generateSectionsFrom>;
			currentDownload?: {
				ofs: number;
				len: number;
				deferred: Deferred<Uint8Array>;
			};
		};
	}|undefined = undefined;

	constructor(
		public readonly objId: ObjId,
		public readonly version: number,
		private readonly downloader: ObjDownloader,
		public saveSegs?: ObjVersionFile['saveSegs'],
		public segsThatNeedDownload?: ObjOnDisk['segsThatNeedDownload']
	) {
		Object.seal(this);
	}

	getInitParts(): Promise<InitDownloadParts> {
		if (!this.initDataRequest) {
			this.initDataRequest = defer();
		}
		this.downloader.schedule(this);
		return this.initDataRequest.promise;
	}

	downloadAndSaveSegsChunk(chunk: NotOnDiskFiniteChunk): Promise<Uint8Array> {
		if (!this.saveSegs) {
			throw new Error(`saveSegs is not initialized`);
		}

		// XXX
		//  - check existing requests for overlaps and if there 
		//     - overlaps are cut out into promise only section
		//  - resulting sections' deferred/promised bytes are all awaited, and combined in returned promise

		const segments: SectionsToDownload[] = [];
		const deferred = defer<Uint8Array>();
		this.segsAsapRequest.push({
			chunk,
			deferred,
			chunkBytes: [],
			segments: segments
		});
		const { thisVerOfs: ofs, len } = chunk;
		const generator = generateSectionsFrom(this.downloader.splitSegsDownloads(ofs, ofs+len));
		const next = generator.next();
		segments.push({
			deferred: defer(),
			sectionBytes: [],
			generator,
			nextSection: next.value!
		});
		this.downloader.schedule(this);
		return deferred.promise;
	}

	downloadAllInBackground(eventSink: DownloadEventSink): number|undefined {
		if (!this.segsThatNeedDownload) {
			throw new Error(`segsThatNeedDownload is not initialized`);
		}
		if (this.inBkgrnd) {
			return this.inBkgrnd.downloadTaskId;
		}
		const chunks = this.segsThatNeedDownload();
		if (chunks.length === 0) {
			return;
		}
		this.inBkgrnd = {
			downloadTaskId: Math.floor(Math.random()*Number.MAX_SAFE_INTEGER),
			eventSink,
			totalBytesToDownload: chunks.reduce((total, chunk) => (total+chunk.len), 0)
		};
		eventSink({
			type: 'download-started',
			downloadTaskId: this.inBkgrnd.downloadTaskId,
			path: '',
			version: this.version,
			totalBytesToDownload: this.inBkgrnd.totalBytesToDownload
		});
		if (this.segsAsapRequest.length === 0) {
			this.inBkgrnd.chunks = chunks;
		}
		this.downloader.schedule(this);
		return this.inBkgrnd.downloadTaskId;
	}

	nextActionType(): { runASAP: boolean; }|undefined {
		if (this.initDataRequest) {
			return { runASAP: true };
		} else if (this.segsAsapRequest.length > 0) {
			return { runASAP: true };
		} else if (this.inBkgrnd) {
			return { runASAP: false };
		} else {
			return;
		}
	}

	startNextAction(): Promise<void>|undefined {
		if (this.initDataRequest) {
			return this.processInitDataRequest();
		} else if (this.segsAsapRequest.length > 0) {
			return this.processSomeAsapSegs();
		} else if (this.inBkgrnd) {
			return this.processBkgrnd();
		} else {
			return;
		}
	}

	private async processInitDataRequest(): Promise<void> {
		try {
			const parts = await this.downloader.getLayoutWithHeaderAndFirstSegs(this.objId, this.version);
			this.initDataRequest?.resolve(parts);
		} catch (exc) {
			this.initDataRequest?.reject(exc);
		} finally {
			this.initDataRequest = undefined;
		}
	}

	private async processSomeAsapSegs(): Promise<void> {
		if (this.inBkgrnd?.runData) {
			this.inBkgrnd.runData = undefined;
			this.inBkgrnd.chunks = undefined;
		}
		const { chunk, chunkBytes, deferred, segments } = this.segsAsapRequest[0];
		const segment = segments[0];
		try {
			if (isPromise(segment)) {
				chunkBytes.push(await segment);
				segments.shift();
			} else if (segment.nextSection) {
				const baseVerOfs = ((chunk.type === 'base') ? chunk.baseVerOfs : undefined);
				const { ofs, len } = segment.nextSection;
				const bytes = await this.downloader.getSegs(this.objId, this.version, ofs, ofs+len);
				await this.saveSegs!(bytes, ofs, baseVerOfs, true);
				segment.sectionBytes.push(bytes);
				const next = segment.generator.next();
				if (next.done) {
					chunkBytes.push(...segment.sectionBytes);
					segments.shift();
				} else {
					segment.nextSection = next.value;
				}
			} else {
				chunkBytes.push(...segment.sectionBytes);
				segments.shift();
			}
		} catch (err) {
			deferred.reject(err);
			this.segsAsapRequest.shift();
		}
		if (segments.length === 0) {
			deferred.resolve(joinByteArrs(chunkBytes));
			this.segsAsapRequest.shift();
		}
	}

	private async processBkgrnd(): Promise<void> {
		if (!this.inBkgrnd) {
			return;
		}
		if (!this.inBkgrnd.chunks) {
			this.inBkgrnd.chunks = this.segsThatNeedDownload!();
			if (this.inBkgrnd.chunks.length === 0) {
				this.completeBkgrnd();
				return;
			}
		} else if (this.inBkgrnd.chunks.length === 0) {
			this.completeBkgrnd();
			return;
		}
		const chunk = this.inBkgrnd.chunks[0];
		if (!this.inBkgrnd.runData) {
			const { thisVerOfs: ofs, len } = chunk;
			this.inBkgrnd.runData = {
				generator: generateSectionsFrom(this.downloader.splitSegsDownloads(ofs, ofs+len))
			};
		}
		const next = this.inBkgrnd.runData.generator.next();
		if (next.done) {
			this.inBkgrnd.chunks.shift();
			return;
		}
		const baseVerOfs = ((chunk.type === 'base') ? chunk.baseVerOfs : undefined);
		const { len, ofs } = next.value;
		this.inBkgrnd.runData.currentDownload = { ofs, len, deferred: defer() };
		this.inBkgrnd.runData.currentDownload.deferred.promise.catch(noop);
		try {
			const bytes = await this.downloader.getSegs(this.objId, this.version, ofs, ofs+len);
			await this.saveSegs!(bytes, ofs, baseVerOfs, true);
			this.emitDownloadEvent('download-progress', {
				totalBytesToDownload: this.inBkgrnd!.totalBytesToDownload,
				bytesLeftToDownload: this.inBkgrnd.chunks.slice(1).reduce((total, chunk) => (total+chunk.len), 0) + (
					chunk.len - (ofs+len - chunk.thisVerOfs)
				)
			});
			this.inBkgrnd.runData.currentDownload.deferred.resolve(bytes);
		} catch (exc) {
			if ((exc as ConnectException).type === 'connect') {
				await this.downloader.whenConnected();
			} else {
				this.inBkgrnd.runData.currentDownload.deferred.reject(exc);
			}
		} finally {
			this.inBkgrnd.runData.currentDownload = undefined;
		}
	}

	private completeBkgrnd(): void {
		this.emitDownloadEvent('download-done', {});
		this.inBkgrnd = undefined;
	}

	private emitDownloadEvent(type: DownloadEvent['type'], field: Partial<DownloadEvent>): void {
		this.inBkgrnd?.eventSink({
			type,
			path: '',
			version: this.version,
			downloadTaskId: this.inBkgrnd!.downloadTaskId,
			...field
		} as any);
	}

}
Object.freeze(Download.prototype);
Object.freeze(Download);


interface SectionsToDownload {
	generator: ReturnType<typeof generateSectionsFrom>;
	deferred: Deferred<Uint8Array>;
	sectionBytes: Uint8Array[];
	nextSection?: { ofs: number; len: number; };
}


export interface ObjDownloader {

	getLayoutWithHeaderAndFirstSegs: (objId: ObjId, version: number) => Promise<InitDownloadParts>;

	getSegs: (objId: ObjId, version: number, start: number, end: number) => Promise<Uint8Array>;

	splitSegsDownloads: (start: number, end: number) => Section[];

	schedule: (download: Download) => void;

	whenConnected: () => Promise<void>;

}

export interface InitDownloadParts {
	layout: Layout;
	header: Uint8Array;
	segs?: Uint8Array;
}

export class DownloadsRunner {

	private readonly downloads = new Map<Download, {
		pool: ExecPool;
		isRunning: boolean;
	}>();

	private readonly longRunsPool: ExecPool;
	private readonly asapPool: ExecPool;

	constructor(asapPoolMax = 5, longPoolMax = 1) {
		this.asapPool = makeExecPool(asapPoolMax);
		this.longRunsPool = makeExecPool(longPoolMax);
		Object.seal(this);
	}

	schedule(download: Download): void {
		const found = this.downloads.get(download);
		if (found) {
			if (found.isRunning) {
				return;
			} else {
				const next = download.nextActionType();
				if (!next) {
					this.removeDownload(download);
					return;
				}
				const pool = (next.runASAP ? this.asapPool : this.longRunsPool);
				if (found.pool !== pool) {
					removeFromArray(found.pool.queue, download);
					found.pool = pool;
					found.pool.queue.push(download);
				}
			}
		} else {
			const next = download.nextActionType();
			if (!next) {
				this.removeDownload(download);
				return;
			}
			const pool = (next.runASAP ? this.asapPool : this.longRunsPool)
			this.downloads.set(download, { isRunning: false, pool });
			pool.queue.push(download);
		}
		this.triggerRuns();
	}

	private removeDownload(download: Download): void {
		const found = this.downloads.get(download);
		if (found) {
			this.downloads.delete(download);
			removeFromArray(found.pool.queue, download);
		}
	}

	private triggerRuns(): void {
		this.triggerRunsInPool(this.asapPool);
		this.triggerRunsInPool(this.longRunsPool);
	}

	private triggerRunsInPool(pool: ExecPool): void {
		while ((pool.queue.length > 0) && (pool.numOfRunning < pool.max)) {
			const download = pool.queue.shift()!;
			const info = this.downloads.get(download);
			if (!info) {
				continue;
			}
			let promise = download.startNextAction();
			if (!promise) {
				this.removeDownload(download);
				continue;
			}
			info.isRunning = true;
			pool.numOfRunning += 1;
			if (pool === this.asapPool) {
				promise = promise.then(
					() => {
						const next = download.nextActionType();
						if (!next) {
							this.removeDownload(download);
							return;
						}
						if (next.runASAP) {
							this.asapPool.queue.unshift(download);
						} else {
							this.longRunsPool.queue.push(download);
							info.pool = this.longRunsPool;
						}
					}
				);
			} else {
				promise = promise.then(
					() => {
						const next = download.nextActionType();
						if (!next) {
							this.removeDownload(download);
							return;
						}
						if (next.runASAP) {
							this.asapPool.queue.push(download);
							info.pool = this.asapPool;
						} else {
							this.longRunsPool.queue.unshift(download);
						}
					},
					(_exc) => {
						this.longRunsPool.queue.unshift(download);
					}
				)
			}
			promise.finally(() => {
				info.isRunning = false;
				pool.numOfRunning -= 1;
				this.triggerRuns();
			});
		}
	}

}
Object.freeze(DownloadsRunner.prototype);
Object.freeze(DownloadsRunner);

interface ExecPool {
	queue: Download[];
	max: number;
	numOfRunning: number;
}

function makeExecPool(max: number): ExecPool {
	return { queue: [], max, numOfRunning: 0 };
}

function removeFromArray<T>(arr: T[], elem: T): void {
	const ind = arr.indexOf(elem);
	if (ind >= 0) {
		arr.splice(ind, 1);
	}
}

export interface Section {
	ofs: number;
	len: number;
	repeatCount?: number;
	repeatLen?: number;
}

export function splitSegsDownloads(start: number, end: number, max: number): Section[] {
	const parts: Section[] = [];
	let ofs = start;
	const repeatCount = Math.floor((end - start) / max);
	if (repeatCount > 1) {
		const repeatLen = max * repeatCount;
		parts.push({ ofs, len: max, repeatCount, repeatLen });
		ofs += repeatLen;
	} else if (repeatCount === 1) {
		parts.push({ ofs, len: max });
		ofs += max;
	}
	const tailLen = end - ofs;
	if (tailLen > 0) {
		parts.push({ ofs, len: tailLen });
	}
	return parts;
}

export function* generateSectionsFrom(sections: Section[]) {
	for (const { ofs, len, repeatCount, repeatLen } of sections) {
		if (repeatCount) {
			for (let i=0; i<repeatCount; i+=1) {
				yield { ofs: ofs+(i*len), len };
			}
		} else {
			yield { ofs, len };
		}
	}
}

function noop() {}


class ByteSourceFromObjOnDisk implements ByteSource {

	private segsPointer = 0;
	
	constructor(
		private readonly readSegs: ObjOnDisk['readSegs'],
		private readonly totalSegsLen: () => number|undefined
	) {
		Object.seal(this);
	}

	async readNext(len: number|undefined): Promise<Uint8Array|undefined> {
		assert((len === undefined) || (Number.isInteger(len) && (len >= 0)),
			'Illegal length parameter given: '+len
		);
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
			{ size: 0, isEndless: true }
		);
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