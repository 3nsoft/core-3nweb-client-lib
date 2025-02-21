/*
 Copyright (C) 2020, 2022 3NSoft Inc.
 
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

import { assert } from "../../lib-common/assert";
import { uintFrom8Bytes, packUintTo8Bytes, uintFrom4Bytes, packUintTo4Bytes } from "../../lib-common/big-endian";
import { ByteSink, ByteSource } from "xsp-files";
import { CommonAttrs, XAttrs } from "./attrs";
import { SingleProc } from "../../lib-common/processes/synced";
import { wrapAndSyncFileSource } from "../../lib-common/byte-streaming/wrapping";
import { Attrs, ReadonlyPayload, WritablePayload } from "./node-persistence";
import { byteLengthIn } from "../../lib-common/buffer-utils";

type FileByteSource = web3n.files.FileByteSource;
type FileByteSink = web3n.files.FileByteSink;
type FileLayoutSection = web3n.files.LayoutSection;

export async function makeReadonlyPayload(
	src: ByteSource
): Promise<ReadonlyPayload> {
	const payload = await ReadonlyPayloadV2.makeFor(src);
	return payload;
}

export async function makeWritablePayload(
	sink: ByteSink, attrs?: CommonAttrs
): Promise<WritablePayload> {
	return WritablePayloadV2.makeInitiallyEmpty(sink, attrs);
}

export async function makeWritablePayloadFromBase(
	sink: ByteSink, base: number, baseSrc: ByteSource
): Promise<WritablePayload> {
	const payload = await WritablePayloadV2.makeOnBase(sink, base!, baseSrc);
	return payload;
}

const EMPTY_SECTION = 'empty';
const CONTENT_SECTION = 'content';
const PAD_SECTION = 'pad';
const XATTRS_SECTION = 'xattrs';

interface EmptySection {
	type: typeof EMPTY_SECTION;
	ofs: number;
	len: number;
}

interface ContentSection {
	type: typeof CONTENT_SECTION;
	ofsInSrc: number;
	ofs: number;
	len: number;
}

interface XAttrsSection {
	type: typeof XATTRS_SECTION;
	ofsInSrc: number;
	len: number;
}

interface PadSection {
	type: typeof PAD_SECTION;
	ofsInSrc: number;
	len: number;
}

type SectionInPayload = ContentSection | XAttrsSection | PadSection;

class ReadonlyPayloadV2 implements ReadonlyPayload {

	private readonly syncProc = new SingleProc();
	private xattrs: XAttrs|undefined = undefined;
	private readonly size: number;

	private constructor(
		private readonly src: ByteSource,
		private readonly attrs: CommonAttrs,
		private readonly contentSections: (ContentSection|EmptySection)[],
		private readonly xattrsSections: XAttrsSection[],
	) {
		this.size = sizeOfContent(this.contentSections);
		Object.seal(this);
	}

	static async makeFor(src: ByteSource): Promise<ReadonlyPayloadV2> {
		const {
			attrs, sectionsEnd, contentSections, xattrsSections
		} = await payloadV2.readFrom(src);
		// sanity check during reconstruction of sections' layout in source
		combineIntoSectionsInSrc(contentSections, xattrsSections, sectionsEnd);
		return new ReadonlyPayloadV2(src, attrs, contentSections, xattrsSections);
	}

	getAttrs(): Attrs {
		const { ctime, mtime } = this.attrs;
		return { ctime, mtime, size: this.size };
	}

	async getXAttrs(): Promise<XAttrs> {
		if (!this.xattrs) {
			if (this.xattrsSections.length === 0) {
				this.xattrs = XAttrs.makeEmpty();
			} else {
				const xattrsBytes = await this.syncProc.startOrChain(async () => {
					const chunks: Uint8Array[] = [];
					for (const { ofsInSrc, len } of this.xattrsSections) {
						const bytes = await sureReadOfBytesFrom(
							this.src, ofsInSrc, len);
						chunks.push(bytes);
					}		
					return chunks;
				});
				this.xattrs = XAttrs.parseFrom(xattrsBytes);
			}
		}
		return this.xattrs;
	}

	readAllContent(): Promise<Uint8Array|undefined> {
		return this.readSomeContentBytes(0, this.size);
	}

	async readSomeContentBytes(
		start: number, end: number
	): Promise<Uint8Array|undefined> {
		assert(Number.isInteger(start) && (start >= 0));
		if (start > this.size) {
			start = this.size;
		}
		assert(Number.isInteger(end) && (end >= start));
		if (end > this.size) {
			end = this.size;
		}
		if (start === end) {
			return undefined;
		}
		const startSecInd = this.contentSections
		.findIndex(s => (s.ofs <= start));
		const endSecInd = this.contentSections
		.findIndex(s => ((s.ofs + s.len) >= end));
		assert((startSecInd >= 0) && (endSecInd >= 0) &&
			(startSecInd <= endSecInd));
		return await this.syncProc.startOrChain((startSecInd === endSecInd) ?
		async () => {
			const s = this.contentSections[startSecInd];
			if (s.type === CONTENT_SECTION) {
				const fstDelta = start - s.ofs;
				return await sureReadOfBytesFrom(this.src,
					s.ofsInSrc + fstDelta, end - start);
			} else if (s.type === EMPTY_SECTION) {
				return new Uint8Array(end - start);
			} else {
				throw new Error(`This shouldn't reachable`);
			}
		} :
		async () => {
			const allBytes = Buffer.allocUnsafe(end - start);
			let ofsInAllBytes = 0;
			for (let i=startSecInd; i<=endSecInd; i+=1) {
				const s = this.contentSections[i];
				const fstDelta = ((i === startSecInd) ? start - s.ofs : 0);
				const len = ((i === endSecInd) ? end - s.ofs : s.len);
				if (s.type === CONTENT_SECTION) {
					const bytes = await sureReadOfBytesFrom(
						this.src, s.ofsInSrc + fstDelta, len);
					allBytes.set(bytes, ofsInAllBytes);
				} else if (s.type === EMPTY_SECTION) {
					allBytes.fill(0, ofsInAllBytes, len);
				} else {
					throw new Error(`This shouldn't reachable`);
				}
				ofsInAllBytes += len;
			}
			return allBytes;
		});
	}

	makeFileByteSource(): FileByteSource {
		let pos = 0;
		const seek: FileByteSource['seek'] = async ofs => {
			assert(Number.isInteger(ofs) && (ofs >= 0) && (ofs <= this.size),
				`Offset must be an integer from 0 to size value, inclusive`);
			pos = ofs;
		};
		const readNext: FileByteSource['readNext'] = async len => {
			if (len === undefined) {
				len = this.size - pos;
			}
			const bytes = await this.readSomeContentBytes(pos, pos+len);
			if (bytes) {
				pos += bytes.length;
			}
			return bytes;
		};
		return wrapAndSyncFileSource({
			seek,
			getSize: async () => this.size,
			getPosition: async () => pos,
			readNext,
			readAt: async (pos, len) => {
				await seek(pos);
				return await readNext(len);
			}
		});
	}

}
Object.freeze(ReadonlyPayloadV2.prototype);
Object.freeze(ReadonlyPayloadV2);


function combineIntoSectionsInSrc(
	contentSections: (ContentSection|EmptySection)[],
	xattrsSections: XAttrsSection[], sectionsEnd: number
): SectionInPayload[] {
	// combine and sort sections with bytes in payload
	const withContent = (contentSections as ContentSection[])
	.filter(s => (s.type === CONTENT_SECTION));
	const sectionsInSrc: SectionInPayload[] = (
		xattrsSections as SectionInPayload[]).concat(withContent);
	sectionsInSrc.sort(compareByOfsInSrc);

	// add pad before sections, if boundaries check tells so
	if (sectionsInSrc.length > 0) {
		const fst = sectionsInSrc[0];
		if (fst.ofsInSrc !== 0) {
			sectionsInSrc.unshift({
				type: PAD_SECTION,
				ofsInSrc: 0,
				len: fst.ofsInSrc
			});
		}
	}
	// add pads between sections, if boundaries check tells so
	for (let i=1; i<sectionsInSrc.length; i+=1) {
		const prev = sectionsInSrc[i-1];
		const prevEnd = prev.ofsInSrc + prev.len;
		const s = sectionsInSrc[i];
		if (prevEnd !== s.ofsInSrc) {
			if (prevEnd < s.ofsInSrc) {
				sectionsInSrc.splice(i, 0, {
					type: PAD_SECTION,
					ofsInSrc: prevEnd,
					len: s.ofsInSrc - prevEnd
				});
				i += 1;
			} else {
				throw payloadLayoutException(`One section overflows another`);
			}
		}
	}
	// add pad after sections, if boundaries check tells so
	const last = lastIn(sectionsInSrc);
	const lastEnd = (last ? (last.ofsInSrc + last.len) : 0);
	if (lastEnd !== sectionsEnd) {
		if (lastEnd < sectionsEnd) {
			sectionsInSrc.push({
				type: PAD_SECTION,
				ofsInSrc: lastEnd,
				len: sectionsEnd - lastEnd
			});
		} else if (lastEnd > sectionsEnd) {
			throw payloadLayoutException(
				`Last section length overflows sections' end`);
		}
	}

	return sectionsInSrc;
}

function compareByOfsInSrc(a: SectionInPayload, b: SectionInPayload): number {
	if (a.ofsInSrc < b.ofsInSrc) {
		return -1;
	} else if (a.ofsInSrc > b.ofsInSrc) {
		return 1;
	} else {
		throw payloadLayoutException(`Have invalid pair in comparing ofsInSrc`);
	}
}

function sizeOfContent(sections: (ContentSection|EmptySection)[]): number {
	const last = lastIn(sections);
	return (last ? (last.ofs + last.len) : 0);
}

function lastIn<T>(arr: T[]): T|undefined {
	return ((arr.length === 0) ? undefined : arr[arr.length-1]);
}


/**
 * This implementation has the following behaviour of packing payload bytes.
 * Any bytes from base can only be cut. New content sections are appended.
 * If content section is added and than deleted, section is marked as a pad.
 * Extended attributes are written in one section, and any change in them
 * removes this section competely, and writes a new one (if there are xattrs).
 */
