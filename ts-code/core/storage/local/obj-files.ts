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

import { ObjFolders } from '../../../lib-client/objs-on-disk/obj-folders';
import { ObjOnDisk, GetBaseSegsOnDisk } from '../../../lib-client/objs-on-disk/obj-on-disk';
import { LocalObjStatus, ObjId } from '../../../lib-client/3nstorage/xsp-fs/common';
import { ObjSource, Subscribe } from 'xsp-files';
import { NamedProcs } from '../../../lib-common/processes/synced';
import { join } from 'path';
import { GC } from './obj-files-gc';
import { ObjStatus } from './obj-status';
import { LogError } from '../../../lib-client/logging/log-to-file';
import { makeTimedCache } from "../../../lib-common/timed-cache";
import { lastValueFrom } from 'rxjs';


export class ObjFiles {

	private readonly objs = makeTimedCache<ObjId, LocalObj>(60*1000);
	private readonly folderAccessSyncProc = new NamedProcs();
	private readonly gc = new GC(
		obj => {
			if (this.objs.get(obj.objId) === obj) {
				this.objs.delete(obj.objId);
			}
		},
		objId => this.folders.removeFolderOf(objId));

	private constructor(
		private readonly folders: ObjFolders,
		private readonly logError: LogError
	) {
		Object.freeze(this);
	}

	static async makeFor(path: string, logError: LogError): Promise<ObjFiles> {
		const folders = await ObjFolders.makeSimple(path, logError);
		return new ObjFiles(folders, logError);
	}

	private async sync<T>(objId: ObjId, action: () => Promise<T>): Promise<T> {
		const id = (!objId ? '==root==' : objId);
		return this.folderAccessSyncProc.startOrChain(id, action);
	}

	async findObj(objId: ObjId): Promise<LocalObj|undefined> {
		let obj = this.objs.get(objId);
		if (obj) { return obj; }
		return this.sync(objId, async () => {
			const folder = await this.folders.getFolderAccessFor(objId);
			if (!folder) { return; }
			obj = await LocalObj.forExistingObj(
				objId, folder, this.gc.scheduleCollection, this.logError);
			this.objs.set(objId, obj);
			return obj;
		});
	}

	private async makeNewObj(objId: ObjId): Promise<LocalObj> {
		return this.sync(objId, async () => {
			const folder = await this.folders.getFolderAccessFor(objId, true);
			const obj = await LocalObj.forNewObj(
				objId, folder!, this.gc.scheduleCollection, this.logError);
			this.objs.set(objId, obj);
			return obj;
		});
	}

	private removeFailedNewObj(obj: LocalObj): Promise<void> {
		return this.sync(obj.objId, async () => {
			const folder = await this.folders.getFolderAccessFor(obj.objId, false);
			if (!folder) { return; }
			this.objs.delete(obj.objId);
			await this.folders.removeFolderOf(obj.objId!);
			return;
		});
	}

	async saveFirstVersion(objId: ObjId, encSub: Subscribe): Promise<void> {
		const newObj = await this.makeNewObj(objId);
		try {
			await newObj.saveNewVersion(1, encSub);
		} catch (err) {
			await this.removeFailedNewObj(newObj);
			throw err;
		}
	}

}
Object.freeze(ObjFiles.prototype);
Object.freeze(ObjFiles);


export class LocalObj {

	private readonly verObjs = makeTimedCache<number, ObjOnDisk>(60*1000);

	private constructor(
		public readonly objId: ObjId,
		public readonly objFolder: string,
		private readonly status: ObjStatus,
		private readonly scheduleGC: GC['scheduleCollection']
	) {
		Object.freeze(this);
	}

	static async forExistingObj(
		objId: ObjId, objFolder: string, scheduleGC: GC['scheduleCollection'],
		logError: LogError|undefined
	): Promise<LocalObj> {
		const status = await ObjStatus.readFrom(objFolder, objId, logError);
		return new LocalObj(objId, objFolder, status, scheduleGC);
	}

	static async forNewObj(
		objId: ObjId, objFolder: string, scheduleGC: GC['scheduleCollection'],
		logError: LogError|undefined
	): Promise<LocalObj> {
		const status = await ObjStatus.makeNew(objFolder, objId, logError);
		return new LocalObj(objId, objFolder, status, scheduleGC);
	}

	private path(version: number): string {
		return join(this.objFolder, `${version}.v`);
	}

	async getObjSrc(version: number): Promise<ObjSource> {
		let obj = this.verObjs.get(version);
		if (obj) { return obj.getSrc(); }
		const fPath = this.path(version);
		obj = await ObjOnDisk.forExistingFile(
			this.objId, version, fPath, undefined, this.objSegsGetterFromDisk);
		const src = obj.getSrc();
		this.verObjs.set(version, obj);
		return src;
	}

	private objSegsGetterFromDisk: GetBaseSegsOnDisk = async (ver, ofs, len) => {
		let obj = this.verObjs.get(ver);
		if (!obj) {
			const fPath = this.path(ver);
			obj = await ObjOnDisk.forExistingFile(
				this.objId, ver, fPath, undefined, this.objSegsGetterFromDisk);
			this.verObjs.set(ver, obj);
		}
		return obj.readSegsOnlyFromDisk(ofs, len);
	};

	async saveNewVersion(version: number, encSub: Subscribe): Promise<void> {
		if (this.verObjs.has(version)) { throw new Error(
			`Version ${version} already exists in object ${this.objId}`); }
		const fPath = this.path(version);
		const { obj, write$ } = await ObjOnDisk.createFileForWriteOfNewVersion(
			this.objId, version, fPath, encSub, undefined,
			this.objSegsGetterFromDisk
		);
		try {
			await lastValueFrom(write$);
		} catch (err) {
			if (this.verObjs.get(version) === obj) {
				this.verObjs.delete(version);
			}
			throw err;
		}
		this.verObjs.set(version, obj);
		await this.status.setNewCurrentVersion(version, obj.getBaseVersion());
		this.scheduleGC(this);
	}

	localStatus(): LocalObjStatus {
		return this.status;
	}

	statusObj(): ObjStatus {
		return this.status;
	}

	async removeCurrentVersion(): Promise<void> {
		await this.status.removeCurrentVersion(this.verObjs);
		this.scheduleGC(this);
	}

	async removeArchivedVersion(version: number): Promise<void> {
		await this.status.removeArchivedVersion(version, this.verObjs);
		this.scheduleGC(this);
	}

}
Object.freeze(LocalObj.prototype);
Object.freeze(LocalObj);


Object.freeze(exports);