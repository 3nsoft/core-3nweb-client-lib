/*
 Copyright (C) 2016 - 2020 3NSoft Inc.

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

import { FileException } from '../../../lib-common/exceptions/file';
import { WeakCacheWithMinLifeTime } from '../../../lib-common/weak-cache';
import { Observable, from, MonoTypeOperatorFunction } from 'rxjs';
import { sleep, NamedProcs } from '../../../lib-common/processes';
import { ObjId } from '../../../lib-client/3nstorage/xsp-fs/common';
import { ObjFolders } from '../../../lib-client/objs-on-disk/obj-folders';
import * as fs from '../../../lib-common/async-fs-node';
import { ObjOnDisk, GetBaseSegsOnDisk, InitDownloadParts } from '../../../lib-client/objs-on-disk/obj-on-disk';
import { join } from 'path';
import { ObjSource, Subscribe } from 'xsp-files';
import { Downloader } from './downloader';
import { assert } from '../../../lib-common/assert';
import { flatMap, filter, tap } from 'rxjs/operators';
import { FileWrite } from '../../../lib-client/objs-on-disk/file-writing-proc';
import { flatTap } from '../../../lib-common/utils-for-observables';
import { GC } from './obj-files-gc';
import { ObjStatus } from './obj-status';
import { LogError } from '../../../lib-client/logging/log-to-file';

/**
 * This is an extention for an unsynced version file. File name starts with a
 * version number.
 */
export const UNSYNCED_FILE_NAME_EXT = 'unsynced';

/**
 * This is an upload info file. When an upload is complete,
 * this info file is removed.
 */
export const UPLOAD_INFO_FNAME = 'upload';

/**
 * Presence of this empty file in a object folder indicates that object's
 * removal hasn't been synchronized, yet.
 */
export const UNSYNCED_REMOVAL = 'unsynced-removal';


export class ObjFiles {

	private readonly objs =
		new WeakCacheWithMinLifeTime<ObjId, SyncedObj>(60*1000);
	private readonly sync = makeSynchronizer();
	private readonly gc = new GC(
		this.sync,
		obj => {
			if (this.objs.get(obj.objId) === obj) {
				this.objs.delete(obj.objId);
			}
		},
		objId => this.folders.removeFolderOf(objId));
	
	private constructor(
		private readonly folders: ObjFolders,
		private readonly downloader: Downloader,
		private readonly logError: LogError
	) {
		Object.freeze(this);
	}

	static async makeFor(
		path: string, downloader: Downloader, logError: LogError
	): Promise<ObjFiles> {
		const folders = await ObjFolders.makeWithGenerations(
			path,
			async (objId, objFolderPath) => {
				if (objFiles.objs.has(objId)) { return false; }
				const lst = await fs.readdir(objFolderPath);
				for (const fName of lst) {
					if (fName.endsWith(UNSYNCED_FILE_NAME_EXT)
					|| (fName === UPLOAD_INFO_FNAME)
					|| (fName === UNSYNCED_REMOVAL)) { return false; }
				}
				return true;
			},
			logError);
		const objFiles = new ObjFiles(folders, downloader, logError);
		return objFiles;
	}

	async findObj(objId: ObjId): Promise<SyncedObj|undefined> {
		let obj = this.objs.get(objId);
		if (obj) { return obj; }
		return this.sync(objId, async () => {
			const folder = await this.folders.getFolderAccessFor(objId);
			if (!folder) { return; }
			const obj = await SyncedObj.forExistingObj(
				objId, folder, this.downloader, this.gc.scheduleCollection);
			this.objs.set(objId, obj);
			return obj;
		});
	}