class WritablePayloadV2 implements WritablePayload {

	private cutonlyAreaEnd: number;
	private writePos: number;
	private readonly sectionsInSink: SectionInPayload[];
	private readonly syncProc = new SingleProc();
	private completionErr: any = undefined;

	constructor(
		private sink: ByteSink|undefined,
		private readonly base: number|undefined,
		private readonly attrs: CommonAttrs,
		private readonly contentSections: (ContentSection|EmptySection)[],
		private readonly xattrsSections: XAttrsSection[],
		sectionsEnd: number,
	) {
		assert(!!this.sink);
		if ((this.contentSections.length + this.xattrsSections.length) === 0) {
			this.sectionsInSink = [];
			this.cutonlyAreaEnd = 0;
			this.writePos = 0;
		} else {
			// sanity check during reconstruction of sections' layout in source
			this.sectionsInSink = combineIntoSectionsInSrc(
				this.contentSections, this.xattrsSections, sectionsEnd);
			this.cutonlyAreaEnd = sectionsEnd;
			this.writePos = sectionsEnd;
		}
		Object.seal(this);
	}

	static makeInitiallyEmpty(
		sink: ByteSink, attrs: CommonAttrs|undefined
	): WritablePayloadV2 {
		if (!attrs) {
			attrs = CommonAttrs.makeForTimeNow();
		}
		return new WritablePayloadV2(sink, undefined, attrs, [], [], 0);
	}

