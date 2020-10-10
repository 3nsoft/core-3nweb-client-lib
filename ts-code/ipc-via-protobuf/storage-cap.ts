/*
 Copyright (C) 2020 3NSoft Inc.
 
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

import { ProtoType, Value, valOfOpt, toOptVal } from './protobuf-msg';
import { ExposedObj, ExposedFn, ObjectsConnector } from './connector';
import { join, resolve } from 'path';
import { exposeFSService, fsMsgType, makeFSCaller, fsItem } from './fs';

type Storage = web3n.storage.Service;
type StorageType = web3n.storage.StorageType;
type WritableFS = web3n.files.WritableFS;

export function exposeStorageCAP(
	cap: Storage, connector: ObjectsConnector
): ExposedObj<Storage> {
	const wrap: ExposedObj<Storage> = {
		getAppLocalFS: getAppLocalFS.wrapService(cap.getAppLocalFS, connector),
		getAppSyncedFS: getAppSyncedFS.wrapService(cap.getAppSyncedFS, connector)
	};
	if (cap.getSysFS) {
		wrap.getSysFS = getSysFS.wrapService(cap.getSysFS, connector);
	}
	if (cap.getUserFS) {
		wrap.getUserFS = getUserFS.wrapService(cap.getUserFS, connector);
	}
	return wrap;
}

export function makeStorageCaller(
	connector: ObjectsConnector, objPath: string[],
	sysFS: boolean, userFS: boolean
): Storage {
	const storage: Storage = {
		getAppLocalFS: getAppLocalFS.makeCaller(connector, objPath),
		getAppSyncedFS: getAppSyncedFS.makeCaller(connector, objPath)
	};
	if (sysFS) {
		storage.getSysFS = getSysFS.makeCaller(connector, objPath);
	}
	if (userFS) {
		storage.getUserFS = getUserFS.makeCaller(connector, objPath);
	}
	return storage;
}

function storageType<T extends object>(type: string): ProtoType<T> {
	return ProtoType.makeFrom<T>('storage.proto', `storage.${type}`);
}


namespace getAppLocalFS {

	interface Request {
		appName: string;
	}

	const requestType = storageType<Request>('GetAppLocalFSRequestBody');

	export function wrapService(
		fn: Storage['getAppLocalFS'], connector: ObjectsConnector
	): ExposedFn {
		return buf => {
			const { appName } = requestType.unpack(buf);
			const promise = fn(appName)
			.then(fs => {
				const fsMsg = exposeFSService(fs, connector);
				return fsMsgType.pack(fsMsg);
			});
			return { promise };
		};
	}

	export function makeCaller(
		connector: ObjectsConnector, objPath: string[]
	): Storage['getAppLocalFS'] {
		const path = objPath.concat('getAppLocalFS');
		return appName => connector
		.startPromiseCall(path, requestType.pack({ appName }))
		.then(buf => {
			const fsMsg = fsMsgType.unpack(buf);
			return makeFSCaller(connector, fsMsg) as WritableFS;
		});
	}

}
Object.freeze(getAppLocalFS);


namespace getAppSyncedFS {

	interface Request {
		appName: string;
	}

	const requestType = storageType<Request>('GetAppSyncedFSRequestBody');

	export function wrapService(
		fn: Storage['getAppSyncedFS'], connector: ObjectsConnector
	): ExposedFn {
		return buf => {
			const { appName } = requestType.unpack(buf);
			const promise = fn(appName)
			.then(fs => {
				const fsMsg = exposeFSService(fs, connector);
				return fsMsgType.pack(fsMsg);
			});
			return { promise };
		};
	}

	export function makeCaller(
		connector: ObjectsConnector, objPath: string[]
	): Storage['getAppSyncedFS'] {
		const path = objPath.concat('getAppSyncedFS');
		return appName => connector
		.startPromiseCall(path, requestType.pack({ appName }))
		.then(buf => {
			const fsMsg = fsMsgType.unpack(buf);
			return makeFSCaller(connector, fsMsg) as WritableFS;
		});
	}

}
Object.freeze(getAppSyncedFS);


namespace getSysFS {

	interface Request {
		type: StorageType;
		path?: Value<string>;
	}

	const requestType = storageType<Request>('GetSysFSRequestBody');

	export function wrapService(
		fn: NonNullable<Storage['getSysFS']>, connector: ObjectsConnector
	): ExposedFn {
		return buf => {
			const { type, path } = requestType.unpack(buf);
			const promise = fn(type, valOfOpt(path))
			.then(item => {
				const msg = fsItem.exposeFSItem(connector, item);
				return fsItem.msgType.pack(msg);
			});
			return { promise };
		};
	}

	export function makeCaller(
		connector: ObjectsConnector, objPath: string[]
	): Storage['getSysFS'] {
		const ipcPath = objPath.concat('getSysFS');
		return (type, path) => connector
		.startPromiseCall(ipcPath, requestType.pack({
			type, path: toOptVal(path)
		}))
		.then(buf => {
			const msg = fsItem.msgType.unpack(buf);
			return fsItem.fsItemFromMsg(connector, msg);
		});
	}

}
Object.freeze(getSysFS);


namespace getUserFS {

	interface Request {
		type: StorageType;
		path?: Value<string>;
	}

	const requestType = storageType<Request>('GetUserFSRequestBody');

	export function wrapService(
		fn: NonNullable<Storage['getUserFS']>, connector: ObjectsConnector
	): ExposedFn {
		return buf => {
			const { type, path } = requestType.unpack(buf);
			const promise = fn(type, valOfOpt(path))
			.then(item => {
				const msg = fsItem.exposeFSItem(connector, item);
				return fsItem.msgType.pack(msg);
			});
			return { promise };
		};
	}

	export function makeCaller(
		connector: ObjectsConnector, objPath: string[]
	): Storage['getUserFS'] {
		const ipcPath = objPath.concat('getUserFS');
		return (type, path) => connector
		.startPromiseCall(ipcPath, requestType.pack({
			type, path: toOptVal(path)
		}))
		.then(buf => {
			const msg = fsItem.msgType.unpack(buf);
			return fsItem.fsItemFromMsg(connector, msg);
		});
	}

}
Object.freeze(getUserFS);


Object.freeze(exports);