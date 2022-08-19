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

import { ObjId, SyncedObjStatus } from '../../../lib-client/3nstorage/xsp-fs/common';
import { join } from 'path';
import { makeFSSyncException, makeStorageException } from '../../../lib-client/3nstorage/exceptions';
import { JSONSavingProc } from '../common/json-saving';
import { addArchived, addWithBasesTo, isEmptyVersions, isVersionIn, NonGarbageVersions, nonGarbageVersionsIn, readJSONInfoFileIn, rmArchVersionFrom, rmCurrentVersionIn, rmNonArchVersionsIn, rmVersionIn, setCurrentVersionIn, VersionsInfo } from '../common/obj-info-file';
import { LogError } from '../../../lib-client/logging/log-to-file';
import { assert } from '../../../lib-common/assert';
import { DiffInfo, ObjStatus as RemoteObjStatus } from '../../../lib-common/service-api/3nstorage/owner';
import { FiniteChunk } from '../../../lib-common/objs-on-disk/file-layout';
import { UploadStatusRecorder } from './upsyncer';

type FileException = web3n.files.FileException;
type SyncStatus = web3n.files.SyncStatus;
type SyncState = web3n.files.SyncState;
type LocalVersion = web3n.files.LocalVersion;
type SyncVersionsBranch = web3n.files.SyncVersionsBranch;

/**
 * This is status information of an object in synced storage.
 * Local references versions that haven't been synced/uploaded.
 * Remote enumerates versions on the server.
 * Synced marks version of latest synchronized moment.
 * Local versions must be on disk as it is the only copy. Remote versions can
 * be present as needed/desired.
 */
export interface ObjStatusInfo {
	objId: ObjId;
	local?: LocalVersions;
	synced?: SyncMarker;
	remote: VersionsOnServer;
}

export interface LocalVersions extends VersionsInfo {
	isArchived?: boolean;
	archived?: undefined;
	upload?: UploadInfo;
}

export interface SyncMarker {
	version?: number;
	isArchived?: boolean;
	base?: number;
}

export interface VersionsOnServer extends VersionsInfo {
	isArchived?: boolean;
}

export interface UploadInfo {
	localVersion: number;
	uploadVersion: number;
	baseVersion?: number;
	needUpload?: WholeVerOrderedUpload|DiffVerOrderedUpload;
}

export interface WholeVerOrderedUpload {
	type: 'ordered-whole';
	createObj?: boolean;
	header?: number;
	segsLeft: number;
	segsOfs: number;
	transactionId?: string;
}

export interface DiffVerOrderedUpload {
	type: 'ordered-diff';
	diff: DiffInfo;
	header?: number;
	newSegsLeft: FiniteChunk[];
	transactionId?: string;
}

export interface BytesSection {
	ofs: number;
	len: number;
}

function makeVersions<T extends VersionsInfo>(): T {
	return {
		baseToDiff: {},
		diffToBase: {},
	} as T;
}

function makeObjStatusInfo(objId: ObjId): ObjStatusInfo {
	return {
		objId,
		remote: makeVersions()
	};
}

function syncStateOf({ local, synced, remote }: ObjStatusInfo): SyncState {
	const syncedIsCurrent = isSyncedCurrentWithRemote(synced, remote);
	if (local) {
		switch (syncedIsCurrent) {
			case undefined:
			case true:
				return ((local.isArchived && synced?.isArchived) ?
					'synced' : 'unsynced');
			case false:
				return 'conflicting';
		}
	} else {
		switch (syncedIsCurrent) {
			case undefined:
				return 'unsynced';
			case true:
				return 'synced';
			case false:
				return 'behind';
		}
	}
}

function isSyncedCurrentWithRemote(
	synced: ObjStatusInfo['synced'], remote: ObjStatusInfo['remote']
): boolean|undefined {
	if (synced) {
		return ((synced.version === remote.current)
			&& (synced.isArchived === remote.isArchived));
	} else {
		return (isRemoteEmpty(remote) ? undefined : false);
	}
}