	static async makeOnBase(
		sink: ByteSink, base: number, baseSrc: ByteSource
	): Promise<WritablePayloadV2> {
		const {
			attrs, contentSections, xattrsSections, sectionsEnd
		} = await payloadV2.readFrom(baseSrc);
		const payload = new WritablePayloadV2(
			sink, base, attrs, contentSections, xattrsSections, sectionsEnd);
		await payload.removeLayoutBytes();
		await payload.deletePadsInCutArea();
		return payload;
	}

	private async removeLayoutBytes(): Promise<void> {
		if (!this.sink) { this.throwOnNoSink(); }
		await this.sink.setSize(this.writePos);
	}

	private async completeWriting(err?: any): Promise<void> {
		if (!this.sink) { return; }
		if (err !== undefined) {
			this.completionErr = err;
			await this.sink.done(err).catch(noop);
			return;
		}
		if (!Object.isFrozen(this.attrs)) {
			this.attrs.updateMTime();
		}
		try {
			const { bytes, packLen } = payloadV2.pack(
				this.attrs, this.xattrsSections, this.contentSections);
			await this.sink.spliceLayout(this.writePos, 0, packLen);
			for (const buf of bytes) {
				await this.sink.write(this.writePos, buf);
				this.writePos += buf.length;
			}
			await this.sink.done();
		} catch (err) {
			await this.sink.done(err);
			throw err;
		} finally {
			this.sink = undefined;
		}
	}

	private get contentLen(): number {
		return sizeOfContent(this.contentSections);
	}

	private throwOnNoSink(): never {
		throw (this.completionErr ?
			this.completionErr : Error(`Payload has already completed`));
	}

	private async spliceContent(
		contentOfs: number, del: number, ins?: Uint8Array
	): Promise<void> {
		assert(Number.isInteger(contentOfs) && (contentOfs >= 0),
			`Content offset should be a non-negative integer`);
		assert(Number.isInteger(del) && (del >= 0),
			`Number of bytes to delete should be a non-negative integer`);
		if (!this.sink) { this.throwOnNoSink(); }
		try {

			if (contentOfs >= this.contentLen) {
				if (!ins) { return; }
				// ignore del, as there is no content at this high offset
				this.appendContentSectionInfo({
					type: 'content',
					len: ins.length,
					ofs: contentOfs,
					ofsInSrc: this.writePos,
				});
			} else {
				if (del > 0) {
					await this.deleteContentSection(contentOfs, del, !ins);
				}
				if (!ins) { return; }
				if (contentOfs === this.contentLen) {
					this.appendContentSectionInfo({
						type: 'content',
						len: ins.length,
						ofs: contentOfs,
						ofsInSrc: this.writePos,
					});
				} else {
					this.insertContentSection({
						type: 'content',
						len: ins.length,
						ofs: contentOfs,
						ofsInSrc: this.writePos,
					});
				}
			}
			await this.sink.spliceLayout(this.writePos, 0, ins.length);
			await this.sink.write(this.writePos, ins);
			this.writePos += ins.length;
		} catch (err) {
			await this.completeWriting(err).catch(noop);
			throw err;
		}
	}

