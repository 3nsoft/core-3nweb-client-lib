/*
 Copyright (C) 2015 - 2019, 2021 3NSoft Inc.
 
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

import * as fs from 'fs';
import { createReadStream, createWriteStream, statSync } from 'fs';
import { Readable, Writable } from 'stream';
import { FileException, Code as excCode, makeFileException } from './exceptions/file';
import { SingleProc } from './processes/synced';
import { defer, Deferred } from './processes/deferred';
import { BytesFIFOBuffer } from './byte-streaming/bytes-fifo-buffer';
import { toBuffer } from './buffer-utils';
import { join } from 'path';

export { Stats } from 'fs';
export { FileException } from './exceptions/file';

function makeFileExceptionFromNodes(
	nodeExc: NodeJS.ErrnoException
): FileException {
	return makeFileException(nodeExc.code!, nodeExc.path!);
}

export function readFile(
	filename: string, options: { encoding: BufferEncoding; flag?: string; }
): Promise<string>;
export function readFile(
	filename: string, options?: { flag?: string; }
): Promise<Buffer>;
export function readFile(
	path: string, options?: { flag?: string; encoding?: BufferEncoding; }
): Promise<Buffer|string> {
	return new Promise<Buffer>((resolve, reject) => {
		const cb = (err, data) => {
			if (err) { reject(makeFileExceptionFromNodes(err)); }
			else { resolve(data); }
		};
		if (options) {
			fs.readFile(path, options, cb);
		} else {
			fs.readFile(path, cb);
		}
	});
}

export function writeFile(
	path: string, data: any,
	options: { encoding?: BufferEncoding; mode?: string; flag?: string; } = {}
): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		fs.writeFile(path, data, options, err => {
			if (err) { reject(makeFileExceptionFromNodes(err)); }
			else { resolve(); }
		});
	});
}

export function appendFile(
	path: string, data: any,
	options: { encoding?: BufferEncoding; mode?: string; flag?: string; } = {}
): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		fs.appendFile(path, data, options, err => {
			if (err) { reject(makeFileExceptionFromNodes(err)); }
			else { resolve(); }
		});
	});
}

export function mkdir(
	path: string, options?: number | string | fs.MakeDirectoryOptions | null
): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		fs.mkdir(path, options, (err) => {
			if (err) { reject(makeFileExceptionFromNodes(err)); }
			else { resolve(); }
		});
	});
}

export function open(path: string, flags: string): Promise<number> {
	return new Promise<number>((resolve, reject) => {
		fs.open(path, flags, (err, df) => {
			if (err) { reject(makeFileExceptionFromNodes(err)); }
			else { resolve(df); }
		});
	});
}

function writeOrig(
	fd: number, buffer: Buffer, offset: number, length: number,
	position?: number
): Promise<number> {
	return new Promise<number>((resolve, reject) => {
		const cb = (err, written) => {
			if (err) { reject(makeFileExceptionFromNodes(err)); }
			else { resolve(written); }
		};
		if (typeof position === 'number') {
			fs.write(fd, buffer, offset, length, position, cb);
		} else {
			fs.write(fd, buffer, offset, length, cb);
		}
	});
}

function readOrig(
	fd: number, buffer: Buffer, offset: number, length: number, position: number
): Promise<number> {
	return new Promise<number>((resolve, reject) => {
		fs.read(fd, buffer, offset, length, position, (err, bytesRead) => {
			if (err) { reject(makeFileExceptionFromNodes(err)); }
			else { resolve(bytesRead); }
		});
	});
}

export function close(fd: number): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		fs.close(fd, (err) => {
			if (err) { reject(makeFileExceptionFromNodes(err)); }
			else { resolve(); }
		});
	});
}

export function symlink(
	target: string, path: string, type?: 'dir'|'file'|'junction'
): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		fs.symlink(target, path, type, (err) => {
			if (err) { reject(makeFileExceptionFromNodes(err)); }
			else { resolve(); }
		});
	});
}

export function readlink(path: string): Promise<string> {
	return new Promise<string>((resolve, reject) => {
		fs.readlink(path, (err, targetPath) => {
			if (err) { reject(makeFileExceptionFromNodes(err)); }
			else { resolve(targetPath); }
		});
	});
}

export function lstat(path: string): Promise<fs.Stats> {
	return new Promise<fs.Stats>((resolve, reject) => {
		fs.lstat(path, (err, stat) => {
			if (err) { reject(makeFileExceptionFromNodes(err)); }
			else { resolve(stat); }
		});
	});
}

export function stat(path: string): Promise<fs.Stats> {
	return new Promise<fs.Stats>((resolve, reject) => {
		fs.stat(path, (err, stat) => {
			if (err) { reject(makeFileExceptionFromNodes(err)); }
			else { resolve(stat); }
		});
	});
}

export function fstat(fd: number): Promise<fs.Stats> {
	return new Promise<fs.Stats>((resolve, reject) => {
		// from some moment, typing of fs.fstat is broken
		(fs.fstat as any)(fd, (err, stat) => {
			if (err) { reject(makeFileExceptionFromNodes(err)); }
			else { resolve(stat); }
		});
	});
}

export function readdir(path: string): Promise<string[]> {
	return new Promise<string[]>((resolve, reject) => {
		fs.readdir(path, (err, list) => {
			if (err) { reject(makeFileExceptionFromNodes(err)); }
			else { resolve(list); }
		});
	});
}

export function rmdir(path: string): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		fs.rmdir(path, (err) => {
			if (err) { reject(makeFileExceptionFromNodes(err)); }
			else { resolve(); }
		});
	});
}

export function unlink(path: string): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		fs.unlink(path, (err) => {
			if (err) { reject(makeFileExceptionFromNodes(err)); }
			else { resolve(); }
		});
	});
}

export function rename(oldPath: string, newPath: string): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		fs.rename(oldPath, newPath, (err) => {
			if (err) { reject(makeFileExceptionFromNodes(err)); }
			else { resolve(); }
		});
	});
}

export function truncate(path: string, size: number): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		fs.truncate(path, size, (err) => {
			if (err) { reject(makeFileExceptionFromNodes(err)); }
			else { resolve(); }
		});
	});
}

export function ftruncate(fd: number, size: number): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		fs.ftruncate(fd, size, (err) => {
			if (err) { reject(makeFileExceptionFromNodes(err)); }
			else { resolve(); }
		});
	});
}

/**
 * @param fd is an open file descriptor
 * @param pos is a position in the file, from which reading should start
 * @param buf is a buffer, into which bytes should be read from start to
 * the end, i.e. number of bytes that must be read is equal to the buffer's
 * length.
 * @returns a promise, resolvable when buffer is completely filled with bytes
 * from the file.
 * The promise fails, if an end of file is encountered before entire buffer is
 * filled up with bytes.
 */