	private makeObj(
		objId: ObjId, download?: { version: number, parts: InitDownloadParts }
	): Promise<SyncedObj> {
		return this.sync(objId, async () => {
			const folder = await this.folders.getFolderAccessFor(objId, true);
			let obj: SyncedObj;
			if (download) {
				assert(typeof download.version === 'number');
				obj = await SyncedObj.forDownloadedObj(
					objId, folder!, this.downloader, this.gc.scheduleCollection,
					download.version, download.parts);
			} else {
				obj = await SyncedObj.forNewObj(
					objId, folder!, this.downloader, this.gc.scheduleCollection);
			}
			this.objs.set(objId, obj);
			return obj;
		});
	}

	private removeFailedNewObj(obj: SyncedObj): Promise<void> {
		return this.sync(obj.objId, async () => {
			const folder = await this.folders.getFolderAccessFor(obj.objId, false);
			if (!folder) { return; }
			this.objs.delete(obj.objId);
			await this.folders.removeFolderOf(obj.objId!);
			return;
		});
	}

	async makeByDownloadingCurrentVersion(objId: ObjId): Promise<SyncedObj> {
		// initial download implicitly checks existence of obj on server
		const download = await this.downloader.getCurrentObjVersion(objId);
		const obj = await this.makeObj(objId, download);
		return obj;
	}

	async saveFirstVersion(
		objId: ObjId, encSub: Subscribe
	): Promise<{ fileWrite$: Observable<FileWrite[]>; newObj: SyncedObj; }> {
		const newObj = await this.makeObj(objId);
		const fileWrite$ = (await newObj.saveNewVersion(1, encSub)).fileWrite$
		.pipe(
			flatTap(undefined, err => this.removeFailedNewObj(newObj))
		);
		return { fileWrite$, newObj };
	}

	collectUnsyncedObjs(): Observable<ObjId> {
		return from([undefined])
		.pipe(
			// listing recent folders, exactly once
			flatMap(() => this.folders.listRecent()),
			// flatten array and space it in time, to process folders one by one
			flatMap(objsAndPaths => objsAndPaths),
			filter(({ objId }) => !this.objs.has(objId)),
			flatMap(async objsAndPaths => {
				await sleep(20);
				return objsAndPaths;
			}, 1),
			// check, emiting objId, if not synced, and undefined, if synced
			flatMap(({ path, objId }) => this.sync(objId, async () => {
				if (this.objs.has(objId)) { return; }
				const notSynced =
					await ObjStatus.fileShowsObjNotInSyncedState(path, objId)
					.catch(notFoundOrReThrow).catch(this.logError);
				return (notSynced ? objId : undefined);
			})),
			filter(objId => (objId !== undefined)) as MonoTypeOperatorFunction<ObjId>
		);
	}

}
Object.freeze(ObjFiles.prototype);
Object.freeze(ObjFiles);

export type SynchronizerOnObjId =
	<T>(objId: ObjId, action: () => Promise<T>) => Promise<T>;

function makeSynchronizer(proc?: NamedProcs): SynchronizerOnObjId {
	if (!proc) {
		proc = new NamedProcs();
	}
	async function sync<T>(objId: ObjId, action: () => Promise<T>): Promise<T> {
		const id = (!objId ? '==root==' : objId);
		return proc!.startOrChain(id, action);
	}
	return sync;
}

/**
 * This is a catch callback, which returns undefined on file(folder) not found
 * exception, and re-throws all other exceptions/errors.
 */
function notFoundOrReThrow(exc: FileException): undefined {
	if (!exc.notFound) { throw exc; }
	return;
}


export class SyncedObj {

	/**
	 * These versions are what simple programs see. It is a local opinion about
	 * object's versions. Versions here can be either synced, or unsynced.
	 */
	private readonly verObjs =
		new WeakCacheWithMinLifeTime<number, ObjOnDisk>(60*1000);

	/**
	 * These are conflicting versions, coming from a server. Of course, universal
	 * truth is spread by server, but in situations of parallel changes, local
	 * version allows things to work, while conflicting version from server
	 * should be adopted by conflict resolution process. In other words, these
	 * versions are not for common use.
	 */
	private readonly remoteConflictVerObjs =
		new WeakCacheWithMinLifeTime<number, ObjOnDisk>(60*1000);