	/**
	 * This appends given section to contentSections and sectionsInSink, ensuring
	 * there is no gaps. In case section can be merged with the last one, merge
	 * is performed instead of appending.
	 * @param s 
	 */
	private appendContentSectionInfo(s: ContentSection): void {
		const last = lastIn(this.contentSections);
		if (last) {
			const origContentEnd = last.ofs + last.len;
			if (origContentEnd < s.ofs) {
				if (last.type === 'empty') {
					last.len += s.ofs - origContentEnd;
				} else {
					this.contentSections.push({
						type: 'empty',
						ofs: origContentEnd,
						len: s.ofs - origContentEnd
					});
				}
			} else if ((last.type === 'content')
			&& ((last.ofsInSrc + last.len) === s.ofsInSrc)) {
				last.len += s.len;
				return;
			}
		} else if (s.ofs > 0) {
			this.contentSections.push({
				type: 'empty',
				ofs: 0,
				len: s.ofs
			});
		}
		this.contentSections.push(s);
		const lastInSink = lastIn(this.sectionsInSink);
		if (lastInSink) {
			assert((lastInSink.ofsInSrc + lastInSink.len) === s.ofsInSrc);
		} else {
			assert(s.ofsInSrc === 0);
		}
		this.sectionsInSink.push(s);
	}

	private appendEmptySection(len: number): void {
		const last = lastIn(this.contentSections);
		if (!last) {
			this.contentSections.push({ type: 'empty', ofs: 0, len });
		} else if (last.type === 'content') {
			const ofs = last.ofs + last.len;
			this.contentSections.push({ type: 'empty', ofs, len });
		} else {
			assert(last.type === 'empty');
			last.len += len;
		}
	}

	private insertContentSection(s: ContentSection): void {
		// make cut point with sections before and after
		let before: ContentSection|EmptySection|undefined = undefined;
		let after: ContentSection|EmptySection|undefined = undefined;
		let indToSplice: number = (undefined as any);
		for (let i=0; i<this.contentSections.length; i+=1) {
			const c = this.contentSections[i];
			if ((c.ofs + c.len) <= s.ofs) {
				continue;
			} else if (c.ofs === s.ofs) {
				indToSplice = i;
				if (i > 0) {
					before = this.contentSections[indToSplice-1];
				}
				break;
			} else {
				const lenBefore = s.ofs - c.ofs;
				if (c.type === 'empty') {
					after = {
						type: 'empty',
						len: c.len - lenBefore,
						ofs: s.ofs
					} as EmptySection;
					c.len = lenBefore;
				} else {
					assert(c.type === 'content');
					after = {
						type: 'content',
						len: c.len - lenBefore,
						ofs: s.ofs,
						ofsInSrc: c.ofsInSrc + lenBefore
					} as ContentSection;
					c.len = lenBefore;
					const beforeIndInSink = this.sectionsInSink.indexOf(c);
					assert(beforeIndInSink >= 0);
					this.sectionsInSink.splice(beforeIndInSink+1, 0, after);
				}
				before = c;
				indToSplice = i+1;
				this.contentSections.splice(indToSplice, 0, after);
				break;
			}
		}
		assert(indToSplice !== undefined, `When there is no section after given one, it should've been appended with other method`);

		// either merge s with before, or splice it in
		if (before && (before.type === s.type)
		&& ((before.ofs + before.len) === s.ofs)
		&& ((before.ofsInSrc + before.len) === s.ofsInSrc)) {
			before.len += s.len;
		} else {
			this.contentSections.splice(indToSplice, 0, s);
			const lastInSink = lastIn(this.sectionsInSink);
			if (lastInSink) {
				assert((lastInSink.ofsInSrc + lastInSink.len) === s.ofsInSrc);
			} else {
				assert(s.ofsInSrc === 0);
			}
			this.sectionsInSink.push(s);
		}
	}

