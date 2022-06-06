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

import { ObjId } from '../../../lib-client/3nstorage/xsp-fs/common';
import { join } from 'path';
import { makeStorageException } from '../../../lib-client/3nstorage/exceptions';
import { JSONSavingProc } from '../common/json-saving';
import { addWithBasesTo, nonGarbageVersionsIn, readJSONInfoFileIn, rmCurrentVersionIn, setCurrentVersionIn, VersionsInfo } from '../common/obj-info-file';
import { LogError } from '../../../lib-client/logging/log-to-file';
import { copy as deepCopy } from '../../../lib-common/json-utils';

type FileException = web3n.files.FileException;
type Stats = web3n.files.Stats;

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
	versions: VersionsInfo;
	sync: {
		state: SyncState;
		latest?: number;
		conflictingRemote?: number[];
		remote?: number;
		deletedOnRemote?: true;
	};
	syncTasks?: {
		queued: UpSyncTaskInfo[];
		current?: UpSyncTaskInfo;
	};
}

export interface UploadInfo {
	type: 'upload';
	transactionId?: string;
	createObj?: true;
	needUpload?: {
		header?: number;
		segs: BytesSection[];
		allByteOnDisk?: true;
	};
	version: number;
	baseVersion?: number;
}

export interface BytesSection {
	ofs: number;
	len: number;
}

export interface RemovalInfo {
	type: 'removal',
	archivedVersions?: number[]|number;
	currentVersion?: true;
}

export interface ArchivalInfo {
	type: 'archiving',
	archivalOfCurrent?: true;
}

export type UpSyncTaskInfo = UploadInfo | RemovalInfo | ArchivalInfo;

export interface UpSyncStatus {
	queueTask(t: UpSyncTaskInfo): void;
	getTaskForProcessing(): Promise<UpSyncTaskInfo|undefined>;
	glanceOnNextTask(): UpSyncTaskInfo|undefined;
	recordInterimStateOfCurrentTask(t: UploadInfo): Promise<void>;
	recordTaskCompletion(t: UpSyncTaskInfo): Promise<void>;
	isSyncDone(): boolean;
	stat(): NonNullable<Stats['sync']>;
}

export const STATUS_FILE_NAME = 'status';


export class ObjStatus implements UpSyncStatus {

	private readonly saveProc: JSONSavingProc<ObjStatusInfo>;

	private constructor (
		private readonly objFolder: string,
		private readonly status: ObjStatusInfo,
		private readonly logError: LogError
	) {
		this.saveProc = new JSONSavingProc(
			join(this.objFolder, STATUS_FILE_NAME),
			() => this.status);
		Object.freeze(this);
	}

	static async readFrom(
		objFolder: string, objId: ObjId, logError: LogError
	): Promise<ObjStatus> {
		const status = await readAndCheckStatus(objFolder, objId);
		return new ObjStatus(objFolder, status, logError);
	}

	static async makeNew(
		objFolder: string, objId: ObjId, logError: LogError
	): Promise<ObjStatus> {
		const status: ObjStatusInfo = {
			objId,
			sync: {
				state: 'unsynced'
			},
			versions: {
				baseToDiff: {},
				diffToBase: {},
			}
		};
		const s = new ObjStatus(objFolder, status, logError);
		await s.triggerSaveProc();
		return s;
	}

	static async makeForDownloadedVersion(
		objFolder: string, objId: ObjId, version: number, currentRemote: number,
		logError: LogError
	): Promise<ObjStatus> {
		const status: ObjStatusInfo = {
			objId,
			sync: {
				state: 'synced',
				remote: currentRemote,
				latest: currentRemote,
			},
			versions: {
				current: version,
				baseToDiff: {},
				diffToBase: {}
			}
		};
		const s = new ObjStatus(objFolder, status, logError);
		await s.triggerSaveProc();
		return s;
	}

	static async fileShowsObjNotInSyncedState(
		objFolder: string, objId: ObjId
	): Promise<boolean> {
		const status = await readAndCheckStatus(objFolder, objId);
		return (status.sync.state !== 'synced');
	}

	isArchived(): boolean {
		return !!this.status.isArchived;
	}

	getCurrentVersionOrThrow(): number {
		if (typeof this.status.versions.current !== 'number') { throw new Error(
			`Object ${this.status.objId} has no current version.`); }
		return this.status.versions.current;
	}

