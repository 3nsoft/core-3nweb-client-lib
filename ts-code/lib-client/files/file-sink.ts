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

import { FileAttrs, AttrsHolder } from "./file-attrs";
import { RWFileLayout } from "./file-layout";
import { wrapAndSyncFileSink } from "../../lib-common/byte-streaming/wrapping";
import { assert } from "../../lib-common/assert";
import { ByteSinkWithAttrs } from "xsp-files";
import { errWithCause } from "../../lib-common/exceptions/error";

type FileByteSink = web3n.files.FileByteSink;
type FileLayout = web3n.files.FileLayout;

/**
 * This implementation of a sink will put new bytes at the end of the raw sink.
 * Mapping from out-of-order writes to linear recording is captured in file
 * layout that is recorded after all bytes are written and placed at after all
 * bytes. Layout offset is written into attributes. If file layout is trivial,
 * i.e. all positions in raw sink correspond to file positions, it isn't written
 * and attributes have no layout offset.
 */
export class FileSink implements FileByteSink {

	private err: any = undefined;
	private isDone = false;

	private constructor(
		private readonly rawSink: ByteSinkWithAttrs,
		private readonly layout: RWFileLayout,
		private readonly attrs: AttrsHolder<FileAttrs>
	) {
		Object.seal(this);
	}

	static async from(
		sink: ByteSinkWithAttrs, attrs: AttrsHolder<FileAttrs>,
		layout: RWFileLayout
	): Promise<FileByteSink> {
		await sink.setAttrSectionSize(attrs.serializedLen);
		await sink.setSize(layout.getLayoutOfsInSink());
		const fileSink = new FileSink(sink, layout, attrs);
		return wrapAndSyncFileSink(fileSink);
	}

	async getSize(): Promise<number> {
		return this.layout.contentSize;
	}

	private throwUpIfDone(): void {
		if (this.isDone) {
			if (this.err) {
				throw errWithCause(this.err, `File sink has already erred`);
			} else {
				throw new Error(`File sink is already done`);
			}
		}
	}

	private async errThis(err: any): Promise<void> {
		if (this.err) { return; }
		this.err = err;
		await this.rawSink.done(this.err);
		this.isDone = true;
	}

	async showLayout(): Promise<FileLayout> {
		const segs = await this.rawSink.showLayout();
		return this.layout.toFileLayoutBasedOnSegs(segs);
	}

	async truncate(size: number): Promise<void> {
		assert(Number.isInteger(size) && (size >= 0),
			`Invalid size given: ${size}`);
		this.throwUpIfDone();
		try {
			const delta = size - this.layout.contentSize;
			if (delta < 0) {
				await this.deleteBytes(size, -delta);
			} else if (delta > 0) {
				this.layout.appendEmptySection(delta);
			}
		} catch (err) {
			await this.errThis(err);
			throw err;
		}
	}

	async splice(pos: number, del: number, bytes?: Uint8Array): Promise<void> {
		assert(Number.isInteger(pos) && (pos >= 0)
			&& Number.isInteger(del) && (del >= 0),
			`Invalid arguments given: pos=${pos}, del=${del}`);
		this.throwUpIfDone();
		const ins = (bytes ? bytes.length : 0);
		if ((del === 0) && (ins === 0)) { return; }

		try {
			if (this.layout.contentSize <= pos) {
				if (ins === 0) { return; }
				await this.appendContentToRawSink(pos, bytes!);
			} else {
				if (del > 0) {
					await this.deleteBytes(pos, del);
				}
				if (ins > 0) {
					await this.appendContentToRawSink(pos, bytes!);
				}
			}
		} catch (err) {
			await this.errThis(err);
			throw err;
		}
	}

	private async appendContentToRawSink(
		pos: number, bytes: Uint8Array
	): Promise<void> {
		const ins = bytes.length;
		const writePosition = this.layout.insertSection(pos, ins);
		await this.rawSink.spliceLayout(writePosition, ins, ins);
		await this.rawSink.write(writePosition, bytes);
	}

	private async deleteBytes(pos: number, len: number): Promise<void> {
		// Note 1: only  base section are given for removal from sink. New bytes
		// become noise, cause we can't reliably splice them.
		// Note 2: there are no explicit records for noise sections, cause this
		// information is recoverable.
		const rmSegs = this.layout.cutSection(pos, len);
		if (rmSegs.length === 0) { return; }
		rmSegs.sort((a, b) => a.ofs - b.ofs);
		for (let i=(rmSegs.length-1); i>=0; i-=1) {
			const s = rmSegs[i];
			await this.rawSink.spliceLayout(s.ofs, s.len, 0);
		}
	}

	async done(err?: any): Promise<void> {
		if (this.isDone) {
			if (!err && this.err) {
				throw errWithCause(this.err, `File sink has already erred`);
			}
			return;
		}
		if (err) {
			await this.errThis(err);
			return;
		}
		await this.saveLayoutAndAttrs().catch(async err => {
			await this.errThis(err);
			throw err;
		});
		await this.rawSink.done();
		this.isDone = true;
	}

	private async saveLayoutAndAttrs(): Promise<void> {
		const sinkLen = await this.rawSink.getSize();
		const layoutOfs = this.layout.getLayoutOfsInSink();
		const bytes = this.layout.packIfNotTrivial(sinkLen);
		if (bytes) {
			this.attrs.setFileLayoutOfs(layoutOfs);
			await this.rawSink.setSize(layoutOfs + bytes.length);
			await this.rawSink.write(layoutOfs, bytes);
		} else {
			this.attrs.setContinuousFileSize(layoutOfs);
		}
		await this.rawSink.writeAttrs(this.attrs.toBytes());
	}

}
Object.freeze(FileSink.prototype);
Object.freeze(FileSink);


Object.freeze(exports);