	private async deleteContentSection(
		contentOfs: number, del: number, attemptJoinAtCut: boolean
	): Promise<void> {
		if (!this.sink) { this.throwOnNoSink(); }

		// make splits around section(s) to delete
		this.splitContentSectionsAt(contentOfs);
		const fstInd = this.contentSections
		.findIndex(s => (s.ofs === contentOfs));
		assert(fstInd >= 0);
		this.splitContentSectionsAt(contentOfs + del);
		let lastInd = this.contentSections
		.findIndex(s => (s.ofs === (contentOfs + del)));
		if (lastInd < 0) {
			lastInd = this.contentSections.length - 1;
		} else {
			lastInd -= 1;
		}

		// cut bytes removing info
		for (let i=lastInd; i>=fstInd; i-=1) {
			const s = this.contentSections[i];
			// remove s from contents info array
			this.contentSections.splice(i, 1);
			for (let k=i; k<this.contentSections.length; k+=1) {
				const c = this.contentSections[k];
				c.ofs -= s.len;
			}
			// remove bytes or turn s to pad
			if (s.type === 'content') {
				if (s.ofsInSrc >= this.cutonlyAreaEnd) {
					(s as SectionInPayload as PadSection).type = 'pad';
					delete (s as Partial<typeof s>).ofs;
				} else {
					await this.sink.spliceLayout(s.ofsInSrc, s.len, 0);
					this.removeSectionInSink(s);
				}
			} else {
				assert(s.type === 'empty');
			}
		}

		if (attemptJoinAtCut && (fstInd > 0)
		&& (fstInd < this.contentSections.length)) {
			const before = this.contentSections[fstInd-1];
			const after = this.contentSections[fstInd];
			if ((before.type === 'content') && (after.type === 'content')) {
				if ((before.ofsInSrc + before.len) === after.ofsInSrc) {
					const indInSink = this.sectionsInSink.indexOf(after);
					assert(this.sectionsInSink[indInSink-1] === before);
					before.len += after.len;
					this.contentSections.splice(fstInd, 1);
					this.sectionsInSink.splice(indInSink, 1);
				}
			} else if ((before.type === 'empty') && (after.type === 'empty')) {
				before.len += after.len;
				this.contentSections.splice(fstInd, 1);
			}
		}
	}

	/**
	 * This ensures that there is a split between section at a given offset.
	 * @param cutOfs 
	 */
	private splitContentSectionsAt(cutOfs: number): void {
		const ind = this.contentSections.findIndex(s => (
			((s.ofs + s.len) > cutOfs) && (s.ofs <= cutOfs)));
		if (ind < 0) { return; }
		const s = this.contentSections[ind];
		if (s.ofs === cutOfs) { return; }
		const tailLen = s.len - (cutOfs - s.ofs);
		s.len -= tailLen;
		if (s.type === 'content') {
			const tail: ContentSection = {
				type: 'content',
				ofs: cutOfs,
				len: tailLen,
				ofsInSrc: s.ofsInSrc + s.len 
			};
			this.contentSections.splice(ind+1, 0, tail);
			const indInSink = this.sectionsInSink.indexOf(s);
			assert(indInSink >= 0);
			this.sectionsInSink.splice(indInSink+1, 0, tail);
		} else {
			assert(s.type === 'empty');
			const tail: EmptySection = {
				type: 'empty',
				ofs: cutOfs,
				len: tailLen
			};
			this.contentSections.splice(ind+1, 0, tail);
		}
	}

	/**
	 * Removes pad bytes in cuttable area. This call is synced.
	 */
	private async deletePadsInCutArea(): Promise<void> {
		if (!this.sink) { this.throwOnNoSink(); }
		// locate sections in cut area
		if (this.sectionsInSink.length === 0) { return; }
		let fstNoCutSectionInd = this.sectionsInSink
		.findIndex(s => (s.ofsInSrc >= this.cutonlyAreaEnd));
		if (fstNoCutSectionInd < 0) {
			fstNoCutSectionInd = this.sectionsInSink.length;
		}
		// delete pads in cut areas
		for (let i=(fstNoCutSectionInd-1); i>=0; i-=1) {
			const p = this.sectionsInSink[i];
			if (p.type !== 'pad') { continue; }
			await this.sink.spliceLayout(p.ofsInSrc, p.len, 0);
			this.removeSectionInSink(p);
		}
	}

	/**
	 * Removes given section from sectionsInSink array, adjusting related offset
	 * values.
	 * @param p this section must be from sectionsInSink, and completely in the
	 * area, where cut is allowed.
	 */
	private removeSectionInSink(p: SectionInPayload): void {
		assert(p.ofsInSrc < this.cutonlyAreaEnd);
		const i = this.sectionsInSink.indexOf(p);
		assert(i >= 0);
		this.sectionsInSink.splice(i, 1);
		for (let k=i; k<this.sectionsInSink.length; k+=1) {
			const s = this.sectionsInSink[k];
			s.ofsInSrc -= p.len;
		}
		this.cutonlyAreaEnd -= p.len;
		this.writePos -= p.len;
	}