	getNonGarbageVersions(): { gcMaxVer?: number; nonGarbage: Set<number> } {
		const versions = this.status.versions;
		const nonGarbage = nonGarbageVersionsIn(versions);
		if (this.status.syncTasks) {
			const tasks = this.status.syncTasks;
			if (tasks.current) {
				addWithBasesTo(
					nonGarbage, nonGarbageVersionInTask(tasks.current), versions);
			}
			for (const t of tasks.queued) {
				addWithBasesTo(nonGarbage, nonGarbageVersionInTask(t), versions);
			}
		}
		return {
			nonGarbage,
			gcMaxVer: versions.current
		};
	}

	isRemoteVersionGreaterOrEqualTo(newRemoteVersion: number): boolean {
		return ((typeof this.status.sync.remote === 'number') ?
			(this.status.sync.remote >= newRemoteVersion) : false);
	}

	isDeletedOnRemote(): boolean {
		return !!this.status.sync.deletedOnRemote;
	}

	syncedVersionGreaterOrEqual(version: number): boolean {
		return ((typeof this.status.sync.latest !== 'number') ?
			false : (version <= this.status.sync.latest));
	}

	async removeCurrentVersion(
		verObjs: ContainerWithDelete<number>
	): Promise<void> {
		this.status.isArchived = true;
		const current = rmCurrentVersionIn(this.status.versions);
		if (typeof current === 'number') {
			verObjs.delete(current);
		}
		this.addRemoveCurrentToQueue();
		await this.triggerSaveProc().catch((exc: FileException) => {
			if (exc.notFound && this.status.isArchived) {
				return;
			} else {
				throw exc;
			}
		});
	}

	private async triggerSaveProc(
		captureErrors = false, logErr = false
	): Promise<void> {
		try {
			await this.saveProc.trigger();
		} catch (exc) {
			if (captureErrors) {
				if (logErr) {
					await this.logError(exc);
				}
			} else {
				throw exc;
			}
		}
	}

	async setDeletedOnRemote(): Promise<void> {
		this.status.sync.deletedOnRemote = true;
		await this.triggerSaveProc();
	}

	async setRemoteVersion(version: number): Promise<void> {
		if (this.status.sync.remote! >= version) { return; }
		this.status.sync.remote = version;
		if (this.status.sync.state === 'synced') {
			if (this.status.versions.current! < this.status.sync.remote) {
				this.status.sync.state = 'behind';
			}
		} else if (this.status.sync.state === 'unsynced') {
			this.status.sync.state = 'conflicting';
		}
		await this.triggerSaveProc();
	}

	async markVersionSynced(version: number): Promise<void> {
		if (!this.status.sync.latest
		|| (this.status.sync.latest < version)) {
			this.status.sync.latest = version;
			if (this.status.versions.current === version) {
				this.status.sync.state = 'synced';
			}
			await this.triggerSaveProc();
		}
	}

	async setUnsyncedCurrentVersion(
		version: number, baseVer: number|undefined
	): Promise<void> {
		setCurrentVersionIn(this.status.versions, version, baseVer);
		this.status.sync.state = 'unsynced';
		await this.triggerSaveProc();
	}

	/**
	 * This method ignores remote conflicting versions.
	 * @param version 
	 */
	isVersionSynced(version: number): boolean {
		if (this.status.versions.current === undefined) { return false; }
		if (this.status.sync.state == 'synced') { return true; }
		if (this.status.sync.latest === undefined) { return false; }
		return (this.status.sync.latest >= version);
	}

	isVersionArchived(version: number): boolean {
		if (!this.status.versions.archived) { return false; }
		return this.status.versions.archived.includes(version);
	}

	queueTask(t: UpSyncTaskInfo): void {
		if (t.type === 'upload') {
			this.addUploadToQueue(t);
		} else if (t.type === 'removal') {
			if (t.currentVersion) {
				throw new Error(`Removal of current task needs other method`);
			} else if (t.archivedVersions) {
				this.addRemoveArchivedToQueue(t.archivedVersions);
			}
		} else if (t.type === 'archiving') {
			this.addArchivalToQueue(t);
		} else {
			throw new Error(`Unsupported upsync task type`);
		}
	}

