/*
 Copyright (C) 2015 - 2018, 2020 - 2022 3NSoft Inc.
 
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

export type FileException = web3n.files.FileException;
export type FileExceptionFlag = web3n.files.FileExceptionFlag;

export const Code: web3n.files.exceptionCode = {
	notFound: 'ENOENT',
	alreadyExists: 'EEXIST',
	notDirectory: 'ENOTDIR',
	notFile: 'ENOTFILE',
	isDirectory: 'EISDIR',
	notEmpty: 'ENOTEMPTY',
	endOfFile: 'EEOF',
	opNotPermitted: 'EPERM',
	busy: 'EBUSY',
	ioError: 'EIO',
	notImplemented: 'ENOSYS',
};
Object.freeze(Code);

const codeToFlag: { [code: string]: keyof web3n.files.exceptionCode; } = {};
for (const [flag, code] of Object.entries(Code)) {
	codeToFlag[code] = flag as keyof web3n.files.exceptionCode;
}

export function makeFileExceptionFromCode(
	code: string|undefined, path: string, cause?: any
): FileException {
	const err: FileException = {
		runtimeException: true,
		type: 'file',
		code,
		path,
		cause
	};
	if (code) {
		const flag = codeToFlag[code];
		if (flag) {
			err[flag] = true;
		}
	}
	return err;
}

export function makeFileException(
	flag: keyof FileExceptionFlag, path: string, cause?: any
): FileException {
	const code = Code[flag];
	const err: FileException = {
		runtimeException: true,
		type: 'file',
		code,
		path,
		cause
	};
	err[flag] = true;
	return err;
}

export function maskPathInExc(
	pathPrefixMaskLen: number, exc: any
): FileException {
	if (!exc.runtimeException || !exc.code) { return exc; }
	if (typeof exc.path === 'string') {
		exc.path = exc.path.substring(pathPrefixMaskLen);
	}
	return exc;
}

export function ensureCorrectFS(
	fs: web3n.files.FS, type: web3n.files.FSType, writable: boolean
): void {
	if (!fs) { throw new Error("No file system given."); }
	if (fs.type !== type) { throw new Error(
		`Expected ${type} file system, instead got ${fs.type} type.`); }
	if (fs.writable !== writable) { throw new Error(
		`Given file system is ${fs.writable ? '' : 'not'} writable, while it is expected to be ${writable ? '' : 'not'} writable`); }
}

export function makeNoAttrsExc(path: string): FileException {
	return {
		runtimeException: true,
		type: 'file',
		code: undefined,
		path,
		attrsNotEnabledInFS: true
	};
}

export function makeVersionMismatchExc(path: string, message?: string): FileException {
	return {
		runtimeException: true,
		type: 'file',
		code: undefined,
		path,
		versionMismatch: true,
		message
	}
}


Object.freeze(exports);