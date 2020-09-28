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

import { SingleProc, DeduppedRunner } from '../../../lib-common/processes';
import { ObjId } from '../../../lib-client/3nstorage/xsp-fs/common';
import * as fs from '../../../lib-common/async-fs-node';
import { join } from 'path';
import { makeStorageException } from '../../../lib-client/3nstorage/exceptions';
import { readJSONInfoFileIn } from '../common/obj-info-file';

/**
 * Storage object can be in following states:
 * 1. Synced state indicates that current local version and one on the server
 *    are same.
 * 2. Behind state indicates that while current local version is synced,
 *    server already has a newer version.
 * 3. Unsynced state indicates that current local version hasn't been uploaded
 *    to the server. Current is just the next version, following the server one.
 * 4. Conflicting state indicates that current unsynced local version conflicts
 *    with version on the server, uploaded by other client.
 */
export type SyncState = 'synced' | 'behind' | 'unsynced' | 'conflicting';

export interface ObjStatusInfo {
	objId: ObjId;
	isArchived?: boolean;
	deletedOnRemote?: boolean;
	syncState: SyncState;

	versions: {
		latestSynced?: number;
		conflictingRemote?: number[];
		current?: number;
		archived?: number[];
		unsynchedArchived?: number[];
		remote?: number;
	};

	// XXX local storage doesn't have. Should it exist?
	// May be it should be a file? Like there are files for uploads state.
	// If we need info cached, we may add it to SyncedObj.
	gcWorkInfo?: object;

	// XXX should we have the following, like in local storage?
	// baseToDiff: { [baseVersion: number]: number[]; };
	// diffToBase: { [diffVersion: number]: number; };
}

const STATUS_FILE_NAME = 'status';


export class ObjStatus {

	private readonly saveProc = new DeduppedRunner(() => this.saveFile());

	private constructor (
		private readonly objFolder: string,
		private readonly status: ObjStatusInfo,
	) {
		Object.freeze(this);
	}

	static async readFrom(objFolder: string, objId: ObjId): Promise<ObjStatus> {
		const status = await readAndCheckStatus(objFolder, objId);
		return new ObjStatus(objFolder, status);
	}

	static async makeNew(objFolder: string, objId: ObjId): Promise<ObjStatus> {
		const status: ObjStatusInfo = {
			objId,
			syncState: 'unsynced',
			versions: {}
		};
		const s = new ObjStatus(objFolder, status);
		await s.saveProc.trigger();
		return s;
	}

	static async makeForDownloadedVersion(
		objFolder: string, objId: ObjId, version: number
	): Promise<ObjStatus> {
		const status: ObjStatusInfo = {
			objId,
			syncState: 'synced',
			versions: {
				current: version
			}
		};
		const s = new ObjStatus(objFolder, status);
		await s.saveProc.trigger();
		return s;
	}

	static async fileShowsObjNotInSyncedState(
		objFolder: string, objId: ObjId
	): Promise<boolean> {
		const status = await readAndCheckStatus(objFolder, objId);
		return (status.syncState !== 'synced');
	}

	private async saveFile(): Promise<void> {
		await fs.writeFile(
			join(this.objFolder, STATUS_FILE_NAME),
			JSON.stringify(this.status),
			{ encoding: 'utf8' });
	}

	isArchived(): boolean {
		return !!this.status.isArchived;
	}

	getCurrentVersionOrThrow(): number {
		if (typeof this.status.versions.current !== 'number') { throw new Error(
			`Object ${this.status.objId} has no current version.`); }
		return this.status.versions.current;
	}

	isRemoteVersionGreaterOrEqualTo(newRemoteVersion: number): boolean {
		return ((typeof this.status.versions.remote === 'number') ?
			(this.status.versions.remote >= newRemoteVersion) : false);
	}

	isDeletedOnRemote(): boolean {
		return !!this.status.deletedOnRemote;
	}

	syncedVersionGreaterOrEqual(version: number): boolean {
		return ((typeof this.status.versions.latestSynced !== 'number') ?
			false : (version <= this.status.versions.latestSynced));
	}

	async removeCurrentVersion(
		verObjs: ContainerWithDelete<number>
	): Promise<void> {
		this.status.isArchived = true;
		if (this.status.versions.current) {
			verObjs.delete(this.status.versions.current);
			rmNonArchVersionsIn(this.status, this.status.versions.current);
			delete this.status.versions.current;
		}
		await this.saveProc.trigger();
	}