	private constructor(
		public readonly objId: ObjId,
		public readonly objFolder: string,
		private readonly status: ObjStatus,
		private readonly downloader: Downloader,
		private readonly scheduleGC: GC['scheduleCollection']
	) {
		Object.freeze(this);
	}

	static async forExistingObj(
		objId: ObjId, objFolder: string, downloader: Downloader,
		scheduleGC: GC['scheduleCollection'],
	): Promise<SyncedObj> {
		const status = await ObjStatus.readFrom(objFolder, objId);
		return new SyncedObj(objId, objFolder, status, downloader, scheduleGC);
	}

	static async forDownloadedObj(
		objId: ObjId, objFolder: string, downloader: Downloader,
		scheduleGC: GC['scheduleCollection'],
		version: number, parts: InitDownloadParts
	): Promise<SyncedObj> {
		const status = await ObjStatus.makeForDownloadedVersion(
			objFolder, objId, version);
		const obj = new SyncedObj(
			objId, objFolder, status, downloader, scheduleGC);
		const fPath = obj.path(version, false);
		const objVer = await ObjOnDisk.createFileForExistingVersion(
			obj.objId, version, fPath,
			obj.downloader, obj.objSegsGetterFromDisk, parts);
		obj.verObjs.set(version, objVer);
		return obj;
	}

	static async forNewObj(
		objId: ObjId, objFolder: string, downloader: Downloader,
		scheduleGC: GC['scheduleCollection']
	): Promise<SyncedObj> {
		const status = await ObjStatus.makeNew(objFolder, objId);
		return new SyncedObj(objId, objFolder, status, downloader, scheduleGC);
	}

	private path(version: number, synced: boolean): string {
		const fName = (synced ?
			`${version}.v` : `${version}.${UNSYNCED_FILE_NAME_EXT}`);
		return join(this.objFolder, fName);
	}

	async getObjSrc(version: number): Promise<ObjSource> {
		let objVer = this.verObjs.get(version);
		if (objVer) { return objVer.getSrc(); }
		const isSynced = this.status.isVersionSynced(version);
		const fPath = this.path(version, isSynced);
		if (isSynced) {
			objVer = ((await isOnDisk(fPath)) ?
				await ObjOnDisk.forExistingFile(
					this.objId, version, fPath,
					this.downloader, this.objSegsGetterFromDisk) :
				await ObjOnDisk.createFileForExistingVersion(
					this.objId, version, fPath,
					this.downloader, this.objSegsGetterFromDisk));
		} else {
			objVer = await ObjOnDisk.forExistingFile(
				this.objId, version, fPath,
				this.downloader, this.objSegsGetterFromDisk);
		}
		const src = objVer.getSrc();
		this.verObjs.set(version, objVer);
		return src;
	}

	private objSegsGetterFromDisk: GetBaseSegsOnDisk = async (ver, ofs, len) => {
		let obj = this.verObjs.get(ver);
		if (!obj) {
			const fPath = this.path(ver, this.status.isVersionSynced(ver));
			try {
				obj = await ObjOnDisk.forExistingFile(
					this.objId, ver, fPath, this.downloader,
					this.objSegsGetterFromDisk);
				this.verObjs.set(ver, obj);
			} catch (exc) {
				// when file doesn't exist on a disk, we just pass a chunk
				if (!(exc as FileException).notFound) { throw exc; }
				return [ { type: 'new', thisVerOfs: ofs, len } ];
			}
		}
		return obj.readSegsOnlyFromDisk(ofs, len);
	};