	private async replaceXAttrs(xattrs: XAttrs): Promise<void> {
		if (!this.sink) { this.throwOnNoSink(); }
		if (this.xattrsSections.length > 0) {
			for (const s of this.xattrsSections) {
				if (s.ofsInSrc < this.cutonlyAreaEnd) {
					await this.sink.spliceLayout(s.ofsInSrc, s.len, 0);
					this.removeSectionInSink(s);
				} else {
					(s as SectionInPayload).type = 'pad';
				}
			}
			this.xattrsSections.splice(0, this.xattrsSections.length);
		}
		if (xattrs.isEmpty) { return; }
		const packedXAttrs = xattrs.pack()!;
		const len = byteLengthIn(packedXAttrs);
		if (len > 0) {
			await this.sink.spliceLayout(this.writePos, 0, len);
			const s: XAttrsSection = {
				type: 'xattrs',
				len,
				ofsInSrc: this.writePos,
			};
			for (const bytes of packedXAttrs) {
				await this.sink.write(this.writePos, bytes);
				this.writePos += bytes.length;
			}
			this.xattrsSections.push(s);
			this.sectionsInSink.push(s);
		}
	}

	async setXAttrs(xattrs: XAttrs): Promise<void> {
		await this.syncProc.startOrChain(async () => {
			try {
				await this.replaceXAttrs(xattrs);
				await this.completeWriting();
			} catch (err) {
				await this.completeWriting(err);
				throw err;
			}
		});
	}

	async writeAllContent(bytes: Uint8Array[], xattrs?: XAttrs): Promise<void> {
		await this.syncProc.startOrChain(async () => {
			if (!this.sink) { this.throwOnNoSink(); }
			try {
				if (this.contentSections.length > 0) {
					for (const s of this.contentSections) {
						if (s.type === 'empty') { continue; } 
						if (s.ofsInSrc < this.cutonlyAreaEnd) {
							await this.sink.spliceLayout(s.ofsInSrc, s.len, 0);
							this.removeSectionInSink(s);
						} else {
							(s as SectionInPayload).type = 'pad';
							delete (s as Partial<typeof s>).ofs;
						}
					}
					this.contentSections.splice(0, this.contentSections.length);
				}
				if (xattrs) {
					await this.replaceXAttrs(xattrs);
				}
				const len = byteLengthIn(bytes);
				if (len > 0) {
					await this.sink.spliceLayout(this.writePos, 0, len);
					const s: ContentSection = {
						type: 'content',
						len,
						ofs: 0,
						ofsInSrc: this.writePos,
					};
					for (const chunk of bytes) {
						await this.sink.write(this.writePos, chunk);
						this.writePos += chunk.length;
					}
					this.contentSections.push(s);
					this.sectionsInSink.push(s);
				}
				await this.completeWriting();
			} catch (err) {
				await this.completeWriting(err).catch(noop);
				throw err;
			}
		});
	}

	async makeFileByteSink(xattrs?: XAttrs): Promise<FileByteSink> {
		if (xattrs) {
			await this.syncProc.startOrChain(() => this.replaceXAttrs(xattrs));
		}
		return {
			done: err => this.syncProc.startOrChain(() =>
				this.completeWriting(err)),

			getSize: () => this.syncProc.startOrChain(async () => {
				return this.contentLen;
			}),

			showLayout: () => this.syncProc.startOrChain(async () => {
				return {
					base: this.base,
					sections: this.contentSections.map(s => {
						const { ofs, len } = s;
						let src: FileLayoutSection['src'];
						if (s.type === 'content') {
							src = ((s.ofsInSrc < this.cutonlyAreaEnd) ?
								'base' : 'new');
						} else {
							src = s.type;
						}
						return { src, ofs, len };
					})
				};
			}),

			splice: (pos, del, bytes) => this.syncProc.startOrChain(() =>
				this.spliceContent(pos, del, bytes)),

			truncate: size => this.syncProc.startOrChain(async () => {
				assert(Number.isInteger(size) && (size >= 0),
					`Size should be a non-negative integer`);
				const currentSize = this.contentLen;
				if (size > currentSize) {
					this.appendEmptySection(size - currentSize);
				} else if (size < currentSize) {
					await this.spliceContent(size, currentSize - size);
				}
			})
		};
	}

}
Object.freeze(WritablePayloadV2.prototype);
Object.freeze(WritablePayloadV2);


interface PayloadLayoutException extends  web3n.RuntimeException {
	type: 'payload-layout',
}

function payloadLayoutException(
	msg: string, cause?: any
): PayloadLayoutException {
	return {
		runtimeException: true,
		type: 'payload-layout',
		message: msg,
		cause,
	};
}

async function sureReadOfBytesFrom(
	src: ByteSource, ofs: number, len: number
): Promise<Uint8Array> {
	const bytes = await src.readAt(ofs, len);
	assert(!!bytes && (bytes.length === len));
	return bytes!;
}

function noop() {}


// XXX we may add smaller bytes for packing section info: there is enough values