	async setDeletedOnRemote(): Promise<void> {
		this.status.deletedOnRemote = true;
		await this.saveProc.trigger();
	}

	async setRemoteVersion(version: number): Promise<void> {
		if (this.status.versions.remote! >= version) { return; }
		this.status.versions.remote = version;
		if (this.status.syncState === 'synced') {
			if (this.status.versions.current! < this.status.versions.remote) {
				this.status.syncState = 'behind';
			}
		} else if (this.status.syncState === 'unsynced') {
			this.status.syncState = 'conflicting';
		}
		await this.saveProc.trigger();
	}

	async setSyncedCurrentVersion(version: number): Promise<void> {
		this.status.versions.current = version;
		this.status.syncState = 'synced';
		this.status.versions.latestSynced = version;
		await this.saveProc.trigger();
	}

	async setUnsyncedCurrentVersion(version: number): Promise<void> {

		// XXX should this code be like that from commented
		// setNewCurrentVersionAfterWriteIn, or should we use that function
		// reused by GC.

		this.status.versions.current = version;
		this.status.syncState = 'unsynced';
		await this.saveProc.trigger();
	}

	/**
	 * This method ignores remote conflicting versions.
	 * @param version 
	 */
	isVersionSynced(version: number): boolean {
		if (this.status.versions.current === undefined) { return false; }
		if (this.status.syncState == 'synced') { return true; }
		if (this.status.versions.latestSynced === undefined) { return false; }
		return (this.status.versions.latestSynced >= version);
	}

}
Object.freeze(ObjStatus.prototype);
Object.freeze(ObjStatus);


interface ContainerWithDelete<T> {
	delete(key: T): void;
}

async function readAndCheckStatus(
	objFolder: string, objId: ObjId
): Promise<ObjStatusInfo> {
	const status = await readJSONInfoFileIn<ObjStatusInfo>(
		objFolder, STATUS_FILE_NAME);
	if (!status) {
		throw makeStorageException({
			message: `Obj status file is not found in obj folder ${objFolder}`
		});
	}

	// XXX we may do some checks and sanitization here

	if (objId !== status.objId) {
		throw makeStorageException({ message: `Invalid objId in status file for obj ${objId}, in folder ${objFolder}.\nInvalid content:\n${JSON.stringify(status, null, 2)}` });
	}

	return status;
}

function rmNonArchVersionsIn(status: ObjStatusInfo, ver: number): void {

	// XXX this is an analog of a function in local storage obj-files
	//     Should code be structured the same way?

	if (!status.versions.archived
	|| !status.versions.archived.includes(ver)) { return; }

	// XXX code below is from local
	//
	// if (status.baseToDiff[ver]) { return; }
	// const base = status.diffToBase[ver];
	// if (typeof base !== 'number') { return; }
	// delete status.diffToBase[ver];
	// const diffs = status.baseToDiff[base];
	// if (!diffs) { return; }
	// const diffInd = diffs.indexOf(ver);
	// if (diffInd < 0) { return; }
	// diffs.splice(diffInd, 1);
	// if (diffs.length === 0) {
	// 	delete status.baseToDiff[base];
	// 	rmNonArchVersionsIn(status, base);
	// }
}

// export function setNewCurrentVersionAfterWriteIn(
// 	status: ObjStatusInfo, newVersion: number, baseVer: number|undefined
// ): void {
// 	if (status.isArchived) { return; }
// 	status.versions.current = newVersion;
// 	if (status.syncState === 'synced') {
// 		status.syncState = 'unsynced';
// 	}
// 	if (baseVer !== undefined) {
// 		// base->diff links should be added before removals
// 		addBaseToDiffLinkInStatus(status, newVersion, baseVer);
// 	}
// 	if (status.versions.current) {
// 		rmNonArchVersionsIn(status, status.versions.current);
// 	}
// }

// export function addConflictingRemoteVersionTo(
// 	status: ObjStatusInfo, conflictVersion: number
// ): void {
// 	if (!status.versions.conflictingRemote) {
// 		status.versions.conflictingRemote = [];
// 	}
// 	const conflicts = status.versions.conflictingRemote;
// 	if (conflicts.find(v => v >= conflictVersion)) { return; }
// 	status.syncState = 'conflicting';
// 	status.versions.conflictingRemote.push(conflictVersion);
// }


Object.freeze(exports);