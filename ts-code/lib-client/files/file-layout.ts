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
import { uintFrom8Bytes, packUintTo8Bytes } from "../../lib-common/big-endian";
import { copy as copyJSON } from "../../lib-common/json-utils";
import { ByteSource, Layout } from "xsp-files";

type FileLayout = web3n.files.FileLayout;

export interface ContentSection {
	ofsInSrc?: number;
	ofs: number;
	len: number;
}

export class ROFileLayout {

	private constructor(
		private readonly sections: ContentSection[],
		private readonly layoutOfs: number
	) {
		Object.freeze(this);
	}

	static orderedWithSize(size: number): ROFileLayout {
		return new ROFileLayout(continuousSections(size), size);
	}

	static async readFromSrc(
		src: ByteSource, layoutOfs: number
	): Promise<ROFileLayout> {
		const sections = await readSectionsFrom(src, layoutOfs);
		return new ROFileLayout(sections, layoutOfs);
	}

	get contentSize(): number {
		return sizeOfSections(this.sections);
	}

	getSectionsIn(ofs: number, len: number|undefined): ContentSection[] {
		return getSectionsIn(this.sections, ofs, len);
	}

	makeWritableClone(): RWFileLayout {
		return new RWFileLayout(copyJSON(this.sections), this.layoutOfs);
	}

}
Object.freeze(ROFileLayout.prototype);
Object.freeze(ROFileLayout);


function sizeOfSections(sections: ContentSection[]): number {
	if (sections.length === 0) { return 0; }
	const last = sections[sections.length-1];
	return (last.ofs + last.len);
}

function continuousSections(size: number): ContentSection[] {
	assert(Number.isInteger(size) && (size >= 0));
	return ((size === 0) ? [] : [ { ofsInSrc: 0, ofs: 0, len: size } ]);
}

function getSectionsIn(
	sections: ContentSection[], ofs: number, len: number|undefined
): ContentSection[] {
	assert(Number.isInteger(ofs) && (ofs >= 0));
	assert((len === undefined) || (Number.isInteger(len) && (len >= 0)));
	const contentSize = sizeOfSections(sections);
	if ((contentSize <= ofs) || (len === 0)) { return []; }

	const fstInd = sections.findIndex(
		s => ((s.ofs <= ofs) && (ofs < (s.ofs + s.len))));
	const s = [ copySectionMovingOfs(sections[fstInd], ofs) ];

	const end = ((len === undefined) ? undefined : ofs + len);
	const lastInd = (((end === undefined) || (end >= contentSize)) ?
		sections.length - 1 :
		sections.findIndex(s => (end <= (s.ofs + s.len))));

	for (let i=(fstInd+1); i<=lastInd; i+=1) {
		s.push(copyJSON(sections[i]));
	}

	if (end !== undefined) {
		const last = s[s.length-1];
		const sEnd = last.ofs + last.len;
		if (end < sEnd) {
			last.len -= sEnd - end;
		}
	}
	return s;
}


/**
 * This layout expects that writes of new bytes always append raw source,
 * while cuts in raw source remove base bytes, but don't remove already written
 * new bytes, leaving them as noise.
 */
export class RWFileLayout {

	private writePosition: number;

	constructor(
		private readonly sections: ContentSection[],
		private srcBaseLen: number,
	) {
		this.writePosition = this.srcBaseLen;
		Object.seal(this);
	}

	static orderedWithBaseSize(size: number): RWFileLayout {
		return new RWFileLayout(continuousSections(size), size);
	}

	static async readFromSrc(
		src: ByteSource, layoutOfs: number
	): Promise<RWFileLayout> {
		const sections = await readSectionsFrom(src, layoutOfs);
		return new RWFileLayout(sections, layoutOfs);
	}

	get contentSize(): number {
		return sizeOfSections(this.sections);
	}

	getSectionsIn(ofs: number, len: number|undefined): ContentSection[] {
		return getSectionsIn(this.sections, ofs, len);
	}

	getLayoutOfsInSink(): number {
		return this.writePosition;
	}

	packIfNotTrivial(
		sinkLen: { size: number; isEndless: boolean; }
	): Uint8Array|undefined {
		return (this.isTrivialLayout(sinkLen.size, sinkLen.isEndless) ?
			undefined : packSections(this.sections));
	}

