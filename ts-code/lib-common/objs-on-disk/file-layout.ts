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
 this program. If not, see <http://www.gnu.org/licenses/>. */

import { V1_FILE_START, layoutV1 } from "./v1-obj-file-format";
import { assert } from "../assert";
import { Layout, LayoutBaseSection, LayoutNewSection } from "xsp-files";
import { copy as copyJSON } from '../json-utils';

export interface HeaderChunkInfo {
	len: number;
	fileOfs: number;
}

export type NotOnDiskFiniteChunk = NewSegsChunk | BaseSegsChunk;

export type OnDiskChunk = NewSegsChunkOnDisk | BaseSegsChunkOnDisk;

export type FiniteSegsChunk = OnDiskChunk | NotOnDiskFiniteChunk;

export type SegsChunk =
	OnDiskChunk | NotOnDiskFiniteChunk | NewEndlessSegsChunk;

export interface FiniteChunk {
	thisVerOfs: number;
	len: number;
}

export interface BaseSegsChunk extends FiniteChunk {
	type: 'base';
	baseVerOfs: number;
}

export interface BaseSegsChunkOnDisk extends FiniteChunk {
	type: 'base-on-disk';
	baseVerOfs: number;
	fileOfs: number;
}

export interface NewSegsChunk extends FiniteChunk {
	type: 'new';
	len: number;
}

export interface NewEndlessSegsChunk {
	type: 'new-endless';
	thisVerOfs: number;
}

export interface NewSegsChunkOnDisk extends FiniteChunk {
	type: 'new-on-disk';
	fileOfs: number;
}

export interface NewSegsChunk extends FiniteChunk {}

export class ObjVersionBytesLayout {

	private headerChunk: HeaderChunkInfo|undefined = undefined;
	private segsChunks: SegsChunk[] = [];
	private baseVersion: number|undefined = undefined;
	private segsLayoutFrozen = false;

	private constructor(
		private bytesEnd: number
	) {
		Object.seal(this);
	}

	static forNewFile(): ObjVersionBytesLayout {
		return new ObjVersionBytesLayout(V1_FILE_START.length + 8);
	}

	static fromV1Bytes(layoutOfs: number, layoutBytes: Buffer):
			ObjVersionBytesLayout {
		const attrs = layoutV1.fromBytes(layoutBytes, 0);
		const layout = new ObjVersionBytesLayout(layoutOfs);
		layout.headerChunk = attrs.headerChunk;
		layout.segsChunks = attrs.segsChunks;
		if (attrs.baseVersion !== undefined) {
			layout.baseVersion = attrs.baseVersion;
		}
		layout.segsLayoutFrozen = attrs.segsLayoutFrozen;
		return layout;
	}

	toBytes(): Buffer {
		return layoutV1.toBytes({
			segsLayoutFrozen: this.segsLayoutFrozen,
			headerChunk: this.headerChunk,
			segsChunks: this.segsChunks,
			baseVersion: this.baseVersion,
			allBaseBytesInFile: this.areAllBaseBytesInThisFile(),
			sizeUnknown: this.isLayoutEndless(),
			fileComplete: this.isFileComplete()
		});
	}

	getTotalSegsLen(): number {
		if (this.segsChunks.length === 0) { return 0; }
		let lastChunk = this.segsChunks[this.segsChunks.length-1];
		if (lastChunk.type === 'new-endless') {
			if (this.segsChunks.length === 1) { return 0; }
			lastChunk = this.segsChunks[this.segsChunks.length-2];
			if (lastChunk.type === 'new-endless') { throw new Error(
				`Obj file layout has two endless segments`); }
		}
		return (lastChunk.thisVerOfs + lastChunk.len);
	}

	isLayoutEndless(): boolean {
		if (this.segsChunks.length === 0) { return false; }
		const lastChunk = this.segsChunks[this.segsChunks.length-1];
		return (lastChunk.type === 'new-endless');
	}

	isLayoutFrozen(): boolean {
		return this.segsLayoutFrozen;
	}

	isFileComplete(): boolean {
		return !this.segsChunks.find(
			chunk => ((chunk.type === 'new') || (chunk.type === 'new-endless')));
	}

	getLayoutOfs(): number {
		return this.bytesEnd;
	}

	headerLocation(): HeaderChunkInfo|undefined {
		return this.headerChunk;
	}

