/*
 Copyright (C) 2026 3NSoft Inc.
 
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

import { Abortable } from 'events';
import type { BigIntStats, BufferEncodingOption, Dirent, promises as fsFns, MakeDirectoryOptions, Mode, ObjectEncodingOptions, OpenMode, PathLike, RmDirOptions, StatOptions, Stats } from 'fs';
import { FlagAndOpenMode } from 'fs/promises';
import type Stream = require('stream');

export type { Stats } from 'fs';
export type { FileException } from '../lib-common/exceptions/file';
export type FileHandle = fsFns.FileHandle;

/**
 * This should be injected at globalThis.platform.device_fs
 */
export interface PlatformDeviceFS {

	readFile: typeof readFile;
	writeFile: typeof writeFile;
	appendFile: typeof appendFile;
	mkdir: typeof mkdir;
	open: typeof open;
	symlink: typeof symlink;
	readlink: typeof readlink;
	lstat: typeof lstat;
	stat: typeof stat;
	readdir: typeof readdir;
	rmdir: typeof rmdir;
	unlink: typeof unlink;
	rename: typeof rename;
	truncate: typeof truncate;

	/**
	 * This pipes source file into destination file.
	 * @param src
	 * @param dst
	 * @param overwrite
	 * @return a promise, resolvable when piping completes.
	 */
	copyFile(src: string, dst: string, overwrite?: boolean, dstMode?: string): Promise<void>;

}

// Below are types from node; these may be reduced as library doesn't use all node's options

declare function readFile(
		path: PathLike | FileHandle,
		options?:
			| ({
				encoding?: null | undefined;
				flag?: OpenMode | undefined;
			} & Abortable)
			| null,
): Promise<Buffer>;
declare function readFile(
		path: PathLike | FileHandle,
		options:
			| ({
				encoding: BufferEncoding;
				flag?: OpenMode | undefined;
			} & Abortable)
			| BufferEncoding,
): Promise<string>;
declare function readFile(
		path: PathLike | FileHandle,
		options?:
			| (
				& ObjectEncodingOptions
				& Abortable
				& {
						flag?: OpenMode | undefined;
				}
			)
			| BufferEncoding
			| null,
): Promise<string | Buffer>;

declare function writeFile(
		file: PathLike | FileHandle,
		data:
			| string
			| NodeJS.ArrayBufferView
			| Iterable<string | NodeJS.ArrayBufferView>
			| AsyncIterable<string | NodeJS.ArrayBufferView>
			| Stream,
		options?:
			| (ObjectEncodingOptions & {
				mode?: Mode | undefined;
				flag?: OpenMode | undefined;
				flush?: boolean | undefined;
			} & Abortable)
			| BufferEncoding
			| null,
): Promise<void>;

declare function appendFile(
	path: PathLike | FileHandle,
	data: string | Uint8Array,
	options?: (ObjectEncodingOptions & FlagAndOpenMode & { flush?: boolean | undefined }) | BufferEncoding | null,
): Promise<void>;

declare function mkdir(
	path: PathLike,
	options: MakeDirectoryOptions & {
		recursive: true;
	},
): Promise<string | undefined>;
declare function mkdir(
	path: PathLike,
	options?:
		| Mode
		| (MakeDirectoryOptions & {
				recursive?: false | undefined;
		})
		| null,
): Promise<void>;
declare function mkdir(path: PathLike, options?: Mode | MakeDirectoryOptions | null): Promise<string | undefined>;

declare function open(path: PathLike, flags?: string | number, mode?: Mode): Promise<FileHandle>;

declare function symlink(target: PathLike, path: PathLike, type?: string | null): Promise<void>;

declare function readlink(path: PathLike, options?: ObjectEncodingOptions | BufferEncoding | null): Promise<string>;
declare function readlink(path: PathLike, options: BufferEncodingOption): Promise<Buffer>;
declare function readlink(path: PathLike, options?: ObjectEncodingOptions | string | null): Promise<string | Buffer>;

declare function lstat(
	path: PathLike,
	opts?: StatOptions & {
		bigint?: false | undefined;
	},
): Promise<Stats>;
declare function lstat(
	path: PathLike,
	opts: StatOptions & {
		bigint: true;
	},
): Promise<BigIntStats>;
declare function lstat(path: PathLike, opts?: StatOptions): Promise<Stats | BigIntStats>;

declare function stat(
	path: PathLike,
	opts?: StatOptions & {
		bigint?: false | undefined;
	},
): Promise<Stats>;
declare function stat(
	path: PathLike,
	opts: StatOptions & {
		bigint: true;
	},
): Promise<BigIntStats>;
declare function stat(path: PathLike, opts?: StatOptions): Promise<Stats | BigIntStats>;

declare function readdir(
	path: PathLike,
	options?:
		| (ObjectEncodingOptions & {
			withFileTypes?: false | undefined;
			recursive?: boolean | undefined;
		})
		| BufferEncoding
		| null,
): Promise<string[]>;
declare function readdir(
	path: PathLike,
	options:
		| {
			encoding: "buffer";
			withFileTypes?: false | undefined;
			recursive?: boolean | undefined;
		}
		| "buffer",
): Promise<Buffer[]>;
declare function readdir(
		path: PathLike,
		options?:
				| (ObjectEncodingOptions & {
						withFileTypes?: false | undefined;
						recursive?: boolean | undefined;
				})
				| BufferEncoding
				| null,
): Promise<string[] | Buffer[]>;
declare function readdir(
		path: PathLike,
		options: ObjectEncodingOptions & {
				withFileTypes: true;
				recursive?: boolean | undefined;
		},
): Promise<Dirent[]>;
declare function readdir(
		path: PathLike,
		options: {
				encoding: "buffer";
				withFileTypes: true;
				recursive?: boolean | undefined;
		},
): Promise<Dirent<Buffer>[]>;

declare function rmdir(path: PathLike, options?: RmDirOptions): Promise<void>;

declare function unlink(path: PathLike): Promise<void>;

declare function rename(oldPath: PathLike, newPath: PathLike): Promise<void>;

declare function truncate(path: PathLike, len?: number): Promise<void>;

Object.freeze(exports);