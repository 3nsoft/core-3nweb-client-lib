/*
 Copyright (C) 2016 - 2020, 2022 3NSoft Inc.

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

import { FileException } from '../../../lib-common/exceptions/file';
import { Observable, from } from 'rxjs';
import { NamedProcs } from '../../../lib-common/processes/synced';
import { ObjId, SyncedObjStatus } from '../../../lib-client/3nstorage/xsp-fs/common';
import { ObjFolders, CanMoveObjToDeeperCache } from '../../../lib-client/objs-on-disk/obj-folders';
import * as fs from '../../../lib-common/async-fs-node';
import { ObjOnDisk, GetBaseSegsOnDisk, InitDownloadParts } from '../../../lib-client/objs-on-disk/obj-on-disk';
import { join } from 'path';
import { ObjSource, Subscribe } from 'xsp-files';
import { Downloader } from './downloader';
import { assert } from '../../../lib-common/assert';
import { mergeMap, filter, tap } from 'rxjs/operators';
import { FileWrite } from '../../../lib-client/objs-on-disk/file-writing-proc';
import { flatTap } from '../../../lib-common/utils-for-observables';
import { GC } from './obj-files-gc';
import { ObjStatus } from './obj-status';
import { LogError } from '../../../lib-client/logging/log-to-file';
import { makeTimedCache } from "../../../lib-common/timed-cache";
import { DiffInfo } from '../../../lib-common/service-api/3nstorage/owner';
import { FiniteChunk } from '../../../lib-common/objs-on-disk/file-layout';
import { StorageOwner as RemoteStorage } from '../../../lib-client/3nstorage/service';
import { UploadHeaderChange } from '../../../lib-client/3nstorage/xsp-fs/common';
import { saveUploadHeaderFile } from './upload-header-file';
import { noop } from '../common/utils';

export const UNSYNCED_FILE_NAME_EXT = 'unsynced';
export const REMOTE_FILE_NAME_EXT = 'v';


/**
 * File system has nodes. Each node may have data in one or many objects of
 * storage. SyncedObj allows to work with files of storage object, even when
 * file system node no longer exists. ObjFiles is a holder and factory of
 * SyncedObj's.
 */
export class ObjFiles {

	private readonly objs = makeTimedCache<ObjId, SyncedObj>(60*1000);
	private readonly sync = makeSynchronizer();
	private readonly downloader: Downloader;
	private readonly gc: GC;
	
	private constructor(
		private readonly folders: ObjFolders,
		remote: RemoteStorage,
		private readonly logError: LogError
	) {
		this.downloader = new Downloader(remote);
		this.gc = new GC(
			this.sync,
			obj => {
				if (this.objs.get(obj.objId) === obj) {
					this.objs.delete(obj.objId);
				}
			},
			objId => this.folders.removeFolderOf(objId)
		);
		Object.freeze(this);
	}

	static async makeFor(
		path: string, remote: RemoteStorage, logError: LogError
	): Promise<ObjFiles> {
		const canMove: CanMoveObjToDeeperCache = (
			objId, objFolderPath
		) => objFiles.canMoveObjToDeeperCache(objId, objFolderPath);
		const folders = await ObjFolders.makeWithGenerations(
			path, canMove, logError
		);
		const objFiles = new ObjFiles(folders, remote, logError);
		return objFiles;
	}

	private async canMoveObjToDeeperCache(
		objId: string, objFolderPath: string
	): Promise<boolean> {
		if (this.objs.has(objId)) { return false; }
		const lst = await fs.readdir(objFolderPath);
		for (const fName of lst) {
			if (fName.endsWith(UNSYNCED_FILE_NAME_EXT)) { return false; }
		}
		try {
			return (await ObjStatus.fileShowsObjNotInSyncedState(
				objFolderPath, objId
			));
		} catch (exc) {
			return false;
		}
	}