	segsLocations(thisVerOfs: number, len: number): FiniteSegsChunk[] {
		assert(Number.isInteger(thisVerOfs) && (thisVerOfs >= 0));
		assert(Number.isInteger(len) && (len >= 0));
		const segInfos: FiniteSegsChunk[] = [];
		const end = thisVerOfs + len;
		for (let i=0; (i<this.segsChunks.length)&&(len>0); i+=1) {
			const chunk = this.segsChunks[i];
			const chunkEnd = chunk.thisVerOfs + ((chunk.type === 'new-endless') ?
				Number.MAX_SAFE_INTEGER : chunk.len);
			if (chunkEnd <= thisVerOfs) { continue; }
			if (end <= chunk.thisVerOfs) { break; }
			if (thisVerOfs < chunk.thisVerOfs) {
				if (this.segsLayoutFrozen) { throw new Error(
					`File contains a hole, while segs layout is frozen`); }
				const chop: NewSegsChunk = {
					type: 'new',
					thisVerOfs,
					len: chunk.thisVerOfs - thisVerOfs
				};
				segInfos.push(chop);
				thisVerOfs += chop.len;
				len -= chop.len;
			} else {
				const chop = copyJSON(chunk) as FiniteSegsChunk;
				chop.thisVerOfs = thisVerOfs;
				if (chunk.type === 'new-endless') {
					chop.type = 'new';
					chop.len = end - chop.thisVerOfs;
				} else {
					chop.len = Math.min(end, chunkEnd) - chop.thisVerOfs;
				}
				const chopOfs = thisVerOfs - chunk.thisVerOfs;
				if ((chop.type === 'base') || (chop.type == 'base-on-disk')) {
					chop.baseVerOfs = (chunk as typeof chop).baseVerOfs + chopOfs;
				}
				if ((chop.type === 'new-on-disk')
				|| (chop.type == 'base-on-disk')) {
					chop.fileOfs = (chunk as typeof chop).fileOfs + chopOfs;
				}
				segInfos.push(chop);
				thisVerOfs += chop.len;
				len -= chop.len;
			}
		}
		if ((len > 0) && !this.segsLayoutFrozen) {
			segInfos.push({ type: 'new', thisVerOfs, len });
		}
		return segInfos;
	}

	private areAllBaseBytesInThisFile(): boolean {
		if (this.baseVersion === undefined) { return false; }
		for (const chunk of this.segsChunks) {
			if (chunk.type === 'base') { return false; }
		}
		return true;
	}

	setAndFreezeWith(layout: Layout): void {
		if (this.segsLayoutFrozen) { throw new Error(
			`Obj segments layout is frozen, and can't be set to new value`); }
		this.segsChunks = combineChunksOnDiskWithLayout(
			layoutSectionsToSegsChunks(layout.sections), this.segsChunks);
		ensureNoHolesIn(this.segsChunks);
		this.baseVersion = layout.base;
		this.segsLayoutFrozen = true;
	}

	truncateIfEndless(): void {
		if (!this.isLayoutEndless()) { return; }
		this.segsChunks.pop();
	}

	private ensureExpectedFileOfs(fileOfs: number): void {
		if (fileOfs !== this.bytesEnd) { throw new Error(
			`Given file offset ${fileOfs} does not equal expected value ${this.bytesEnd}`); }
	}

	addHeader(len: number, fileOfs: number): void {
		this.ensureExpectedFileOfs(fileOfs);
		assert(Number.isInteger(len) && (len >= 0));
		if (this.headerChunk) { throw new Error(
			`Header added second time to obj version bytes layout`); }
		this.headerChunk = { len, fileOfs };
		Object.freeze(this.headerChunk);	// we share it, so better in frozen form
		this.bytesEnd += len;
	}

	addSegsOnFile(thisVerOfs: number, len: number, fileOfs: number): void {
		this.ensureExpectedFileOfs(fileOfs);
		assert(Number.isInteger(thisVerOfs) && (thisVerOfs >= 0));
		assert(Number.isInteger(len) && (len >= 0));
		const s: NewSegsChunkOnDisk = {
			type: 'new-on-disk', thisVerOfs, len, fileOfs };
		addNewSegsChunkTo(this.segsChunks, s);
		this.bytesEnd += len;
	}

	addBaseSegsOnFile(thisVerOfs: number, baseVerOfs: number, len: number,
			fileOfs: number): void {
		this.ensureExpectedFileOfs(fileOfs);
		assert(Number.isInteger(thisVerOfs) && (thisVerOfs >= 0));
		assert(Number.isInteger(baseVerOfs) && (baseVerOfs >= 0));
		assert(Number.isInteger(len) && (len >= 0));
		const s: BaseSegsChunkOnDisk = {
			type: 'base-on-disk', thisVerOfs, baseVerOfs, len, fileOfs };
		addBaseSegsChunkTo(this.segsChunks, s);
		this.bytesEnd += len;
	}