/**
 * Payload version 2 contains in this order:
 *  - content/xattr/pad bytes,
 *  - layout bytes,
 *  - 4 bytes with layout bytes length.
 * Layout bytes contain in this order:
 *  - common attrs,
 *  - m xattrs sections,
 *  - n content or empty sections.
 * Section is described with 9, 13, or 17 bytes.
 *  - 1 type byte,
 *  - 4 or 8 bytes with offset byte source,
 *  - 4 or 8 bytes with section's length.
 * Values are:
 *  0x01 - empty content section - 4 bytes for length
 *  0x02 - empty content section - 8 bytes for length
 *  0x11 - content section - 4 bytes for offset in source - 4 bytes for length
 *  0x12 - content section - 8 bytes for offset in source - 4 bytes for length
 *  0x13 - content section - 4 bytes for offset in source - 8 bytes for length
 *  0x14 - content section - 8 bytes for offset in source - 8 bytes for length
 *  0x21 - xattrs section - 4 bytes for offset in source - 4 bytes for length
 *  0x22 - xattrs section - 8 bytes for offset in source - 4 bytes for length
 */
namespace payloadV2 {

	const MIN_PAYLOAD_V2_LEN = CommonAttrs.PACK_LEN + 4;

	export async function readFrom(src: ByteSource): Promise<{
		attrs: CommonAttrs; sectionsEnd: number;
		contentSections: (ContentSection|EmptySection)[];
		xattrsSections: XAttrsSection[];
	}> {

		const { size: srcLen, isEndless } = await src.getSize();
		if (isEndless) {
			throw payloadLayoutException(
				`Payload v2 can't be present in endless byte source.`
			);
		}
		if (srcLen < MIN_PAYLOAD_V2_LEN) {
			throw payloadLayoutException(
				`Byte source is too short for smallest payload v2`
			);
		}

		// - read layout length from last 4 bytes
		const layoutLen = uintFrom4Bytes(
			await sureReadOfBytesFrom(src, srcLen - 4, 4)
		);

		const sectionsEnd = srcLen - (layoutLen + 4);
		if (sectionsEnd < 0) {
			throw payloadLayoutException(
				`Layout length value in payload v2 is out of bound`
			);
		}

		// - read layout bytes
		const layoutBytes = await sureReadOfBytesFrom(
			src, sectionsEnd, layoutLen
		);
		let ofs = 0;

		// - parse common attrs
		const attrs = CommonAttrs.parse(layoutBytes);
		ofs += CommonAttrs.PACK_LEN;

		// - parse sections
		const {
			contentSections, xattrsSections
		} = parseSections(layoutBytes, ofs);

		return { attrs, sectionsEnd, contentSections, xattrsSections };
	}

	function parseSections(bytes: Uint8Array, i: number): {
		contentSections: (ContentSection|EmptySection)[];
		xattrsSections: XAttrsSection[];
	} {
		const contentSections: (ContentSection|EmptySection)[] = [];
		const xattrsSections: XAttrsSection[] = [];
		let ofs = 0;	// calculating offset in content
		while (i < bytes.length) {
			const sectionType = bytes[i];
			let ofsInSrc: number;
			let len: number;
			switch (sectionType) {
				case 0x01:
					checkLen(bytes, i, 5);
					len = nonZeroLengthFrom4Bytes(bytes, i+1);
					contentSections.push({ type: EMPTY_SECTION, len, ofs });
					i += 5;
					break;
				case 0x02:
					checkLen(bytes, i, 9);
					len = nonZeroLengthFrom8Bytes(bytes, i+1);
					contentSections.push({ type: EMPTY_SECTION, len, ofs });
					i += 9;
					break;
				case 0x11:
					checkLen(bytes, i, 9);
					ofsInSrc = uintFrom4Bytes(bytes, i+1);
					len = nonZeroLengthFrom4Bytes(bytes, i+5);
					contentSections.push({ type: CONTENT_SECTION, len,ofs,ofsInSrc});
					i += 9;
					break;
				case 0x12:
					checkLen(bytes, i, 13);
					ofsInSrc = uintFrom8Bytes(bytes, i+1);
					len = nonZeroLengthFrom4Bytes(bytes, i+9);
					contentSections.push({ type: CONTENT_SECTION, len,ofs,ofsInSrc});
					i += 13;
					break;
				case 0x13:
					checkLen(bytes, i, 13);
					ofsInSrc = uintFrom4Bytes(bytes, i+1);
					len = nonZeroLengthFrom8Bytes(bytes, i+5);
					contentSections.push({ type: CONTENT_SECTION, len,ofs,ofsInSrc});
					i += 13;
					break;
				case 0x14:
					checkLen(bytes, i, 17);
					ofsInSrc = uintFrom8Bytes(bytes, i+1);
					len = nonZeroLengthFrom8Bytes(bytes, i+9);
					contentSections.push({ type: CONTENT_SECTION, len,ofs,ofsInSrc});
					i += 17;
					break;

				case 0x21:
					checkLen(bytes, i, 9);
					ofsInSrc = uintFrom4Bytes(bytes, i+1);
					len = nonZeroLengthFrom4Bytes(bytes, i+5);
					xattrsSections.push({ type: XATTRS_SECTION, ofsInSrc, len });
					i += 9;
					continue;	// xattrs section doesn't advance ofs below
				case 0x22:
					checkLen(bytes, i, 13);
					ofsInSrc = uintFrom8Bytes(bytes, i+1);
					len = nonZeroLengthFrom4Bytes(bytes, i+9);
					xattrsSections.push({ type: XATTRS_SECTION, ofsInSrc, len });
					i += 13;
					continue;	// xattrs section doesn't advance ofs below
				
				default:
					throw payloadLayoutException(
						`Unknown section type ${sectionType} in payload version 2`);
			}
			ofs += len;
		}
		return { contentSections, xattrsSections };
	}

