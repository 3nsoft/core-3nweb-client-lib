/*
 Copyright (C) 2018, 2020, 2022 3NSoft Inc.

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

import { SegmentsWriter, Subscribe, ByteSink, makeEncryptingByteSink } from "xsp-files";
import { byteLengthIn } from "../buffer-utils";

type FileByteSink = web3n.files.FileByteSink;

export type ContinuousSink =
	(bytes: Uint8Array|null, err?: any) => Promise<void>;

class ContSink {

	constructor(
		private sink: FileByteSink,
		private position: number,
	) {
		Object.seal(this);
	}

	private async write(bytes: Uint8Array|null, err?: any): Promise<void> {
		if (bytes) {
			const len = bytes.length;
			await this.sink.splice(this.position, len, bytes);
			this.position += len;
		} else {
			await this.sink.done(err);
		}
	}

	wrap(): ContinuousSink {
		const f = this.write.bind(this);
		return f;
	}
}
Object.freeze(ContSink.prototype);
Object.freeze(ContSink);

export function makeContinuousSink(
	sink: FileByteSink, start = 0
): ContinuousSink {
	const contSink = new ContSink(sink, start);
	return contSink.wrap();
}

export async function appendFiniteSink(
	sink: FileByteSink, bytes: Uint8Array, closeSink = true
): Promise<void> {
	const initSize = await sink.getSize();
	await sink.splice(initSize, 0, bytes);
	if (closeSink) {
		await sink.done();
	}
}

Object.freeze(exports);