	private isTrivialLayout(sinkSize: number, isSinkEndless: boolean): boolean {
		if (isSinkEndless) { return false; }
		if (this.sections.length === 0) {
			return (sinkSize === 0);
		} else if (this.sections.length === 1) {
			const s = this.sections[0];
			return ((s.ofsInSrc === 0) && (s.ofs === 0) && (s.len === sinkSize));
		} else {
			return false;
		}
	}

	toFileLayoutBasedOnSegs(segs: Layout): FileLayout {
		const l: FileLayout = { sections: [] };
		if (typeof segs.base !== 'number') {
			l.base = segs.base;
		}
		for (const s of this.sections) {
			if (typeof s.ofsInSrc === 'number') {
				l.sections.push(...contentSectionsInSegs(
					segs.sections, s.ofsInSrc, s.ofs, s.len));
			} else {
				l.sections.push({ src: 'empty', ofs: s.ofs, len: s.len });
			}
		}
		compressLayoutSections(l.sections);
		return l;
	}

	private findOffsetPosition(ofs: number): OffsetPoint|undefined {
		for (let ind=0; ind<this.sections.length; ind+=1) {
			const s = this.sections[ind];
			if ((s.ofs <= ofs) && (ofs < (s.ofs + s.len))) {
				return { s, ind, sOfs: ofs - s.ofs };
			}
		}
		return;
	}

	cutSection(ofs: number, len: number): Cut[] {
		const left = this.findOffsetPosition(ofs);
		if (!left) { return []; }

		const right = this.findOffsetPosition(ofs + len);
		if (!right) {
			let cuts: ContentSection[];
			if (left.sOfs === 0) {
				cuts = this.sections.splice(left.ind, this.sections.length);
			} else {
				cuts = this.sections.splice(left.ind+1, this.sections.length);
				const cutOnLeft = cutTailOf(left.s, left.sOfs);
				cuts.push(cutOnLeft);
			}
			return this.turnToBaseCutsAdjustingSrcOfs(cuts);
		}

		if (left.s === right.s) {
			let cuts: ContentSection[];
			if (left.sOfs === 0) {
				cuts = [ cutHeadOf(left.s, right.sOfs) ];
				this.shiftSectonOffsets(left.ind, -len);
			} else {
				const newRight = cutTailOf(left.s, right.sOfs);
				cuts = [ cutTailOf(left.s, left.sOfs) ];
				this.sections.splice(left.ind+1, 0, newRight);
				this.shiftSectonOffsets(left.ind+1, -len);
			}
			this.checkAndCompactFourSections(Math.max(left.ind-1, 0));
			return this.turnToBaseCutsAdjustingSrcOfs(cuts);
		}

		let cuts: ContentSection[];
		if (left.sOfs === 0) {
			cuts = this.sections.splice(left.ind, right.ind - left.ind);
			if (right.sOfs > 0) {
				const cutOnRight = cutHeadOf(right.s, right.sOfs);
				cuts.push(cutOnRight);
			}
			this.shiftSectonOffsets(left.ind, -len);
		} else {
			cuts = this.sections.splice(left.ind+1, right.ind - left.ind - 1);
			const cutOnLeft = cutTailOf(left.s, left.sOfs);
			cuts.push(cutOnLeft);
			if (right.sOfs > 0) {
				const cutOnRight = cutHeadOf(right.s, right.sOfs);
				cuts.push(cutOnRight);
			}
			this.shiftSectonOffsets(left.ind+1, -len);
		}
		this.checkAndCompactFourSections(Math.max(left.ind-1, 0));
		return this.turnToBaseCutsAdjustingSrcOfs(cuts);
	}

	private shiftSectonOffsets(fromInd: number, delta: number): void {
		for (let i=fromInd; i<this.sections.length; i+=1) {
			this.sections[i].ofs += delta;
		}
	}