	async getRemoteConflictObjVersion(version: number):Promise<ObjSource> {
		if (this.status.syncedVersionGreaterOrEqual(version)) {
			return this.getObjSrc(version);
		}
		let obj = this.remoteConflictVerObjs.get(version);
		if (obj) { return obj.getSrc(); }
		const fPath = this.path(version, true);
		obj = ((await isOnDisk(fPath)) ?
			await ObjOnDisk.forExistingFile(
				this.objId, version, fPath, this.downloader,
				this.conflictObjSegsGetterFromDisk) :
			await ObjOnDisk.createFileForExistingVersion(
				this.objId, version, fPath, this.downloader,
				this.conflictObjSegsGetterFromDisk));
		const src = obj.getSrc();
		this.verObjs.set(version, obj);
		return src;
	}

	private conflictObjSegsGetterFromDisk: GetBaseSegsOnDisk = async (
		version, ofs, len
	) => {
		if (this.status.syncedVersionGreaterOrEqual(version)) {
			return this.objSegsGetterFromDisk(version, ofs, len);
		}
		let obj = this.remoteConflictVerObjs.get(version);
		if (!obj) {
			const fPath = this.path(version, true);
			try {
				obj = await ObjOnDisk.forExistingFile(
					this.objId, version, fPath, this.downloader,
					this.conflictObjSegsGetterFromDisk);
				this.remoteConflictVerObjs.set(version, obj);
			} catch (exc) {
				// when file doesn't exist on a disk, we just pass a chunk
				if (!(exc as FileException).notFound) { throw exc; }
				return [ { type: 'new', thisVerOfs: ofs, len } ];
			}
		}
		return obj.readSegsOnlyFromDisk(ofs, len);
	};

	async saveNewVersion(
		version: number, encSub: Subscribe
	): Promise<{ fileWrite$: Observable<FileWrite[]>; baseVer?: number; }> {
		if (this.verObjs.has(version)) { throw new Error(
			`Version ${version} already exists in object ${this.objId}`); }
		const fPath = this.path(version, false);
		const { obj, write$ } = await ObjOnDisk.createFileForWriteOfNewVersion(
			this.objId, version, fPath, encSub, this.downloader,
			this.objSegsGetterFromDisk);
		this.verObjs.set(version, obj);
		const fileWrite$ = write$.pipe(
			tap(undefined,
				err => {
					if (this.verObjs.get(version) === obj) {
						this.verObjs.delete(version);
					}
				}),
			flatTap(undefined, undefined,
				() => this.setUnsyncedCurrentVersion(version))
		);
		return { fileWrite$, baseVer: obj.getBaseVersion() };
	}

	isArchived(): boolean {
		return this.status.isArchived();
	}

	getCurrentVersionOrThrow(): number {
		return this.status.getCurrentVersionOrThrow();
	}

	isRemoteVersionGreaterOrEqualTo(newRemoteVersion: number): boolean {
		return this.status.isRemoteVersionGreaterOrEqualTo(newRemoteVersion);
	}

	isDeletedOnRemote(): boolean {
		return this.status.isDeletedOnRemote();
	}

	async setUnsyncedCurrentVersion(version: number): Promise<void> {
		await this.status.setUnsyncedCurrentVersion(version);
		this.scheduleGC(this);
	}

	async setSyncedCurrentVersion(version: number): Promise<void> {
		await this.status.setSyncedCurrentVersion(version);
		this.scheduleGC(this);
	}

	async setRemoteVersion(version: number): Promise<void> {
		await this.status.setRemoteVersion(version);
	}

	async setDeletedOnRemote(): Promise<void> {
		await this.status.setDeletedOnRemote();
	}

	async removeCurrentVersion(): Promise<void> {
		await this.status.removeCurrentVersion(this.verObjs);
		this.scheduleGC(this);
	}

}
Object.freeze(SyncedObj.prototype);
Object.freeze(SyncedObj);


async function isOnDisk(path: string): Promise<boolean> {
	return !!(await fs.stat(path)
	.catch((exc: fs.FileException) => {
		if (exc.notFound) { return; }
		throw exc;
	}));
}


Object.freeze(exports);