function isRemoteEmpty(remote: ObjStatusInfo['remote']): boolean {
	return isEmptyVersions(remote) && !remote.isArchived;
}

export interface NonGarbage {
	local?: NonGarbageVersions;
	remote: NonGarbageVersions;
	uploadVersion?: number;
}

function nonGarbageWithMaxVer(v: VersionsInfo): NonGarbageVersions {
	return {
		gcMaxVer: v.current,
		nonGarbage: nonGarbageVersionsIn(v)
	}
}

function identifyNonGarbage(status: ObjStatusInfo): NonGarbage {
	let local: NonGarbage['local'] = undefined;
	let uploadVersion: number|undefined = undefined;
	if (status.local) {
		local = nonGarbageWithMaxVer(status.local);
		if (status.local.upload) {
			const { localVersion } = status.local.upload;
			if (status.local.current !== localVersion) {
				addWithBasesTo(local.nonGarbage, localVersion, status.local);
			}
			uploadVersion = status.local.upload.uploadVersion;
		}
	}
	const remote = nonGarbageWithMaxVer(status.remote);
	if (status.synced?.version) {
		remote.nonGarbage.add(status.synced.version);
		if (status.synced.base) {
			addWithBasesTo(remote.nonGarbage, status.synced.base, status.remote);
		}
	}
	return { local, remote, uploadVersion };
}

export const STATUS_FILE_NAME = 'status';


export class ObjStatus implements SyncedObjStatus, UploadStatusRecorder {

	private readonly saveProc: JSONSavingProc<ObjStatusInfo>;
	private stateIndicator: SyncState;

	private constructor (
		private readonly objFolder: string,
		private readonly status: ObjStatusInfo,
		private readonly logError: LogError
	) {
		this.saveProc = new JSONSavingProc(
			join(this.objFolder, STATUS_FILE_NAME),
			() => this.status);
		this.updateStateIndicator();
		Object.seal(this);
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
		const status = makeObjStatusInfo(objId);
		const s = new ObjStatus(objFolder, status, logError);
		await s.triggerSaveProc();
		return s;
	}

	static async makeForDownloadedVersion(
		objFolder: string, objId: ObjId, version: number, currentRemote: number,
		logError: LogError
	): Promise<ObjStatus> {
		const status = makeObjStatusInfo(objId);
		status.remote.current = currentRemote;
		status.synced = { version: currentRemote };
		if (currentRemote > version) {
			status.remote.archived = [ version ];
		} else if (currentRemote !== version) {
			throw new Error(`Downloaded version can't be greater than current remote`);
		}
		const s = new ObjStatus(objFolder, status, logError);
		await s.triggerSaveProc();
		return s;
	}

	static async fileShowsObjNotInSyncedState(
		objFolder: string, objId: ObjId
	): Promise<boolean> {
		const status = await readAndCheckStatus(objFolder, objId);
		return (syncStateOf(status) !== 'synced');
	}

	private updateStateIndicator(): void {
		this.stateIndicator = syncStateOf(this.status);
	}

	isArchived(): boolean {
		return !!this.status.local?.isArchived;
	}

	getCurrentLocalOrSynced(): number {
		const state = this.stateIndicator;
		const current = (((state === 'unsynced') || (state === 'conflicting')) ?
			this.status.local?.current : this.status.synced?.version);
		if (current) {
			return current;
		} else {
			throw makeStorageException({
				objNotFound: true,
				message: 'Current version is not found'
			});
		}
	}

	getNonGarbageVersions(): NonGarbage {
		return identifyNonGarbage(this.status);
	}