	getBaseVersion(): number|undefined {
		return this.baseVersion;
	}

}
Object.freeze(ObjVersionBytesLayout.prototype);
Object.freeze(ObjVersionBytesLayout);

function layoutSectionsToSegsChunks(sections: Layout['sections']):
		SegsChunk[] {
	let expectedThisVerOfs = 0;
	const chunks: SegsChunk[] = [];
	for (const section of sections) {
		if (section.ofs !== expectedThisVerOfs) { throw new Error(
			`Layout section has offset ${section.ofs}, while expected value is ${expectedThisVerOfs}`); }
		const chunk = layoutSectionToSegsChunk(section);
		if (chunk.type === 'new-endless') {
			assert(sections[sections.length-1] === section,
				`Infinite layout section must be the last section`);
		} else {
			chunks.push(chunk);
			expectedThisVerOfs += chunk.len;
		}
	}
	return chunks;
}

function layoutSectionToSegsChunk(section: LayoutBaseSection|LayoutNewSection):
		SegsChunk {
	if (section.src === 'base') {
		return {
			type: 'base',
			thisVerOfs: section.ofs,
			len: section.len,
			baseVerOfs: section.baseOfs
		};
	} else if (section.src === 'new') {
		if (section.len === undefined){
			return {
				type: 'new-endless',
				thisVerOfs: section.ofs,
			};
		} else {
			return {
				type: 'new',
				thisVerOfs: section.ofs,
				len: section.len
			};
		}
	} else {
		throw new Error(`Layout section has unknown src`);
	}
}

function combineChunksOnDiskWithLayout(
		layout: SegsChunk[], chunks: SegsChunk[]): SegsChunk[] {
	for (const chunk of chunks) {
		if (chunk.type === 'new-on-disk') {
			addNewSegsChunkTo(layout, chunk);
		} else if (chunk.type === 'base-on-disk') {
			addBaseSegsChunkTo(layout, chunk);
		} else {
			throw new Error(`Have chunk type ${chunk.type} before layout is set`);
		}
	}
	return layout;
}

function addNewSegsChunkTo(segsChunks: SegsChunk[],
		newChunk: NewSegsChunkOnDisk): void {
	const newChunkEnd = newChunk.thisVerOfs + newChunk.len;
	// find insertion index
	let insertInd = 0;
	for (let i=(segsChunks.length-1); i>=0; i-=1) {
		const chunk = segsChunks[i];
		if (newChunkEnd <= chunk.thisVerOfs) { continue; }
		if (chunk.type !== 'new-endless') {
			const chunkEnd = chunk.thisVerOfs + chunk.len;
			if (chunkEnd <= newChunk.thisVerOfs) {
				insertInd = i+1;
				break;
			}
		}
		// here chunks overlap
		if ((chunk.type !== 'new')
		&& (chunk.type !== 'new-endless')) { throw new Error(
			`Have a non-merging overlap of new section ${JSON.stringify(newChunk)}, and an existing one ${JSON.stringify(chunk)}`); }
		// cut and insert left non-overlapping side of chunk
		if (chunk.thisVerOfs < newChunk.thisVerOfs) {
			const leftSide: NewSegsChunk = {
				type: 'new',
				thisVerOfs: chunk.thisVerOfs,
				len: newChunk.thisVerOfs - chunk.thisVerOfs
			};
			segsChunks.splice(i, 0, leftSide);
			i += 1;
		}
		// cut and insert right non-overlapping side of chunk
		if (chunk.type === 'new') {
			const chunkEnd = chunk.thisVerOfs + chunk.len;
			if (newChunkEnd < chunkEnd) {
				const rightSide: NewSegsChunk = {
					type: 'new',
					thisVerOfs: newChunkEnd,
					len: chunkEnd - newChunkEnd
				};
				segsChunks.splice(i+1, 0, rightSide);
			}
		} else if (chunk.type === 'new-endless') {
			const rightSide: NewEndlessSegsChunk = {
				type: 'new-endless',
				thisVerOfs: newChunkEnd
			};
			segsChunks.splice(i+1, 0, rightSide);
		}
		// cut chunk, and insert newChunk in following common logic,
		// cause it checks for possible merges
		segsChunks.splice(i, 1);
		insertInd = i;
		break;
	}
	insertOrMergeChunkAt(segsChunks, insertInd, newChunk);
}

