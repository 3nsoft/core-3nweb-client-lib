/*
 Copyright (C) 2018, 2020 3NSoft Inc.

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

import { SingleProc, makeSyncedFunc } from "../processes/synced";
import { ByteSource } from "xsp-files";

type FileByteSource = web3n.files.FileByteSource;
type FileByteSink = web3n.files.FileByteSink;

export function wrapAndSyncFileSink(sink: FileByteSink): FileByteSink {
	const syncProc = new SingleProc();
	const w: FileByteSink = {
		done: makeSyncedFunc(syncProc, sink, sink.done),
		getSize: makeSyncedFunc(syncProc, sink, sink.getSize),
		showLayout: makeSyncedFunc(syncProc, sink, sink.showLayout),
		splice: makeSyncedFunc(syncProc, sink, sink.splice),
		truncate: makeSyncedFunc(syncProc, sink, sink.truncate)
	};
	return w;
}

export function wrapAndSyncSource(src: ByteSource): ByteSource {
	const syncProc = new SingleProc();
	const w: ByteSource = {
		getPosition: makeSyncedFunc(syncProc, src, src.getPosition),
		getSize: makeSyncedFunc(syncProc, src, src.getSize),
		readNext: makeSyncedFunc(syncProc, src, src.readNext),
		readAt: makeSyncedFunc(syncProc, src, src.readAt),
		seek: makeSyncedFunc(syncProc, src, src.seek)
	};
	return w;
}

export function wrapAndSyncFileSource(src: FileByteSource): FileByteSource {
	const syncProc = new SingleProc();
	const w: FileByteSource = {
		getPosition: makeSyncedFunc(syncProc, src, src.getPosition),
		getSize: makeSyncedFunc(syncProc, src, src.getSize),
		readNext: makeSyncedFunc(syncProc, src, src.readNext),
		readAt: makeSyncedFunc(syncProc, src, src.readAt),
		seek: makeSyncedFunc(syncProc, src, src.seek),
	};
	return w;
}

Object.freeze(exports);