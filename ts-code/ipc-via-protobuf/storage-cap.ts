/*
 Copyright (C) 2020 - 2022 3NSoft Inc.
 
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

import { Value, valOfOpt, toOptVal } from './protobuf-msg';
import { ExposedObj, ExposedFn, Caller, ExposedServices } from './connector';
import { exposeFSService, fsMsgType, makeFSCaller, fsItem } from './fs';
import { ProtoType } from '../lib-client/protobuf-type';
import { storage as pb } from '../protos/storage.proto';

type Storage = web3n.storage.Service;
type StorageType = web3n.storage.StorageType;
type WritableFS = web3n.files.WritableFS;

export function exposeStorageCAP(
	cap: Storage, expServices: ExposedServices
): ExposedObj<Storage> {
	const wrap: ExposedObj<Storage> = {
		getAppLocalFS: getAppLocalFS.wrapService(cap.getAppLocalFS, expServices),
		getAppSyncedFS: getAppSyncedFS.wrapService(
			cap.getAppSyncedFS, expServices)
	};
	if (cap.getSysFS) {
		wrap.getSysFS = getSysFS.wrapService(cap.getSysFS, expServices);
	}
	if (cap.getUserFS) {
		wrap.getUserFS = getUserFS.wrapService(cap.getUserFS, expServices);
	}
	return wrap;
}

export function makeStorageCaller(caller: Caller, objPath: string[]): Storage {
	const lstStorageCAP = caller.listObj(objPath) as (keyof Storage)[];
	const sysFS = lstStorageCAP.includes('getSysFS');
	const userFS = lstStorageCAP.includes('getUserFS');
	const storage: Storage = {
		getAppLocalFS: getAppLocalFS.makeCaller(caller, objPath),
		getAppSyncedFS: getAppSyncedFS.makeCaller(caller, objPath)
	};
	if (sysFS) {
		storage.getSysFS = getSysFS.makeCaller(caller, objPath);
	}
	if (userFS) {
		storage.getUserFS = getUserFS.makeCaller(caller, objPath);
	}
	return storage;
}


namespace getAppLocalFS {

	interface Request {
		appName?: Value<string>;
	}

	const requestType = ProtoType.for<Request>(pb.GetAppLocalFSRequestBody);

	export function wrapService(
		fn: Storage['getAppLocalFS'], expServices: ExposedServices
	): ExposedFn {
		return buf => {
			const { appName } = requestType.unpack(buf);
			const promise = fn(valOfOpt(appName))
			.then(fs => {
				const fsMsg = exposeFSService(fs, expServices);
				return fsMsgType.pack(fsMsg);
			});
			return { promise };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): Storage['getAppLocalFS'] {
		const path = objPath.concat('getAppLocalFS');
		return appName => caller
		.startPromiseCall(path, requestType.pack({ appName: toOptVal(appName) }))
		.then(buf => {
			const fsMsg = fsMsgType.unpack(buf);
			return makeFSCaller(caller, fsMsg) as WritableFS;
		});
	}

}
Object.freeze(getAppLocalFS);


namespace getAppSyncedFS {

	interface Request {
		appName?: Value<string>;
	}

	const requestType = ProtoType.for<Request>(pb.GetAppSyncedFSRequestBody);

	export function wrapService(
		fn: Storage['getAppSyncedFS'], expServices: ExposedServices
	): ExposedFn {
		return buf => {
			const { appName } = requestType.unpack(buf);
			const promise = fn(valOfOpt(appName))
			.then(fs => {
				const fsMsg = exposeFSService(fs, expServices);
				return fsMsgType.pack(fsMsg);
			});
			return { promise };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): Storage['getAppSyncedFS'] {
		const path = objPath.concat('getAppSyncedFS');
		return appName => caller
		.startPromiseCall(path, requestType.pack({ appName: toOptVal(appName) }))
		.then(buf => {
			const fsMsg = fsMsgType.unpack(buf);
			return makeFSCaller(caller, fsMsg) as WritableFS;
		});
	}

}
Object.freeze(getAppSyncedFS);


namespace getSysFS {

	interface Request {
		type: StorageType;
		path?: Value<string>;
	}

	const requestType = ProtoType.for<Request>(pb.GetSysFSRequestBody);

	export function wrapService(
		fn: NonNullable<Storage['getSysFS']>, expServices: ExposedServices
	): ExposedFn {
		return buf => {
			const { type, path } = requestType.unpack(buf);
			const promise = fn(type, valOfOpt(path))
			.then(item => {
				const msg = fsItem.exposeFSItem(expServices, item);
				return fsItem.msgType.pack(msg);
			});
			return { promise };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): Storage['getSysFS'] {
		const ipcPath = objPath.concat('getSysFS');
		return (type, path) => caller
		.startPromiseCall(ipcPath, requestType.pack({
			type, path: toOptVal(path)
		}))
		.then(buf => {
			const msg = fsItem.msgType.unpack(buf);
			return fsItem.fsItemFromMsg(caller, msg);
		});
	}

}
Object.freeze(getSysFS);


namespace getUserFS {

	interface Request {
		type: StorageType;
		path?: Value<string>;
	}

	const requestType = ProtoType.for<Request>(pb.GetUserFSRequestBody);

	export function wrapService(
		fn: NonNullable<Storage['getUserFS']>, expServices: ExposedServices
	): ExposedFn {
		return buf => {
			const { type, path } = requestType.unpack(buf);
			const promise = fn(type, valOfOpt(path))
			.then(item => {
				const msg = fsItem.exposeFSItem(expServices, item);
				return fsItem.msgType.pack(msg);
			});
			return { promise };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): Storage['getUserFS'] {
		const ipcPath = objPath.concat('getUserFS');
		return (type, path) => caller
		.startPromiseCall(ipcPath, requestType.pack({
			type, path: toOptVal(path)
		}))
		.then(buf => {
			const msg = fsItem.msgType.unpack(buf);
			return fsItem.fsItemFromMsg(caller, msg);
		});
	}

}
Object.freeze(getUserFS);


Object.freeze(exports);