export async function readToBuf(
	fd: number, pos: number, buf: Buffer
): Promise<void> {
	if ((typeof pos !== 'number') || (pos < 0)) { throw new Error(
		'Illegal file position given: '+pos); }
	let bytesRead = 0
	while (bytesRead < buf.length) {
		const bNum = await readOrig(fd, buf, bytesRead, buf.length-bytesRead, pos);
		if (bNum === 0) { throw makeFileException(excCode.endOfFile, '<file descriptor>'); }
		bytesRead += bNum;
		pos += bNum;
	}
}

/**
 * @param fd is an open file descriptor
 * @param pos is a position in the file, from which writing should start
 * @param buf is a buffer, from which all bytes should be written into the file.
 * @returns a promise, resolvable when all bytes were written to the file.
 */
export async function writeFromBuf(
	fd: number, pos: number, buf: Buffer
): Promise<void> {
	if ((typeof pos !== 'number') || (pos < 0)) { throw new Error(
		'Illegal file position given: '+pos); }
	let bytesWritten = 0;
	while (bytesWritten < buf.length) {
		const bNum = await writeOrig(fd, buf,
			bytesWritten, buf.length-bytesWritten, pos);
		bytesWritten += bNum;
		pos += bNum;
	}
}

const SINGLE_BYTE_BUF = Buffer.alloc(1);
SINGLE_BYTE_BUF[0] = 0;

/**
 * This will create a new file of a given size, and will fail, if a file
 * with a given path already exists.
 * @param filePath
 * @param fileSize
 * @param keepFileOpen
 * @returns a promise, resolvable, when a new empty file has been created.
 * When keep open flag was passed, live numeric file descriptor is returned,
 * else return value is undefined and should be ignored.
 */
