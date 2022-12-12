/*
 Copyright (C) 2015 - 2017 3NSoft Inc.
 
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

import { makeContinuousSink } from '../obj-streaming/sink-utils';

type FileByteSource = web3n.files.FileByteSource;
type FileByteSink = web3n.files.FileByteSink;

/**
 * This function pipes bytes from a given source to a given sink. Returned
 * promise resolves to a total number of piped bytes.
 * @param src
 * @param sink
 * @param progressCB is an optional progress callback that
 * @param closeSink is an optional parameter, which true (default) value closes
 * sink, when piping is done, while false value keeps sink open.
 * @param bufSize is an optional parameter for buffer, used for byte transfer.
 * Default value is 64K.
 */
export async function pipe(
	src: FileByteSource, sink: FileByteSink,
	progressCB?: ((bytesPiped: number) => void),
	closeSink = true, bufSize = 64*1024
): Promise<number> {
	const contSink = makeContinuousSink(sink);
	try {
		let buf = await src.readNext(bufSize);
		let bytesPiped = 0;
		while (buf) {
			await contSink(buf);
			bytesPiped += buf.length;
			if (progressCB) { progressCB(bytesPiped); }
			buf = await src.readNext(bufSize);
		}
		if (closeSink) {
			await contSink(null);
		}
		return bytesPiped;
	} catch (err) {
		if (closeSink) {
			await contSink(null, err);
		}
		throw err;
	}
}

Object.freeze(exports);