	async removeCurrentVersion(): Promise<void> {
		let { local, synced } = this.status;
		if (synced?.isArchived || local?.isArchived) { return; }
		if (local) {
			rmCurrentVersionIn(local);
		} else {
			local = makeVersions() as LocalVersions;
		}
		local.isArchived = true;
		this.updateStateIndicator();;
		await this.triggerSaveProc().catch((exc: FileException) => {
			if (exc.notFound && this.status.local?.isArchived) {
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

	recordUploadStart(info: UploadInfo): Promise<void> {
		assert(!!this.status.local);
		const local = this.status.local!;
		if (local.upload) {
			throw makeFSSyncException('obj-status', {
				alreadyUploading: true,
				message: `Status already has upload of version ${local.upload.uploadVersion} and can't start another upload with version ${info.uploadVersion}`
			});
		}
		if (info.localVersion === local.current) {
			local.upload = info;
		} else {
			throw makeFSSyncException('obj-status', {
				localVersion: info.localVersion,
				versionNotFound: true
			});
		}
		return this.triggerSaveProc();
	}

	recordUploadInterimState(info: UploadInfo): Promise<void> {
		assert(!!this.status.local);
		const local = this.status.local!;
		assert(!!local.upload &&
			(local.upload.uploadVersion === info.uploadVersion));
		local.upload = info;
		return this.triggerSaveProc();
	}

	recordUploadCancellation(info: UploadInfo): Promise<void> {
		assert(!!this.status.local);
		const local = this.status.local!;
		assert(!!local.upload &&
			(local.upload.uploadVersion === info.uploadVersion));
		local.upload = undefined;
		return this.triggerSaveProc();
	}

	async recordArchVersionRemoval(version: number): Promise<void> {
		if (rmArchVersionFrom(this.status.remote, version)) {
			return this.triggerSaveProc();
		}
	}

	async recordVersionArchival(version: number): Promise<void> {
		if (addArchived(this.status.remote, version)) {
			return this.triggerSaveProc();
		}
	}

	async recordRemoteRemoval(): Promise<void> {
		const { local, synced, remote } = this.status;
		if (local?.isArchived || synced?.isArchived) { return; }
		remote.isArchived = true;
		rmCurrentVersionIn(remote);
		this.updateStateIndicator();
		return this.triggerSaveProc();
	}

	async recordRemoteChange(version: number): Promise<void> {
		const { local, synced, remote } = this.status;
		if ((local?.upload && (local.upload.uploadVersion === version))
		|| (synced?.version && (synced.version >= version))) { return; }
		remote.current = version;
		this.updateStateIndicator();
		return this.triggerSaveProc();
	}

	recordSyncOfObjRemoval(): Promise<void> {
		this.status.local = undefined;
		rmCurrentVersionIn(this.status.remote);
		this.status.remote.isArchived = true;
		if (this.status.synced) {
			this.status.synced.isArchived = true;
			this.status.synced.version = undefined;
			if (this.status.synced.base) {
				rmNonArchVersionsIn(this.status.remote, this.status.synced.base);
				this.status.synced.base = undefined;
			}
		} else {
			this.status.synced = { isArchived: true };
		}
		this.updateStateIndicator();
		return this.triggerSaveProc();
	}

	async recordStatusFromServer(
		{ archived, current }: RemoteObjStatus
	): Promise<void> {
		const remote = this.status.remote;
		let changedCurrent = false;
		if (current) {
			if (!remote.current) {
				remote.current = current;
				changedCurrent = true;
			} else if (remote.current < current) {
				rmCurrentVersionIn(remote);
				remote.current = current;
				changedCurrent = true;
			}
		} else if (remote.current) {
			rmCurrentVersionIn(remote);
			remote.isArchived = true;
			changedCurrent = true;
		}
		const rmArchived = removeArchVersionsNotInList(remote, archived);
		const addedArchived = addArchVersionsFromList(remote, archived);
		if (rmArchived || addedArchived || changedCurrent) {
			this.updateStateIndicator();
			await this.triggerSaveProc();
		}
	}

	/**
	 * When given object version is a diff on some base, this method returns
	 * a whole trace of local base versions up to synced one.
	 * Local bases, if present, are return in an array with highest version
	 * first.
	 * This returns undefined, when given object version is not a diff.
	 * @param version that is local, for which we want to get base versions, if
	 * it is a diff version.
	 */
	baseOfLocalVersion(version: number): {
		localBases?: number[]; syncedBase?: number;
	} | undefined {
		assert(!!this.status.local);
		const local = this.status.local!;
		assert(isVersionIn(version, local));
		let base = local.diffToBase[version];
		if (!base) { return; }
		if (isVersionIn(base, this.status.remote)) {
			return { syncedBase: base };
		}
		const localBases: number[] = [];
		do {
			localBases.push(base);
			base = local.diffToBase[base];
		} while (base);
		const lastBase = localBases[localBases.length-1];
		if (isVersionIn(lastBase, this.status.remote)) {
			return {
				localBases: localBases.slice(0, localBases.length-1),
				syncedBase: lastBase
			};
		 } else {
			return { localBases };
		 }
	}

	markLocalVersionSynced(
		localVersion: number, uploadVersion: number
	): Promise<void> {
		const { local, synced, remote } = this.status;
		assert(!!local?.upload &&
			(local?.upload.uploadVersion === uploadVersion));
		const syncedBase = local!.upload!.baseVersion;
		if (!remote.current || (remote.current <= uploadVersion)) {
			setCurrentVersionIn(remote, uploadVersion, syncedBase);
		}
		if (synced) {
			synced.version = uploadVersion;
			if (synced.base && (synced.base !== syncedBase)) {
				rmNonArchVersionsIn(remote, synced.base);
			}
			synced.base = syncedBase;
		} else {
			this.status.synced = { version: uploadVersion, base: syncedBase };
		}
		if (local!.current === localVersion) {
			this.status.local = undefined;
		} else {
			local!.upload = undefined;
		}
		this.updateStateIndicator();
		return this.triggerSaveProc();
	}

	async setLocalCurrentVersion(
		version: number, baseVer: number|undefined
	): Promise<void> {
		if (!this.status.local) {
			this.status.local = makeVersions();
		}
		setCurrentVersionIn(this.status.local, version, baseVer);
		this.updateStateIndicator();
		await this.triggerSaveProc();
	}

	listVersions(): { current?: number; archived?: number[]; } {
		const { local, synced, remote } = this.status;
		switch (this.stateIndicator) {
			case 'unsynced':
			case 'conflicting':
				assert(!!local);
				return {
					current: local!.current,
					archived: (synced?.version ?
						versionsToBranch(remote, synced.version, false).archived :
						undefined)
				};
			case 'synced':
			case 'behind':
				assert(!!synced);
				return {
					current: synced!.version,
					archived: (synced?.version ?
						versionsToBranch(remote, synced.version, false).archived :
						remote.archived?.slice())
				};
			default:
				throw new Error(`Unimplemented state ${this.stateIndicator}`);
		}
	}

	async archiveCurrentVersion(): Promise<void> {
		const { synced, remote } = this.status;
		assert(!!synced?.version);
		addArchived(remote, synced!.version!);
		await this.triggerSaveProc();
	}

	absorbLocalVersionBase(version: number, localBase: number): Promise<void> {
		assert(!!this.status.local);
		const local = this.status.local!;
		assert(local.diffToBase[version] === localBase);
		const lowerBase = local.diffToBase[localBase];
		if (localBase) {
			local.diffToBase[version] = lowerBase;
			local.baseToDiff[lowerBase] = version;
		} else {
			delete local.diffToBase[version];
		}
		delete local.diffToBase[localBase];
		delete local.baseToDiff[localBase];
		return this.triggerSaveProc();
	}

	latestSyncedVersion(): number|undefined {
		return this.status.synced?.version;
	}

	syncStatus(): SyncStatus {
		const { remote, synced } = splitVersionsIntoBranches(
			this.status.remote, this.status.synced);
		return {
			state: this.stateIndicator,
			local: localVersionFromStatus(this.status.local),
			remote,
			synced
		};
	}

	neverUploaded(): boolean {
		const synced = this.status.synced;
		return (!synced?.version && !synced?.isArchived);
	}

	async adoptRemoteVersion(
		version?: number, dropLocalVer = false
	): Promise<void> {
		const { local, remote } = this.status;
		if (this.stateIndicator !== 'behind') {
			if (this.stateIndicator === 'synced') {
				return;
			} else if (!dropLocalVer) {
				throw makeFSSyncException('', {
					localVersion: local?.current,
					remoteVersion: remote.current,
					conflict: true,
					message: `Can't adopt remote version in '${this.stateIndicator}' state`
				});
			}
		}
		if (version) {
			if ((remote.current === version)
			|| remote.archived?.includes(version)) {
				this.status.synced = { version, base: remote.diffToBase[version] };
			} else {
				throw makeFSSyncException('', {
					remoteVersion: remote.current,
					versionNotFound: true,
					message: `Remote version ${version} is not in status info`
				});
			}
		} else if (remote.current) {
			version = remote.current;
			this.status.synced = { version, base: remote.diffToBase[version] };
		} else {
			throw makeFSSyncException('', {
				versionMismatch: true,
				message: `Current remote version is not set in status info`
			});
		}
		if (local) {
			this.status.local = undefined;
		}
		this.updateStateIndicator();
		await this.triggerSaveProc();
	}

}
Object.freeze(ObjStatus.prototype);
Object.freeze(ObjStatus);


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
		throw makeStorageException({
			message: `Invalid objId in status file for obj ${objId}, in folder ${objFolder}.\nInvalid content:\n${JSON.stringify(status, null, 2)}`
		});
	}

	return status;
}

function localVersionFromStatus(
	tagged: LocalVersions|undefined
): LocalVersion|undefined {
	return (tagged ? {
		latest: tagged.current,
		isArchived: tagged.isArchived
	} : undefined);
}

function splitVersionsIntoBranches(
	remote: ObjStatusInfo['remote'], synced: ObjStatusInfo['synced']
): { remote?: SyncStatus['remote']; synced?: SyncStatus['synced'] } {
	if (synced) {
		if (isSyncedCurrentWithRemote(synced, remote)) {
			return {
				synced: versionsToBranch(remote)
			};
		} else {
			assert(!!synced.version);
			return {
				synced: versionsToBranch(remote, synced.version, false),
				remote: versionsToBranch(remote, synced.version, true)
			};
		}
	} else {
		return (isRemoteEmpty(remote) ? {} : {
			remote: versionsToBranch(remote)
		});
	}
}

function versionsToBranch(
	{ current, archived, isArchived }: VersionsOnServer,
	splitVersion?: number, aboveSplit?: boolean
): SyncVersionsBranch {
	if (splitVersion) {
		let splitArchived: number[]|undefined = undefined;
		if (archived) {
			const indAboveSplit = archived.findIndex(v => (v > splitVersion));
			if (aboveSplit) {
				if (indAboveSplit >= 0) {
					splitArchived = archived.slice(indAboveSplit);
				}
			} else {
				if (indAboveSplit > 0) {
					splitArchived = archived.slice(0, indAboveSplit);
				} else {
					splitArchived = archived.slice();
				}
			}
		}
		return {
			archived: splitArchived,
			latest: (aboveSplit ? current : splitVersion),
			isArchived: isArchived
		};
	} else {
		return {
			archived: archived?.slice(),
			latest: current,
			isArchived: isArchived
		};
	}
}

function removeArchVersionsNotInList(
	remote: VersionsOnServer, versionsToKeep: number[]|undefined
): boolean {
	let isAnythingChanged = false;
	if (remote.archived) {
		for (const v of remote.archived) {
			if (!versionsToKeep?.includes(v)) {
				rmArchVersionFrom(remote, v);
				isAnythingChanged = true;
			}
		}
	}
	return isAnythingChanged;
}

function addArchVersionsFromList(
	remote: VersionsOnServer, existingVersions: number[]|undefined
): boolean {
	if (!existingVersions) { return false; }
	let isAnythingChanged = false;
	for (const v of existingVersions) {
		if (!remote.archived?.includes(v)) {
			addArchived(remote, v);
		}
	}
	return isAnythingChanged;
}


Object.freeze(exports);