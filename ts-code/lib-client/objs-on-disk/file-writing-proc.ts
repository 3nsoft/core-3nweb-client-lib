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

import { Subscribe, EncrEvent, HeaderEncrEvent, SegEncrEvent } from 'xsp-files';
import { PressureValve } from '../../lib-common/processes';
import { Observable } from 'rxjs';
import { map, filter, mergeMap } from 'rxjs/operators';
import { joinByteArrs } from '../../lib-common/buffer-utils';
import { ObjVersionFile } from '../../lib-common/objs-on-disk/obj-file';
import { flatMapComplete } from '../../lib-common/utils-for-observables';

const SAVING_BUF_SIZE = 512*1024;
const BACKPRESSURE_BUF_SIZE = 5*1024*1024;

export class FileWritingProc {

	private readonly pValve = new PressureValve();
	private buffer: {
		header?: HeaderEncrEvent,
		segs: SegEncrEvent[],
		size: number
	} = { segs: [], size: 0 };

	private constructor(
		private readonly objFile: ObjVersionFile
	) {
		Object.seal(this);
	}

	static makeFor(objFile: ObjVersionFile, encSub: Subscribe):
			Observable<FileWrite[]> {
		const p = new FileWritingProc(objFile);
		return p.assembleProc(encSub);
	}

	private assembleProc(encSub: Subscribe): Observable<FileWrite[]> {
		const ee$ = new Observable<EncrEvent>(
			obs => encSub(obs, this.pValve.pressure));
		const main$ = ee$.pipe(
			map(ee => this.addToBuffer(ee)),
			filter(() => this.canSaveBuffered()),
			mergeMap(() => this.saveBuffered(), 1),
			flatMapComplete(() => this.saveBuffered(true))
		);
		return main$;
	}

	private addToBuffer(ee: EncrEvent): void {
		if (ee.type === 'header') {
			this.objFile.setSegsLayout(ee.layout, false);
			this.buffer.header = ee;
		} else if (ee.type === 'seg') {
			this.buffer.segs.push(ee);
			this.buffer.size += ee.seg.length;
			if (this.buffer.size >= BACKPRESSURE_BUF_SIZE) {
				this.pValve.toggle(true);
			}
		} else {
			this.throwUpOnUnknownEventType(ee);
		}
	}

	private throwUpOnUnknownEventType(ee: EncrEvent): never {
		const err = new Error(`Got an unknown encryption event type "${ee.type}" when saving obj`);
		this.pValve.pressWithError(err);
		throw err;
	}

	private canSaveBuffered(): boolean {
		if (this.buffer.size >= SAVING_BUF_SIZE) { return true; }
		return false;
	}

	private async saveBuffered(isFinal?: boolean): Promise<FileWrite[]> {

		let headerWrite: HeaderWrite|undefined = undefined;
		if (this.buffer.header) {
			await this.objFile.saveHeader(this.buffer.header.header, false);
			headerWrite = {
				isHeader: true,
				bytes: this.buffer.header.header
			};
			this.buffer.header = undefined;
		}

		const segsToSave = this.buffer.segs;
		this.buffer.segs = [];
		this.buffer.size = 0;
		this.pValve.toggle(false);

		const chunksToSave = combineSegsFrom(segsToSave);
		for (const chunk of chunksToSave) {
			await this.objFile.saveSegs(chunk.bytes, chunk.ofs, undefined, false);
		}

		if (isFinal) {
			this.objFile.truncateEndlessLayout();
			await this.objFile.saveLayout();
		}

		if (headerWrite) {
			(chunksToSave as FileWrite[]).unshift(headerWrite);
		}
		return chunksToSave;
	}

}
Object.freeze(FileWritingProc.prototype);
Object.freeze(FileWritingProc);


export interface HeaderWrite {
	isHeader: true;
	bytes: Uint8Array;
}

export interface SegsWrite {
	ofs: number;
	bytes: Uint8Array;
}

export type FileWrite = HeaderWrite | SegsWrite;

function combineSegsFrom(segs: SegEncrEvent[]): SegsWrite[] {
	if (segs.length === 0) { return []; }
	segs.sort((a, b) => {
		if (a.segInfo.packedOfs < b.segInfo.packedOfs) { return -1; }
		else if (a.segInfo.packedOfs > b.segInfo.packedOfs) { return 1; }
		else { throw new Error(`Got bytes with the same offset in file`); }
	});
	let chunkStart = segs[0].segInfo.packedOfs;
	let chunkEnd = chunkStart + segs[0].segInfo.packedLen;
	let chunkSegs: Uint8Array[] = [ segs[0].seg ];
	const chunks: SegsWrite[] = [];
	for (let i=1; i<segs.length; i+=1) {
		const s = segs[i];
		const sOfs = s.segInfo.packedOfs;
		const seg = s.seg;
		if (chunkEnd === sOfs) {
			chunkEnd += seg.length;
			chunkSegs.push(seg);
		} else if (chunkEnd < sOfs) {
			chunks.push({ ofs: chunkStart, bytes: joinByteArrs(chunkSegs) });
			chunkStart = sOfs;
			chunkEnd = chunkStart + seg.length;
			chunkSegs.push(seg);
		} else {
			throw new Error(`Got missorted segment`);
		}
	}
	chunks.push({ ofs: chunkStart, bytes: joinByteArrs(chunkSegs) });
	return chunks;
}

Object.freeze(exports);