	async findObj(objId: ObjId): Promise<SyncedObj|undefined> {
		let obj = this.objs.get(objId);
		if (obj) { return obj; }
		return this.sync(objId, async () => {
			const folder = await this.folders.getFolderAccessFor(objId);
			if (!folder) { return; }
			const obj = await SyncedObj.forExistingObj(
				objId, folder, this.downloader, this.gc.scheduleCollection,
				this.logError);
			this.objs.set(objId, obj);
			return obj;
		});
	}

	getObjInCache(objId: ObjId): SyncedObj|undefined {
		return this.objs.get(objId);
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
					download.version, download.parts, this.logError);
			} else {
				obj = await SyncedObj.forNewObj(
					objId, folder!, this.downloader, this.gc.scheduleCollection,
					this.logError);
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

	// XXX we'll need getting archived version.
	//     Getting current may be changed to grub info about all obj versions.
	//     As currently this.makeByDownloadingCurrentVersion() makes assumptions.
	//     Should it be a pattern: version not in status -> get info first.

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

	findObjsToRemoveOnRemote(): Observable<ObjId> {
		return from([undefined])
		.pipe(
			// listing recent folders, exactly once
			mergeMap(() => this.folders.listRecent()),
			// flatten array and space it in time, to process folders one by one
			mergeMap(objsAndPaths => objsAndPaths),
			mergeMap(async ({ objId, path }) => {
				const obj = this.objs.get(objId);
				if (obj) {
					return (obj.statusObj().needsRemovalOnRemote() ?
						objId : undefined);
				} else {
					const needsRm = await ObjStatus.fileShowsObjNeedsRemovalOnRemote(
						path, objId);
					return (needsRm ? objId : undefined);
				}
			}, 1),
			filter<ObjId>(objId => (objId !== undefined))
		);
	}

	scheduleGC(obj: SyncedObj): void {
		this.gc.scheduleCollection(obj);
	}

}
Object.freeze(ObjFiles.prototype);
Object.freeze(ObjFiles);


export type SynchronizerOnObjId = <T> (
	objId: ObjId, action: () => Promise<T>
) => Promise<T>;

