/*
 Copyright (C) 2015 - 2016, 2019 3NSoft Inc.
 
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

import { ObjId } from "./xsp-fs/common";

export interface StorageException extends web3n.RuntimeException {
	type: 'storage';
	objId?: ObjId;
	version?: number;
	objNotFound?: boolean;
	objExists?: boolean;
	concurrentTransaction?: boolean;
	unknownTransaction?: boolean;
	versionMismatch?: boolean;
	currentVersion?: number;
	storageIsClosed?: boolean;
}

export function makeStorageException(
	fields: Partial<StorageException>
): StorageException {
	const exc: StorageException = {
		runtimeException: true,
		type: 'storage'
	};
	for (const [ key, value ] of Object.entries(fields)) {
		exc[key] = value;
	}
	return exc;
}

export function makeObjNotFoundExc(
	objId: ObjId, version?: number
): StorageException {
	return makeStorageException({ objId, version, objNotFound: true });
}

export function makeObjExistsExc(
	objId: ObjId, version?: number
): StorageException {
	return makeStorageException({ objId, version, objExists: true });
}

export function makeConcurrentTransExc(objId: ObjId): StorageException {
	return makeStorageException({ objId, concurrentTransaction: true });
}

export function makeUnknownTransactionExc(objId: ObjId): StorageException {
	return makeStorageException({ objId, unknownTransaction: true });
}

export function makeVersionMismatchExc(
	objId: ObjId, currentVersion: number
): StorageException {
	return makeStorageException({
		objId, versionMismatch: true, currentVersion
	});
}

export function makeStorageIsClosedExc(): StorageException {
	return makeStorageException({ storageIsClosed: true });
}

Object.freeze(exports);