	private turnToBaseCutsAdjustingSrcOfs(cuts: ContentSection[]): Cut[] {
		const baseSections: Cut[] = [];
		let totalCutLen = 0;
		for (const s of cuts) {
			
			if ((typeof s.ofsInSrc === 'number')
			&& (s.ofsInSrc < this.srcBaseLen)) {
				const cut: Cut = {
					len: Math.min(s.len, this.srcBaseLen - s.ofsInSrc),
					ofs: s.ofsInSrc
				}
				baseSections.push(cut);
				totalCutLen += cut.len;
			}
		}
		this.srcBaseLen -= totalCutLen;
		this.writePosition -= totalCutLen;
		assert(this.srcBaseLen >= 0);
		for (const b of baseSections) {
			for (const s of this.sections) {
				if ((typeof s.ofsInSrc === 'number') && (b.ofs < s.ofsInSrc)) {
					s.ofsInSrc -= b.len;
					assert(s.ofsInSrc >= 0);
				}
			}
		}
		return baseSections;
	}

	private checkAndCompactFourSections(startInd: number): void {
		for (let i=0; i<3; i+=1) {
			const leftInd = startInd + i;
			const rightInd = leftInd + 1;
			if (rightInd >= this.sections.length) { return; }
			const left = this.sections[leftInd];
			const right = this.sections[rightInd];
			assert(((left.ofs + left.len) === right.ofs) && (right.len > 0));
			if (left.ofsInSrc === undefined) {
				if (right.ofsInSrc !== undefined) { continue; }
			} else {
				if ((right.ofsInSrc === undefined)
				|| ((left.ofsInSrc + left.len) !== right.ofsInSrc)) { continue; }
			}
			left.len += right.len;
			this.sections.splice(rightInd, 1);
			i -= 1;
		}
	}

	appendEmptySection(len: number): void {
		if (this.sections.length > 0) {
			const lastSec = this.sections[this.sections.length - 1];
			if (typeof lastSec.ofsInSrc !== 'number') {
				lastSec.len += len;
			} else {
				this.sections.push({ ofs: (lastSec.ofs + lastSec.len), len });
			}
		} else {
			this.sections.push({ ofs: 0, len });
		}
	}

	insertSection(ofs: number, len: number): number {
		const initContentSize = this.contentSize;
		const ofsInSrc = this.writePosition;
		this.writePosition += len;

		// adding at the end
		if (initContentSize <= ofs) {
			const gapLen = ofs - initContentSize;
			if (gapLen > 0) {
				this.appendEmptySection(gapLen);
			}
			this.sections.push({ ofs, len, ofsInSrc });
			if (this.sections.length >= 2) {
				this.checkAndCompactFourSections(this.sections.length-2);
			}
			return ofsInSrc;
		}

		// inserting inside
		const insPos = this.findOffsetPosition(ofs);
		if (!insPos) { throw new Error(`Can't find ofs=${ofs} in sections`); }
		const newSection: ContentSection = { ofs, len, ofsInSrc };
		if (insPos.sOfs === 0) {
			this.sections.splice(insPos.ind, 0, newSection);
			this.shiftSectonOffsets(insPos.ind+1, len);
		} else {
			const left = insPos.s;
			const right = cutTailOf(left, insPos.sOfs);
			this.sections.splice(insPos.ind+1, 0, newSection, right);
			this.shiftSectonOffsets(insPos.ind+2, len);
		}
		this.checkAndCompactFourSections(Math.max(0, insPos.ind-1));
		return ofsInSrc;
	}

}
Object.freeze(RWFileLayout.prototype);
Object.freeze(RWFileLayout);


function cutHeadOf(s: ContentSection, sOfs: number): ContentSection {
	const head: ContentSection = {
		len: sOfs,
		ofs: s.ofs,
		ofsInSrc: ((typeof s.ofsInSrc === 'number') ? s.ofsInSrc : undefined)
	};
	s.len -= head.len;
	s.ofs += head.len;
	if (typeof s.ofsInSrc === 'number') {
		s.ofsInSrc += head.len;
	}
	return head;
}

function cutTailOf(s: ContentSection, sOfs: number): ContentSection {
	const tail: ContentSection = {
		len: s.len - sOfs,
		ofs: s.ofs + sOfs,
		ofsInSrc: ((typeof s.ofsInSrc === 'number') ?
			s.ofsInSrc + sOfs : undefined)
	};
	s.len = sOfs;
	return tail;
}

interface Cut {
	ofs: number;
	len: number;
}

interface OffsetPoint {
	s: ContentSection;
	ind: number;
	sOfs: number;
}

export interface FileLayoutException extends  web3n.RuntimeException {
	type: 'file-layout',
	msg: string;
}