	function checkLen(bytes: Uint8Array, ofs: number, minLen: number): void {
		if ((ofs + minLen) > bytes.length) {
			throw payloadLayoutException(
				`Unexpected short byte section in payload version 2`);
		}
	}

	function nonZeroLengthFrom4Bytes(bytes: Uint8Array, i: number): number {
		const len = uintFrom4Bytes(bytes, i);
		if (len === 0) {
			throw payloadLayoutException(
				`Section with zero length in payload version 2`);
		}
		return len;
	}

	function nonZeroLengthFrom8Bytes(bytes: Uint8Array, i: number): number {
		const len = uintFrom8Bytes(bytes, i);
		if (len === 0) {
			throw payloadLayoutException(
				`Section with zero length in payload version 2`);
		}
		return len;
	}

	export function pack(
		attrs: CommonAttrs, xattrs: XAttrsSection[],
		content: (ContentSection|EmptySection)[]
	): { bytes: Buffer[]; packLen: number; } {
		const bytes: Buffer[] = [];
		bytes.push(attrs.pack());
		for (const section of xattrs) {
			bytes.push(packXAttrsSection(section));
		}
		for (const section of content) {
			if (section.type === 'empty') {
				bytes.push(packEmptySection(section));
			} else {
				bytes.push(packContentSection(section));
			}
		}
		const layoutLen = byteLengthIn(bytes);
		const lastBytes = Buffer.allocUnsafe(4);
		packUintTo4Bytes(layoutLen, lastBytes, 0);
		bytes.push(lastBytes);
		const packLen = layoutLen + 4;
		return { bytes, packLen };
	}

	function packEmptySection(section: EmptySection): Buffer {
		if (section.len < 0x100000000) {
			const bytes = Buffer.allocUnsafe(5);
			bytes[0] = 0x01;
			packUintTo4Bytes(section.len, bytes, 1);
			return bytes;
		} else {
			const bytes = Buffer.allocUnsafe(9);
			bytes[0] = 0x02;
			packUintTo8Bytes(section.len, bytes, 1);
			return bytes;
		}
	}

	function packContentSection(section: ContentSection): Buffer {
		if (section.ofsInSrc < 0x100000000) {
			if (section.len < 0x100000000) {
				const bytes = Buffer.allocUnsafe(9);
				bytes[0] = 0x11;
				packUintTo4Bytes(section.ofsInSrc, bytes, 1);
				packUintTo4Bytes(section.len, bytes, 5);
				return bytes;
			} else {
				const bytes = Buffer.allocUnsafe(13);
				bytes[0] = 0x13;
				packUintTo4Bytes(section.ofsInSrc, bytes, 1);
				packUintTo8Bytes(section.len, bytes, 5);
				return bytes;
			}
		} else {
			if (section.len < 0x100000000) {
				const bytes = Buffer.allocUnsafe(13);
				bytes[0] = 0x12;
				packUintTo8Bytes(section.ofsInSrc, bytes, 1);
				packUintTo4Bytes(section.len, bytes, 9);
				return bytes;
			} else {
				const bytes = Buffer.allocUnsafe(17);
				bytes[0] = 0x14;
				packUintTo8Bytes(section.ofsInSrc, bytes, 1);
				packUintTo8Bytes(section.len, bytes, 8);
				return bytes;
			}
		}
	}

	function packXAttrsSection(section: XAttrsSection): Buffer {
		if (section.ofsInSrc < 0x100000000) {
			const bytes = Buffer.allocUnsafe(9);
			bytes[0] = 0x21;
			packUintTo4Bytes(section.ofsInSrc, bytes, 1);
			packUintTo4Bytes(section.len, bytes, 5);
			return bytes;
		} else {
			const bytes = Buffer.allocUnsafe(13);
			bytes[0] = 0x22;
			packUintTo8Bytes(section.ofsInSrc, bytes, 1);
			packUintTo4Bytes(section.len, bytes, 9);
			return bytes;
		}
	}

}
Object.freeze(payloadV2);


Object.freeze(exports);