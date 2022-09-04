/*
 Copyright (C) 2022 3NSoft Inc.
 
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

import { ByteSource } from "xsp-files";
import { assert } from "../../../lib-common/assert";
import { makeFileException, FileException } from "../../../lib-common/exceptions/file";
import { SingleProc } from "../../../lib-common/processes/synced";
import { XAttrs } from "./attrs";
import { Attrs, ReadonlyPayload } from "./node-persistence";

export async function makeReadonlyPayload(
	src: ByteSource
): Promise<ReadonlyPayload> {
	const payload = await ReadonlyPayloadV1.makeFor(src);
	return payload;
}

type FileByteSource = web3n.files.FileByteSource;


class ReadonlyPayloadV1 implements ReadonlyPayload {

	private readonly syncProc = new SingleProc();
	private xattrs: XAttrs|undefined = undefined;

	private constructor(
		private readonly src: ByteSource,
		private readonly size: number,
		private readonly isEndless = false,
	) {
		this.isEndless = (this.size === undefined);
		Object.seal(this);
	}

	static async makeFor(src: ByteSource): Promise<ReadonlyPayloadV1> {
		let { size, isEndless } = await src.getSize();
		return new ReadonlyPayloadV1(src, size, isEndless);
	}

	getAttrs(): Attrs {
		return {
			ctime: 0 , mtime: 0 , size: this.size, isEndless: this.isEndless
		};
	}

	async getXAttrs(): Promise<XAttrs> {
		if (!this.xattrs) {
			this.xattrs = XAttrs.makeEmpty();
		}
		return this.xattrs;
	}

	readAllContent(): Promise<Uint8Array|undefined> {
		if (this.isEndless) {
			throw makeEndlessException();
		}
		return this.readSomeContentBytes(0, this.size);
	}

	async readSomeContentBytes(
		start: number, end: number
	): Promise<Uint8Array|undefined> {
		if (this.isEndless) {
			throw makeEndlessException();
		}
		assert(Number.isInteger(start) && (start >= 0) && (start <= this.size));
		assert(Number.isInteger(end) && (end >= start) && (end <= this.size));
		if (end === start) { return; }
		return await this.syncProc.startOrChain(async () => {
			await this.src.seek(start);
			return await this.src.read(end - start);
		});
	}

	makeFileByteSource(): FileByteSource {
		const { getPosition, seek, read } = this.src;
		return {
			seek, getPosition, read,
			getSize: async () => this.size,
		};
	}

}
Object.freeze(ReadonlyPayloadV1.prototype);
Object.freeze(ReadonlyPayloadV1);


function makeEndlessException(): FileException {
	return makeFileException('isEndless', '');
}


Object.freeze(exports);