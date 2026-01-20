/*
 Copyright (C) 2015 - 2016, 2019, 2022, 2026 3NSoft Inc.
 
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

import { getStackHere } from "../../lib-common/exceptions/runtime";
import { ObjId } from "./common";

type FSSyncException = web3n.files.FSSyncException;

export interface StorageException extends web3n.RuntimeException {
	type: 'storage';
	remoteStorage?: true;
	objId?: ObjId;
	version?: number;
	objNotFound?: true;
	objVersionNotFound?: true;
	objExists?: true;
	concurrentTransaction?: true;
	unknownTransaction?: true;
	versionMismatch?: true;
	currentVersion?: number;
	storageIsClosed?: true;
}

export interface StorageExceptionFlags {
	remoteStorage?: true;
	objNotFound?: true;
	objVersionNotFound?: true;
	objExists?: true;
	concurrentTransaction?: true;
	unknownTransaction?: true;
	versionMismatch?: true;
	storageIsClosed?: true;
}

export function makeStorageException(fields: Partial<StorageException>): StorageException {
	const exc: StorageException = {
		runtimeException: true,
		type: 'storage',
		stack: getStackHere(1)
	};
	for (const [ key, value ] of Object.entries(fields)) {
		exc[key] = value;
	}
	return exc;
}

export function makeObjNotFoundExc(objId: ObjId, remoteStorage?: true): StorageException {
	return makeStorageException({
		objId, objNotFound: true, remoteStorage
	});
}

export function makeObjVersionNotFoundExc(objId: ObjId, version: number, remoteStorage?: true): StorageException {
	return makeStorageException({
		objId, version, objVersionNotFound: true, remoteStorage
	});
}

export function makeObjExistsExc(objId: ObjId, version?: number, remoteStorage?: true): StorageException {
	return makeStorageException({
		objId, version, objExists: true, remoteStorage
	});
}

export function makeConcurrentTransExc(objId: ObjId): StorageException {
	return makeStorageException({
		objId, concurrentTransaction: true, remoteStorage: true
	});
}

export function makeUnknownTransactionExc(objId: ObjId): StorageException {
	return makeStorageException({
		objId, unknownTransaction: true, remoteStorage: true
	});
}

export function makeVersionMismatchExc(objId: ObjId, currentVersion: number): StorageException {
	return makeStorageException({
		objId, versionMismatch: true, currentVersion, remoteStorage: true
	});
}

export function makeStorageIsClosedExc(): StorageException {
	return makeStorageException({ storageIsClosed: true });
}

export function makeFSSyncException(path: string, fields: Partial<FSSyncException>): FSSyncException {
	const exc: FSSyncException = {
		runtimeException: true,
		type: 'fs-sync',
		path,
		stack: getStackHere(1)
	};
	for (const [ key, value ] of Object.entries(fields)) {
		exc[key] = value;
	}
	return exc;
}


Object.freeze(exports);