function insertOrMergeChunkAt(segsChunks: SegsChunk[], insertInd: number,
		chunk: OnDiskChunk): void {
	let left = ((insertInd > 0) ? segsChunks[insertInd-1] : undefined);
	let right = ((insertInd < segsChunks.length) ?
		segsChunks[insertInd] : undefined);
	if (left && canMergeChunks(left, chunk)) {
		(left as OnDiskChunk).len += chunk.len;
		if (right && canMergeChunks(left, right)) {
			(left as OnDiskChunk).len += (right as OnDiskChunk).len;
			segsChunks.splice(insertInd, 1);
		}
	} else if (right && canMergeChunks(chunk, right)) {
		chunk.len += (right as OnDiskChunk).len;
		segsChunks[insertInd] = chunk;
	} else {
		segsChunks.splice(insertInd, 0, chunk);
	}
}

function canMergeChunks(a: SegsChunk, b: SegsChunk): boolean {
	if (a.type !== b.type) { return false; }
	if (a.type === 'new-endless') { throw new Error(
		`Attepmt to place segs chunk after an endless chunk`); }
	if ((a.thisVerOfs + a.len) !== b.thisVerOfs) { return false; }
	if ((a.type === 'new-on-disk') || (a.type === 'base-on-disk')) {
		if ((a.fileOfs + a.len) !== (b as OnDiskChunk).fileOfs) { return false; }
	}
	return true;
}

function addBaseSegsChunkTo(segsChunks: SegsChunk[],
		baseChunk: BaseSegsChunkOnDisk): void {
	const baseChunkEnd = baseChunk.thisVerOfs + baseChunk.len;
	// find insertion index
	let insertInd = 0;
	for (let i=(segsChunks.length-1); i>=0; i-=1) {
		const chunk = segsChunks[i];
		if (baseChunkEnd <= chunk.thisVerOfs) { continue; }
		if (chunk.type !== 'new-endless') {
			const chunkEnd = chunk.thisVerOfs + chunk.len;
			if (chunkEnd <= baseChunk.thisVerOfs) {
				insertInd = i+1;
				break;
			}
		}
		// here chunks overlap
		if (chunk.type !== 'base') { throw new Error(
			`Have a non-merging overlap of new section ${JSON.stringify(baseChunk)}, and an existing one ${JSON.stringify(chunk)}`); }
		// cut and insert left non-overlapping side of chunk
		if (chunk.thisVerOfs < baseChunk.thisVerOfs) {
			const leftSide: BaseSegsChunk = {
				type: 'base',
				thisVerOfs: chunk.thisVerOfs,
				baseVerOfs: chunk.baseVerOfs,
				len: baseChunk.thisVerOfs - chunk.thisVerOfs
			};
			segsChunks.splice(i, 0, leftSide);
			i += 1;
		}
		// cut and insert right non-overlapping side of chunk
		const chunkEnd = chunk.thisVerOfs + chunk.len;
		if (baseChunkEnd < chunkEnd) {
			const rightSide: BaseSegsChunk = {
				type: 'base',
				thisVerOfs: baseChunkEnd,
				baseVerOfs: baseChunk.baseVerOfs + baseChunk.len,
				len: chunkEnd - baseChunkEnd
			};
			segsChunks.splice(i+1, 0, rightSide);
		}
		// cut chunk, and insert newChunk in following common logic,
		// cause it checks for possible merges
		segsChunks.splice(i, 1);
		insertInd = 1;
		break;
	}
	insertOrMergeChunkAt(segsChunks, insertInd, baseChunk);
}

function ensureNoHolesIn(segsChunks: SegsChunk[]): void {
	let thisVerOfs = 0;
	for (let i=0; i<segsChunks.length; i+=1) {
		const chunk = segsChunks[i];
		if (chunk.thisVerOfs === thisVerOfs) {
			if (chunk.type === 'new-endless') {
				if (chunk !== segsChunks[segsChunks.length-1]) {
					throw new Error(`Endless segs chunk is at index ${i} in ${segsChunks.length} chunks chain`);
				}
			} else {
				thisVerOfs += chunk.len;
			}
		} else if (chunk.thisVerOfs > thisVerOfs) {
			throw new Error(`There is a hole in segs chunks from position ${thisVerOfs} to start of chunk ${i} with position ${chunk.thisVerOfs}`);
		} else {
			throw new Error(`Segs chunk ${i} has offset ${chunk.thisVerOfs} that is smaller than expected ${thisVerOfs}`);
		}
	}
}

Object.freeze(exports);