export async function createEmptyFile(
	filePath: string, fileSize: number, keepFileOpen?: boolean
): Promise<number|undefined> {
	if ((typeof fileSize !== 'number') || (fileSize < 0)) { throw new Error(
		'Illegal file size given: '+fileSize); }
	let fileDescr: number|undefined;
	try {
		fileDescr = await open(filePath, 'wx');
		if (fileSize > 0) {
			await writeOrig(fileDescr, SINGLE_BYTE_BUF, 0, 1, fileSize-1);
		}
		if (keepFileOpen) { return fileDescr; }
		await close(fileDescr);
	} catch (exc) {
		if (fileDescr) {
			close(fileDescr).catch(() => {});
		}
		throw exc;
	}
}

/**
 * @param path
 * @return a promise, resolvable to true, if given path represents directory,
 * or false, if it does not.
 */
 export async function existsFolder(path: string): Promise<boolean> {
	try {
		const stats = await stat(path);
		if (stats.isDirectory()) {
			return true;
		} else {
			throw makeFileException(excCode.notDirectory, path);
		}
	} catch (e) {
		if ((<NodeJS.ErrnoException> e).code === excCode.notFound) {
			return false;
		}
		throw e;
	}
}

/**
 * @param path
 * @return true, if given path represents directory, or false, if it does not.
 */
export function existsFolderSync(path: string): boolean {
	try {
		if (statSync(path).isDirectory()) {
			return true;
		} else {
			throw makeFileException(excCode.notDirectory, path);
		}
	} catch (e) {
		if ((<NodeJS.ErrnoException> e).code === excCode.notFound) {
			return false;
		}
		throw e;
	}
}

/**
 * @param path
 * @return true, if given path represents file, or false, if it does not.
 */
export function existsFileSync(path: string): boolean {
	try {
		if (statSync(path).isFile()) {
			return true;
		} else {
			throw makeFileException(excCode.notFile, path);
		}
	} catch (e) {
		if ((<NodeJS.ErrnoException> e).code === excCode.notFound) {
			return false;
		}
		throw e;
	}
}

/**
 * @param filePath
 * @return a promise, resolvable to file's size.
 */
export async function getFileSize(filePath: string): Promise<number> {
	const st = await stat(filePath);
	return st.size;
}

/**
 * This returns a promise of total size of given folder's content.
 * Sizes of linked objects are not included.
 * @param folderPath
 */
export async function getFolderContentSize(
	folderPath: string
): Promise<number> {
	const list = await readdir(folderPath);
	let size = 0;
	for (const childName of list) {
		const childPath = `${folderPath}/${childName}`;
		const childStats = await stat(childPath);
		if (childStats.isFile()) {
			size += childStats.size;
		} else if (childStats.isDirectory()) {
			size += await getFolderContentSize(childPath);
		}
	}
	return size;
}

/**
 * @param fd is an open file descriptor
 * @param pos is a position in the file, from which writing should start
 * @param buf is a buffer, from which all bytes should be written into the file.
 * @returns a promise, resolvable when all bytes were written to it.
 */
export async function write(
	fd: number, pos: number, buf: Buffer
): Promise<void> {
	if ((typeof pos !== 'number') || (pos < 0)) { throw new Error(
		'Illegal file position given: '+pos); }
	let bytesWritten = 0;
	while (bytesWritten < buf.length) {
		const bNum = await writeOrig(fd, buf,
			bytesWritten, buf.length-bytesWritten, pos);
		bytesWritten += bNum;
		pos += bNum;
	}
}

/**
 * @param fd is an open file descriptor in append mode.
 * @param buf is a buffer, from which all bytes should be written into the file.
 * @returns a promise, resolvable when all bytes were written to it.
 */
export async function append(
	fd: number, buf: Buffer
): Promise<void> {
	let bytesWritten = 0;
	while (bytesWritten < buf.length) {
		const bNum = await writeOrig(fd, buf,
			bytesWritten, buf.length-bytesWritten);
		bytesWritten += bNum;
	}
}

/**
 * @param filePath is a path to an existing file
 * @param pos is a position in the file, from which writing should start
 * @param buf is a buffer, from which all bytes should be written into the file.
 * @returns a promise, resolvable when all bytes were written to it.
 */