export function fileLayoutException(
	msg: string, cause?: any
): FileLayoutException {
	return {
		runtimeException: true,
		type: 'file-layout',
		cause, msg
	};
}

async function readSectionsFrom(
	src: ByteSource, layoutOfs: number
): Promise<ContentSection[]> {
	const initPos = await src.getPosition();
	await src.seek(layoutOfs);
	const bytes = await src.read(undefined);
	await src.seek(initPos);
	if (!bytes) { throw fileLayoutException(
		`Reading at layout offset ${layoutOfs} produces no bytes (EOF?)`); }
	return parseSectionsFrom(bytes);
}

function parseSectionsFrom(bytes: Uint8Array): ContentSection[] {
	if (bytes.length < 8) { throw fileLayoutException(
		`Array len ${bytes.length} is too short for layout parsing`); }
	const expectedLen = uintFrom8Bytes(bytes, 0);
	if ((bytes.length-8) < expectedLen) { throw fileLayoutException(
		`Array len ${bytes.length-8} is shorter than expected layout ${expectedLen}`); }
	const sections: ContentSection[] = [];
	let i = 8;
	let ofs = 0;
	while (i < bytes.length) {
		const ofsInStr = uintOrUndefinedFrom8Bytes(bytes, i);
		i += 8;
		const len = uintFrom8Bytes(bytes, i);
		i += 8;
		sections.push({ ofsInSrc: ofsInStr, len, ofs });
		ofs += len;
	}
	return sections;
}

function packSections(sections: ContentSection[]): Uint8Array {
	const sectionsPackLen = 16*sections.length;
	const bytes = Buffer.allocUnsafe(8 + sectionsPackLen);
	packUintTo8Bytes(sectionsPackLen, bytes, 0);
	let i = 8;
	for (const s of sections) {
		packUintOrUndefinedInto8Bytes(s.ofsInSrc, bytes, i);
		i += 8;
		packUintTo8Bytes(s.len, bytes, i);
		i += 8;
	}
	return bytes;
}

const UNINIT_OFS_VALUE = Buffer.alloc(8, 0xff);

function uintOrUndefinedFrom8Bytes(
	bytes: Uint8Array, i: number
): number|undefined {
	for (let b=0; b<8; b+=1) {
		if (bytes[i+b] !== 0xff) {
			return uintFrom8Bytes(bytes, i);
		}
	}
	return;
}

function packUintOrUndefinedInto8Bytes(
	u: number|undefined, bytes: Buffer, i: number
): void {
	if (typeof u === 'number') {
		packUintTo8Bytes(u, bytes, i);
	} else {
		bytes.set(UNINIT_OFS_VALUE, i);
	}
}

function copySectionMovingOfs(
	sec: ContentSection, newOfs: number
): ContentSection {
	const ofsDelta = newOfs - sec.ofs;
	const copy: ContentSection = {
		ofs: newOfs,
		len: sec.len - ofsDelta,
	};
	if (typeof sec.ofsInSrc === 'number') {
		copy.ofsInSrc = sec.ofsInSrc + ofsDelta;
	}
	return copy;
}

function contentSectionsInSegs(
	segs: Layout['sections'], segsOfs: number,
	contentOfs: number, contentLen: number
): FileLayout['sections'] {
	const fstSegInd = segs.findIndex(
		s => (typeof s.len !== 'number') || (segsOfs < (s.ofs + s.len)));
	assert(fstSegInd >= 0);
	let i = fstSegInd;
	const ls: FileLayout['sections'] = [];
	while (contentLen > 0) {
		const seg = segs[i];
		const len = (typeof seg.len !== 'number') ?
			contentLen : Math.min(contentLen, seg.len);
		ls.push({ src: seg.src, ofs: contentOfs, len });
		contentOfs += len;
		contentLen -= len;
		i += 1;
	}
	return ls;
}

function compressLayoutSections(sections: FileLayout['sections']): void {
	if (sections.length === 0) { return; }
	let prev = sections[0]
	for (let i=1; i<sections.length; i+=1) {
		const s = sections[i];
		if (prev.src === s.src) {
			prev.len += s.len;
			sections.splice(i, 1);
			i -= 1;
		}
		prev = s;
	}
}


Object.freeze(exports);