	private addUploadToQueue(u: UploadInfo): void {
		if (!this.status.syncTasks) {
			this.status.syncTasks = { queued: [ u ] };
		} else {
			const q = this.status.syncTasks.queued;
			const last = lastIn(q);
			if (last) {
				if (last.type === 'upload') {
					if (!this.isVersionArchived(last.version)) {
						if (last.createObj) {
							u.createObj = true;
						}
						q[q.length-1] = u;
					} else {
						q.push(u);
					}
				} else if (last.type === 'archiving') {
					q.push(u);
				} else if ((last.type === 'removal') && last.archivedVersions) {
					q.push(u);
				}
			} else {
				q.push(u);
			}
		}
		this.triggerSaveProc(true);
	}

	private addRemoveCurrentToQueue(): void {
		const r: RemovalInfo = { type:'removal', currentVersion: true };
		if (this.status.syncTasks) {
			const q = this.status.syncTasks!.queued;
			const last = lastIn(q);
			if (last) {
				if (last.type === 'archiving') {
					q.push(r);
				} else if (last.type === 'upload') {
					if (this.isVersionArchived(last.version)) {
						q.push(r);
					} else if (this.status.sync.latest
					|| this.status.syncTasks!.current) {
						q[q.length-1] = r;
					} else {
						q.splice(q.length-1, 1);
						this.addRemoveCurrentToQueue();
						return;
					}
				}
			} else if (this.status.sync.latest
			|| this.status.syncTasks!.current) {
				q.push(r);
			} else {
				this.status.syncTasks = undefined;
			}
		} else {
			if (this.status.sync.latest) {
				this.status.syncTasks = { queued: [ r ] };
			}
		}
	}

	private addRemoveArchivedToQueue(archVer: number|number[]): void {
		const r: RemovalInfo = { type:'removal', archivedVersions: archVer };
		if (this.status.syncTasks) {
			this.status.syncTasks!.queued.push(r);
		} else {
				this.status.syncTasks = { queued: [ r ] };
		}
		this.triggerSaveProc(true);
	}

	private addArchivalToQueue(a: ArchivalInfo): void {
		if (!this.status.syncTasks) {
			this.status.syncTasks = { queued: [ a ] };
		} else {
			this.status.syncTasks!.queued.push(a);
		}
		this.triggerSaveProc(true);
	}

	async getTaskForProcessing(): Promise<UpSyncTaskInfo | undefined> {
		const syncTasks = this.status.syncTasks;
		if (!syncTasks) { return; }
		if (syncTasks.current) { return syncTasks.current; }
		syncTasks.current = syncTasks.queued.shift();
		if (syncTasks.current) {
			await this.triggerSaveProc();
		}
		return syncTasks.current;
	}

	glanceOnNextTask(): UpSyncTaskInfo | undefined {
		const syncTasks = this.status.syncTasks;
		if (!syncTasks) { return; }
		if (syncTasks.current) {
			return syncTasks.current;
		} else if (syncTasks.queued.length > 0) {
			return syncTasks.queued[0];
		}
	}

	async recordInterimStateOfCurrentTask(t: UploadInfo): Promise<void> {
		const syncTasks = this.status.syncTasks;
		if (!syncTasks) { throw new Error(`This method is called too early.`); }
		if (syncTasks.current === t) {
			await this.triggerSaveProc();
		} else {
			throw new Error(`Can save interim state of a current task only`);
		}
	}

	async recordTaskCompletion(t: UpSyncTaskInfo): Promise<void> {
		const syncTasks = this.status.syncTasks;
		if (!syncTasks) { throw new Error(`This method is called too early.`); }
		if (syncTasks.current === t) {
			if (syncTasks.queued.length > 0) {
				syncTasks.current = undefined;
			} else {
				this.status.syncTasks = undefined;
			}
			await this.triggerSaveProc();
		}
	}

	isSyncDone(): boolean {
		return !this.status.syncTasks;
	}

	isFileSaved(): boolean {
		return this.saveProc.isSaved();
	}

	stat(): NonNullable<Stats['sync']> {
		return deepCopy(this.status.sync);
	}

}
Object.freeze(ObjStatus.prototype);
Object.freeze(ObjStatus);


interface ContainerWithDelete<T> {
	delete(key: T): void;
}

export async function readAndCheckStatus(
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

function lastIn<T>(arr: T[]): T|undefined {
	return ((arr.length > 0) ? arr[arr.length - 1] : undefined);
}

function nonGarbageVersionInTask(task: UpSyncTaskInfo): number|undefined {
	if (task.type === 'upload') {
		return task.version;
	}
}


Object.freeze(exports);