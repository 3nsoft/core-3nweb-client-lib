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
 this program. If not, see <http://www.gnu.org/licenses/>.
*/

import { assert } from "../../lib-common/assert";
import { BytesFIFOBuffer } from "../../lib-common/byte-streaming/bytes-fifo-buffer";
import { ContentSection, ROFileLayout } from "./file-layout";
import { wrapAndSyncFileSource } from "../../lib-common/byte-streaming/wrapping";
import { AttrsHolder, FileAttrs } from "./file-attrs";
import { ByteSource } from "xsp-files";

type FileByteSource = web3n.files.FileByteSource;
type FileSection = web3n.files.FileSection;

export class FileBytes implements FileByteSource {

	private pos = 0;

	private constructor(
		private readonly rawSrc: ByteSource,
		private readonly layout: ROFileLayout
	) {
		Object.seal(this);
	}

	static async from(
		src: ByteSource, attrs: AttrsHolder<FileAttrs>|undefined
	): Promise<FileByteSource> {
		const layoutOfs = (attrs ? attrs.getFileLayoutOfs() : undefined);
		if (typeof layoutOfs !== 'number') {
			return fileSrcFromContinuousSrc(src);
		}
		const layout = await ROFileLayout.readFromSrc(src, layoutOfs);
		const fileBytes = new FileBytes(src, layout);
		return wrapAndSyncFileSource(fileBytes);
	}

	getFileSections(ofs: number, len: number): FileSection[] {
		if (!Number.isInteger(ofs) || (ofs < 0)) { throw new Error(
			`Given offset is not a non-negative integer: ${ofs}`); }
		if (!Number.isInteger(len) || (len < 0)) { throw new Error(
			`Given length is not a non-negative integer: ${len}`); }
		return this.layout.getSectionsIn(ofs, len)
		.map<FileSection>(s => ({
			ofs: s.ofs,
			len: s.len,
			hasContent: (typeof s.ofsInSrc === 'number')
		}));
	}

	async read(len: number|undefined): Promise<Uint8Array|undefined> {
		const sections = this.layout.getSectionsIn(this.pos, len);
		if (!sections || (sections.length === 0)) { return; }
		let bytes: Uint8Array;
		if (sections.length === 0) {
			bytes = await this.getSectionBytes(sections[0]);
		} else {
			const buf = new BytesFIFOBuffer();
			for (const s of sections) {
				buf.push(await this.getSectionBytes(s));
			}
			bytes = buf.getBytes(undefined)!;
		}
		this.pos += bytes.length;
		return bytes;
	}

	private async getSectionBytes(
		s: ContentSection
	): Promise<Uint8Array> {
		if (s.ofsInSrc === undefined) {
			// we use an implicit initializing bytes to zero in alloc
			return Buffer.alloc(s.len);
		} else {
			await this.rawSrc.seek(s.ofsInSrc);
			const bytes = await this.rawSrc.read(s.len);
			if (!bytes) { throw new Error(
				`Byte source produces no bytes where file content is expected`); }
			return bytes;
		}
	}

	async getSize(): Promise<number> {
		return this.layout.contentSize;
	}

	async seek(offset: number): Promise<void> {
		assert(
			Number.isInteger(offset) && (offset >= 0),
			`Offset must be a non-negative integer, but ${offset} is given instead`);
		this.pos = ((offset >= this.layout.contentSize) ?
			this.layout.contentSize : offset);
	}

	async getPosition(): Promise<number> {
		return this.pos;
	}

}
Object.freeze(FileBytes.prototype);
Object.freeze(FileBytes);


export function fileSrcFromContinuousSrc(src: ByteSource): FileByteSource {
	const w: FileByteSource = {
		getPosition: src.getPosition,
		getSize: async () => {
			const { size } = await src.getSize();
			return size;
		},
		read: src.read,
		seek: src.seek
	};
	return w;
}


Object.freeze(exports);