async function writeToExistingFile(
	filePath: string, pos: number, buf: Buffer
): Promise<void> {
	const fd = await open(filePath, 'r+');
	try {
		await write(fd, pos, buf);
	} finally {
		await close(fd);
	}
}

/**
 * @param filePath
 * @param pos is a position in the file, from which writting should start
 * @param len is a number of bytes to read from a source and write into a file
 * @param src is a readable stream, from which bytes should be written into a
 * file
 * @param bufSize is a size of the buffer, used in this streaming
 * @return a promise, resolvable when streaming into file from a given readable
 * source completes.
 */
export async function streamToExistingFile(
	filePath: string, pos: number, len: number, src: Readable, bufSize: number
): Promise<void> {
	if ((typeof pos !== 'number') || (pos < 0)) { throw new Error(
		'Illegal file position given: '+pos); }
	if ((typeof len !== 'number') || (len < 1)) { throw new Error(
		'Illegal length given: '+len); }
	if ((typeof bufSize !== 'number') || (bufSize < 1024)) { throw new Error(
		'Illegal buffer size given: '+bufSize); }
		
	const writeProc = new SingleProc();
	let bytesWritten = 0;
	let bytesRead = 0;
	const buf = new BytesFIFOBuffer();
	let deferred: Deferred<void>|undefined = defer<void>();
	let doneReading = false;

	const complete = (err?: any): void => {
		if (!deferred) { return; }
		if (err) { deferred.reject(err); }
		else { deferred.resolve(); }
		deferred = undefined;
		doneReading = true;
		buf.clear();
	};

	src.on('data', (data: Buffer) => {
		if (doneReading || !deferred) { return; }
		buf.push(data);
		bytesRead += data.length;
		
		if (bytesRead >= len) {
			doneReading = true;
		} else if (buf.length < bufSize) {
			return;
		}

		writeProc.startOrChain(async () => {
			if (!deferred) { return; }
			try {
				const bytesToWrite = buf.getBytes(len - bytesWritten, true);
				if (!bytesToWrite) { return; }
				await writeToExistingFile(filePath, pos, toBuffer(bytesToWrite));
				pos += bytesToWrite.length;
				bytesWritten += bytesToWrite.length;
				if (bytesWritten < len) { return; }
				complete();
			} catch (err) {
				complete(err);
			}
		});

	});
	
	src.on('end', () => {
		if (doneReading) { return; }
		complete(makeFileException(excCode.endOfFile, '<input stream>'));
	});
	
	src.on('error', (err) => {
		complete(err);
	});

	src.resume();	// noop, if stream wasn't paused

	return deferred.promise;
}

/**
 * @param fd is an open file descriptor
 * @param pos is a position in the file, from which reading should start
 * @param buf is a buffer, into which bytes should be read from start to
 * the end, i.e. number of bytes that must be read is equal to the buffer's
 * length.
 * @returns a promise, resolvable when buffer is completely filled with bytes
 * from the file.
 * The promise fails, if an end of file is encountered before entire buffer is
 * filled up with bytes.
 */
export async function read(
	fd: number, pos: number, buf: Buffer
): Promise<void> {
	if ((typeof pos !== 'number') || (pos < 0)) { throw new Error(
		'Illegal file position given: '+pos); }
	let bytesRead = 0
	while (bytesRead < buf.length) {
		const bNum = await readOrig(fd, buf, bytesRead, buf.length-bytesRead, pos);
		if (bNum === 0) { throw makeFileException(excCode.endOfFile, '<file descriptor>'); }
		bytesRead += bNum;
		pos += bNum;
	}
}

/**
 * @param filePath is a file's path, from which to read
 * @param pos is a position in the file, from which reading should start
 * @param buf is a buffer, into which bytes should be read from start to
 * the end, i.e. number of bytes that must be read is equal to the buffer's
 * length.
 * @returns a promise, resolvable when buffer is completely filled with bytes
 * from the file.
 * The promise fails, if an end of file is encountered before entire buffer is
 * filled up with bytes.
 */
async function readFromFile(
	filePath: string, pos: number, buf: Buffer
): Promise<void> {
	const fd = await open(filePath, 'r');
	try {
		return read(fd, pos, buf);
	} finally {
		return close(fd);
	}
}

/**
 * @param folder is a path to a folder, which should be recursively removed,
 * together with all files.
 * @returns a promise, resolvable, when a folder has been recursively removed.
 */
