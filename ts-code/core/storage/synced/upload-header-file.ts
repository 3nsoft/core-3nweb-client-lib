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

import { join } from "path";
import { UploadHeaderChange } from "../../../lib-client/3nstorage/xsp-fs/common";
import { FileException, readFile, writeFile } from "../../../lib-common/async-fs-node";
import { Code } from "../../../lib-common/exceptions/file";
import { packUintTo8Bytes, uintFrom8Bytes } from "../../../lib-common/big-endian";
import { assert } from "../../../lib-common/assert";

export const UPLOAD_HEADER_FILE_NAME_EXT = 'upload';

export async function saveUploadHeaderFile(
	objFolder: string, headers: UploadHeaderChange
): Promise<void> {
	const bytes = packUploadHeaderChange(headers);
	const upFile = uploadHeaderFilePath(objFolder, headers.uploadVersion);
	await writeFile(upFile, bytes);
}

export async function readUploadHeaderFromFile(
	objFolder: string, uploadVersion: number
): Promise<UploadHeaderChange|undefined> {
	try {
		const upFile = uploadHeaderFilePath(objFolder, uploadVersion);
		const bytes = await readFile(upFile);
		return unpackUploadHeaderChange(bytes);
	} catch (exc) {
		if ((exc as FileException).code !== Code.notFound) {
			throw exc;
		} 
	}
}

function uploadHeaderFilePath(
	objFolder: string, uploadVersion: number
): string {
	return join(objFolder, `${uploadVersion}.${UPLOAD_HEADER_FILE_NAME_EXT}`);
}

function packUploadHeaderChange({
	localHeader, localVersion, uploadHeader, uploadVersion
}: UploadHeaderChange): Buffer {
	assert(localHeader.length === uploadHeader.length);
	const bytes = Buffer.allocUnsafe(16 + 2*localHeader.length);
	packUintTo8Bytes(localVersion, bytes, 0);
	packUintTo8Bytes(uploadVersion, bytes, 8);
	bytes.set(localHeader, 16);
	bytes.set(uploadHeader, 16 + localHeader.length);
	return bytes;
}

function unpackUploadHeaderChange(bytes: Buffer): UploadHeaderChange {
	const localVersion = uintFrom8Bytes(bytes, 0);
	const uploadVersion = uintFrom8Bytes(bytes, 8);
	const headerLen = (bytes.length - 16)/2;
	assert(Number.isInteger(headerLen));
	const localHeader = bytes.slice(16, 16 + headerLen);
	const uploadHeader = bytes.slice(16 + headerLen);
	return { localHeader, localVersion, uploadHeader, uploadVersion };
}


Object.freeze(exports);