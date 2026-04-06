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

import { createReadStream, createWriteStream, promises as fsFns } from 'fs';
import { PlatformDeviceFS } from '../injected-globals/platform-devfs';
import { makeFileExceptionFromCode } from '../lib-common/exceptions/file';

function makeFileExceptionFromNodesAndThrow(nodeExc: NodeJS.ErrnoException): never {
	throw makeFileExceptionFromCode(nodeExc.code, nodeExc.path!, undefined, 1);
}

function wrapNodeFn<T extends Function>(nodePromisingFn: T): T {
	return function wrapOfNodePromisingFn(...args: any[]) {
		return nodePromisingFn.call(undefined, ...args).catch(makeFileExceptionFromNodesAndThrow);
	} as unknown as T;
}

export function makePlatformDeviceFS(): PlatformDeviceFS {
	return {

		readFile: wrapNodeFn(fsFns.readFile),

		writeFile: wrapNodeFn(fsFns.writeFile),

		appendFile: wrapNodeFn(fsFns.appendFile),

		mkdir: wrapNodeFn(fsFns.mkdir),

		open: wrapNodeFn(fsFns.open),

		symlink: wrapNodeFn(fsFns.symlink),

		readlink: wrapNodeFn(fsFns.readlink),

		lstat: wrapNodeFn(fsFns.lstat),

		stat: wrapNodeFn(fsFns.stat),

		readdir: wrapNodeFn(fsFns.readdir),

		rmdir: wrapNodeFn(fsFns.rmdir),

		unlink: wrapNodeFn(fsFns.unlink),

		rename: wrapNodeFn(fsFns.rename),

		truncate: wrapNodeFn(fsFns.truncate),

		copyFile: (src: string, dst: string, overwrite = false, dstMode = '660') => {
			return new Promise<void>((resolve, reject) => {
				const srcStream = createReadStream(src);
				const dstStream = createWriteStream(dst, {
					mode: parseInt(dstMode, 8),
					flags: (overwrite ? 'w' : 'wx')
				});
				srcStream.pipe(dstStream);
				dstStream.on('finish', () => {
					resolve();
				});
				const isRejected = false;
				const onErr = (err) => {
					if (!isRejected) {
						reject(err);
						srcStream.unpipe();
					}
				};
				srcStream.on('error', onErr);
				dstStream.on('error', onErr);
			});
		},

	};
}


Object.freeze(exports);