export async function rmDirWithContent(folder: string): Promise<void> {
	const files = await readdir(folder);
	if (files.length === 0) {
		await rmdir(folder);
		return;
	}
	const rmTasks: Promise<void>[] = [];
	for (const name of files) {
		const innerPath = `${folder}/${name}`;
		const task = lstat(innerPath)
		.then((st) => {
			if (st.isDirectory()) {
				return rmDirWithContent(innerPath);
			} else {
				return unlink(innerPath);
			}
		});
		rmTasks.push(task);
	}
	await Promise.all(rmTasks);
	await rmdir(folder);
}

/**
 * @param w is a writable stream
 * @param buf is buffer of bytes that should be sunk into given stream
 * @return a promise, resolvable when all bytes have been absobed by the
 * writable.
 */
function sinkBytes(w: Writable, buf: Buffer): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		w.write(buf, (err) => {
			if (err) { reject(err); }
			else { resolve(); }
		});
	});
}

/**
 * @param filePath
 * @param pos is a position in the file, from which read should start
 * @param len is a number of bytes to read from file and write into a sink
 * @param sink is a writable stream, into which bytes should be sunk
 * @param bufSize is a size of the buffer, used in this streaming
 * @return a promise, resolvable when streaming from file into given writable
 * sink completes.
 */
export async function streamFromFile(
	filePath: string, pos: number, len: number, sink: Writable, bufSize: number
): Promise<void> {
	if ((typeof pos !== 'number') || (pos < 0)) { throw new Error(
		'Illegal file position given: '+pos); }
	if ((typeof len !== 'number') || (len < 1)) { throw new Error(
		'Illegal length given: '+len); }
	if ((typeof bufSize !== 'number') || (bufSize < 1024)) { throw new Error(
		'Illegal buffer size given: '+bufSize); }
	let buf = Buffer.alloc(Math.min(bufSize, len));
	let byteCount = 0;
	while (byteCount < len) {
		const bytesLeft = len - byteCount;
		if (buf.length > bytesLeft) {
			buf = buf.slice(0, bytesLeft);
		}
		await readFromFile(filePath, pos+byteCount, buf);
		await sinkBytes(sink, buf);
		byteCount += buf.length;
	}
}

/**
 * This pipes source file into destination file.
 * @param src
 * @param dst
 * @param overwrite
 * @return a promise, resolvable when piping completes.
 */
export function copyFile(
	src: string, dst: string, overwrite = false, dstMode = '660'
): Promise<void> {
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
}

/**
 * This copies tree of files from source to destination folders.
 * Target folders may exist in a destination tree.
 * Objects that are neither files, nor folders, are ignored.
 * @param src
 * @param dst
 * @param fileOverwrite when set to true, allows to overwrite files in a
 * destination tree. Otherwise, exception is thrown on already existing files.
 * @return a promise resolvable when the whole tree is copied from source to
 * destination.
 */
export async function copyTree(
	src: string, dst: string, fileOverwrite = false
): Promise<void> {
	// destination folder, non-exclusively
	await mkdir(dst, { recursive: true })
	.catch(async (exc: FileException) => {
		if (!exc.alreadyExists) { throw exc; }
	});
	// copy files and folders from src folder
	const srcFNames = await readdir(src);
	const cpTasks: Promise<void>[] = [];
	for (const fName of srcFNames) {
		const srcPath = join(src, fName);
		const dstPath = join(dst, fName);
		const task = stat(srcPath)
		.then((stats) => {
			if (stats.isFile()) {
				return copyFile(srcPath, dstPath, fileOverwrite);
			} else if (stats.isDirectory()) {
				return copyTree(srcPath, dstPath, fileOverwrite);
			}
		});
		cpTasks.push(task);
	}
	await Promise.all(cpTasks);
}

/**
 * This function checks that given folder exists. If folder is not present,
 * it is created, recreating whole folder tree, if needed.
 * This function can be called concurrently.
 * @param path is a folder path
 */
export async function ensureFolderExists(path: string): Promise<void> {
	await stat(path).catch(async (exc: FileException) => {
		if (!exc.notFound) { throw exc; }
		await mkdir(path, { recursive: true })
		.catch(async (exc: FileException) => {
			if (!exc.alreadyExists) { throw exc; }
		});
	});
}

Object.freeze(exports);