function makeSynchronizer(proc?: NamedProcs): SynchronizerOnObjId {
	if (!proc) {
		proc = new NamedProcs();
	}
	async function sync<T>(objId: ObjId, action: () => Promise<T>): Promise<T> {
		const id = (objId ? objId : '==root==');
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

	private readonly remoteVers = makeTimedCache<number, ObjOnDisk>(60*1000);
	private readonly localVers = makeTimedCache<number, ObjOnDisk>(60*1000);

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
		scheduleGC: GC['scheduleCollection'], logError: LogError
	): Promise<SyncedObj> {
		const status = await ObjStatus.readFrom(objFolder, objId, logError);
		return new SyncedObj(objId, objFolder, status, downloader, scheduleGC);
	}

	static async forDownloadedObj(
		objId: ObjId, objFolder: string, downloader: Downloader,
		scheduleGC: GC['scheduleCollection'],
		version: number, parts: InitDownloadParts, logError: LogError
	): Promise<SyncedObj> {
		// XXX let's note that given version is also passed as current on server
		const status = await ObjStatus.makeForDownloadedVersion(
			objFolder, objId, version, version, logError);
		const obj = new SyncedObj(
			objId, objFolder, status, downloader, scheduleGC);
		const fPath = obj.remoteVerPath(version);
		const objVer = await ObjOnDisk.createFileForExistingVersion(
			obj.objId, version, fPath,
			obj.downloader, obj.remoteObjSegsGetterFromDisk, parts);
		obj.remoteVers.set(version, objVer);
		return obj;
	}

	static async forNewObj(
		objId: ObjId, objFolder: string, downloader: Downloader,
		scheduleGC: GC['scheduleCollection'], logError: LogError
	): Promise<SyncedObj> {
		const status = await ObjStatus.makeNew(objFolder, objId, logError);
		return new SyncedObj(objId, objFolder, status, downloader, scheduleGC);
	}

	scheduleSelfGC(): void {
		this.scheduleGC(this);
	}

	private localVerPath(version: number): string {
		return join(this.objFolder, `${version}.${UNSYNCED_FILE_NAME_EXT}`);
	}

	private remoteVerPath(version: number): string {
		return join(this.objFolder, `${version}.${REMOTE_FILE_NAME_EXT}`);
	}

	async getObjSrcFromLocalAndSyncedBranch(
		version: number
	): Promise<ObjSource> {
		const latestSynced = this.status.latestSyncedVersion();
		const objVer = await ((latestSynced && (latestSynced >= version)) ?
			this.instanceOfRemoteObjVer(version) :
			this.instanceOfLocalObjVer(version)
		);
		return objVer.getSrc();
	}

	async getObjSrcFromRemoteAndSyncedBranch(
		version: number
	): Promise<ObjSource> {
		const objVer = await this.instanceOfRemoteObjVer(version);
		return objVer.getSrc();
	}

	private async instanceOfLocalObjVer(
		version: number
	): Promise<ObjOnDisk> {
		let objVer = this.localVers.get(version);
		if (objVer) { return objVer; }
		const fPath = this.localVerPath(version);
		objVer = await ObjOnDisk.forExistingFile(
			this.objId, version, fPath,
			this.downloader, this.localAndSyncedObjSegsGetterFromDisk);
		this.localVers.set(version, objVer);
		return objVer;
	}

	private async instanceOfRemoteObjVer(version: number): Promise<ObjOnDisk> {
		let objVer = this.remoteVers.get(version);
		if (objVer) { return objVer; }
		const fPath = this.remoteVerPath(version);
		objVer = ((await isOnDisk(fPath)) ?
			await ObjOnDisk.forExistingFile(
				this.objId, version, fPath,
				this.downloader, this.remoteObjSegsGetterFromDisk) :
			await ObjOnDisk.createFileForExistingVersion(
				this.objId, version, fPath,
				this.downloader, this.remoteObjSegsGetterFromDisk));
			this.remoteVers.set(version, objVer);
		return objVer;
	}

	private readonly localAndSyncedObjSegsGetterFromDisk: GetBaseSegsOnDisk =
	async (v, ofs, len) => {
		const latestSynced = this.status.latestSyncedVersion();
		if (latestSynced && (latestSynced >= v)) {
			return this.remoteObjSegsGetterFromDisk(v, ofs, len);
		}
		let objVer = this.localVers.get(v);
		if (!objVer) {
			objVer = await ObjOnDisk.forExistingFile(
				this.objId, v, this.localVerPath(v), this.downloader,
				this.localAndSyncedObjSegsGetterFromDisk);
			this.localVers.set(v, objVer);
		}
		return objVer.readSegsOnlyFromDisk(ofs, len);
	};

	private readonly remoteObjSegsGetterFromDisk: GetBaseSegsOnDisk =
	async (v, ofs, len) => {
		let objVer = this.remoteVers.get(v);
		if (!objVer) {
			try {
				objVer = await ObjOnDisk.forExistingFile(
					this.objId, v, this.remoteVerPath(v), this.downloader,
					this.remoteObjSegsGetterFromDisk);
				this.remoteVers.set(v, objVer);
			} catch (exc) {
				// when file doesn't exist on a disk, we just pass a chunk
				if (!(exc as FileException).notFound) { throw exc; }
				return [ { type: 'new', thisVerOfs: ofs, len } ];
			}
		}
		return objVer.readSegsOnlyFromDisk(ofs, len);
	};

	async saveNewVersion(
		version: number, encSub: Subscribe
	): Promise<{ fileWrite$: Observable<FileWrite[]>; baseVer?: number; }> {
		if (this.localVers.has(version)) { throw new Error(
			`Version ${version} already exists in object ${this.objId}`); }
		const fPath = this.localVerPath(version);
		const { obj, write$ } = await ObjOnDisk.createFileForWriteOfNewVersion(
			this.objId, version, fPath, encSub, this.downloader,
			this.localAndSyncedObjSegsGetterFromDisk);
		this.localVers.set(version, obj);
		const fileWrite$ = write$.pipe(
			tap({
				error: err => {
					if (this.localVers.get(version) === obj) {
						this.localVers.delete(version);
					}
				}
			}),
			flatTap(undefined, undefined,
				() => this.setUnsyncedCurrentVersion(version, obj.getBaseVersion()))
		);
		return { fileWrite$, baseVer: obj.getBaseVersion() };
	}

	async combineLocalBaseIfPresent(version: number): Promise<number|undefined> {
		const bases = this.status.baseOfLocalVersion(version);
		if (!bases) { return; }
		const { localBases, syncedBase } = bases;
		if (localBases) {
			const objVer = await this.instanceOfLocalObjVer(version);
			for (const localBase of localBases) {
				await objVer.absorbImmediateBaseVersion(
					localBase, this.localVerPath(localBase));
				this.status.absorbLocalVersionBase(version, localBase);
			}
		}
		return syncedBase;
	}

	async saveUploadHeaderFile(uploadHeader: UploadHeaderChange): Promise<void> {
		await saveUploadHeaderFile(this.objFolder, uploadHeader);
	}

	private async setUnsyncedCurrentVersion(
		version: number, baseVersion: number|undefined
	): Promise<void> {
		await this.status.setLocalCurrentVersion(version, baseVersion);
		if (version > 1) {
			this.scheduleSelfGC();
		}
	}

	/**
	 * This renames/moves version file from local to remote.
	 * Removes upload info from status, updating enumerations of local and
	 * synced versions.
	 */
	async recordUploadCompletion(
		localVersion: number, uploadVersion: number,
		headerChange: {
			newHeader: Uint8Array; originalHeader: Uint8Array;
		}|undefined
	): Promise<void> {
		const verObj = this.localVers.get(localVersion);
		const remotePath = this.remoteVerPath(uploadVersion);
		if (verObj) {
			const syncedVerObj = await verObj.moveFileAndProxyThis(
				remotePath,
				(headerChange ? {
					newHeader: headerChange.newHeader,
					originalHeader: headerChange.originalHeader,
					version: uploadVersion
				} : undefined)
			);
			this.remoteVers.set(uploadVersion, syncedVerObj);
		} else {
			await fs.rename(
				this.localVerPath(localVersion), remotePath);
		}
		await this.status.recordUploadCompletion(localVersion, uploadVersion);
		this.scheduleSelfGC();
	}

	dropCachedLocalObjVersionsLessOrEqual(version: number): void {
		for (const version of this.localVers.keys()) {
			if (version <= version) {
				this.localVers.delete(version);
			}
		}
	}

	async removeLocalVersionFilesLessThan(version: number): Promise<void> {
		const lst = await fs.readdir(this.objFolder).catch(noop);
		if (!lst) { return; }
		const rmProcs: Promise<void>[] = [];
		for (const f of lst) {
			if (!f.endsWith(UNSYNCED_FILE_NAME_EXT)) { continue; }
			const verStr = f.slice(0, f.length-1-UNSYNCED_FILE_NAME_EXT.length);
			const ver = parseInt(verStr);
			if (isNaN(ver) || (ver > version)) { continue; }
			rmProcs.push(fs.unlink(join(this.objFolder, f)).catch(noop));
		}
		if (rmProcs.length > 0) {
			await Promise.all(rmProcs);
		}
	}

	async removeCurrentVersion(): Promise<void> {
		await this.status.removeCurrentVersion();
		// note that gc is tasked with removing current obj version on server
		this.scheduleSelfGC();
	}

	async diffForUploadOf(
		version: number
	): Promise<{ diff: DiffInfo; newSegsPackOrder: FiniteChunk[]; }> {
		const objVer = await this.instanceOfLocalObjVer(version);
		if (objVer.getBaseVersion()) {
			return objVer.diffFromBase();
		} else {
			throw new Error(`Version ${version} is not a diff version`);
		}
	}

	syncStatus(): SyncedObjStatus {
		return this.status;
	}

	statusObj(): ObjStatus {
		return this.status;
	}

	async recordRemovalUploadAndGC(): Promise<void> {
		await this.status.recordRemoteRemovalCompletion();
		this.scheduleSelfGC();
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