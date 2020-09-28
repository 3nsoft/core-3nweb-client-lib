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

import * as fs from '../../../lib-common/async-fs-node';
import { ObjId } from '../../../lib-client/3nstorage/xsp-fs/common';
import { SingleProc, DeduppedRunner } from '../../../lib-common/processes';
import { join } from 'path';
import { makeStorageException } from '../../../lib-client/3nstorage/exceptions';
import { readJSONInfoFileIn } from '../common/obj-info-file';

export interface ObjStatusInfo {
	objId: ObjId;
	isArchived?: boolean;
	
	/**
	 * This field indicates current object version in cache.
	 */
	currentVersion?: number;

	/**
	 * This is a list of archived versions in the cache.
	 */
	archivedVersions: number[];

	/**
	 * This is a map from base version to diff-ed version(s), that use(s) base.
	 */
	baseToDiff: { [baseVersion: number]: number[]; };

	/**
	 * This is a map from diff version to base version.
	 */
	diffToBase: { [diffVersion: number]: number; };
}

const STATUS_FILE_NAME = 'status';


export class ObjStatus {

	private readonly saveProc = new DeduppedRunner(() => this.saveFile());

	constructor (
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
			archivedVersions: [],
			baseToDiff: {},
			diffToBase: {}
		};
		const s = new ObjStatus(objFolder, status);
		await s.saveProc.trigger();
		return s;
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
		if (typeof this.status.currentVersion !== 'number') { throw new Error(
			`Object ${this.status.objId} has no current version.`); }
		return this.status.currentVersion;
	}

	getNonGarbageVersions(
	): { gcMaxVer: number|undefined; nonGarbage: Set<number> } {
		return {
			nonGarbage: nonGarbageVersions(this.status),
			gcMaxVer: this.status.currentVersion
		};
	}

	async setNewCurrentVersion(
		newVersion: number, baseVer: number|undefined
	): Promise<void> {
		this.status.currentVersion = newVersion;
		if (baseVer !== undefined) {
			// base->diff links should be added before removals
			addBaseToDiffLinkInStatus(this.status, newVersion, baseVer);
		}
		if (typeof this.status.currentVersion === 'number') {
			rmNonArchVersionsIn(this.status, this.status.currentVersion);
		}
		await this.saveProc.trigger();
	}

	async removeCurrentVersion(
		verObjs: ContainerWithDelete<number>
	): Promise<void> {
		this.status.isArchived = true;
		if (typeof this.status.currentVersion === 'number') {
			verObjs.delete(this.status.currentVersion);
			rmNonArchVersionsIn(this.status, this.status.currentVersion);
			delete this.status.currentVersion;
		}
		await this.saveProc.trigger();
	}

	async removeArchivedVersion(
		version: number, verObjs: ContainerWithDelete<number>
	): Promise<void> {
		verObjs.delete(version);
		const arch = this.status.archivedVersions;
		const vInd = arch.indexOf(version);
		if (vInd < 0) { return; }
		arch.splice(vInd, 1);
		rmNonArchVersionsIn(this.status, version);
		await this.saveProc.trigger();
	}

}
Object.freeze(ObjStatus.prototype);
Object.freeze(ObjStatus);


/**
 * This function adds base->diff link to status. Status object is changed in
 * this call.
 * @param status into which a link between versions should be added
 * @param diffVer
 * @param baseVer
 */
function addBaseToDiffLinkInStatus(
	status: ObjStatusInfo, diffVer: number, baseVer: number
): void {
	if (diffVer <= baseVer) { throw new Error(
		`Given diff version ${diffVer} is not greater than base version ${baseVer}`); }
	status.diffToBase[diffVer] = baseVer;
	const diffs = status.baseToDiff[baseVer];
	if (diffs) {
		if (diffs.indexOf(diffVer) < 0) {
			diffs.push(diffVer);
		}
	} else {
		status.baseToDiff[baseVer] = [ diffVer ];
	}
}

/**
* This function removes given version from status object, if it is neither
* archived, nor is a base for another version. If given version is itself
* based on another, this function is recursively applied to base version, as
* well.
* @param status in which version(s) should be removed
* @param ver
*/
function rmNonArchVersionsIn(status: ObjStatusInfo, ver: number): void {
	if (status.archivedVersions.indexOf(ver) >= 0) { return; }
	if (status.baseToDiff[ver]) { return; }
	const base = status.diffToBase[ver];
	if (typeof base !== 'number') { return; }
	delete status.diffToBase[ver];
	const diffs = status.baseToDiff[base];
	if (!diffs) { return; }
	const diffInd = diffs.indexOf(ver);
	if (diffInd < 0) { return; }
	diffs.splice(diffInd, 1);
	if (diffs.length === 0) {
		delete status.baseToDiff[base];
		rmNonArchVersionsIn(status, base);
	}
}

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

function nonGarbageVersions(status: ObjStatusInfo): Set<number> {
	const nonGarbage = new Set<number>();
	addWithBasesTo(nonGarbage, status.currentVersion, status);
	for (const archVer of status.archivedVersions) {
		addWithBasesTo(nonGarbage, archVer, status);
	}
	return nonGarbage;
}

function addWithBasesTo(
	nonGarbage: Set<number>, ver: number|undefined, status: ObjStatusInfo
): void {
	while (typeof ver === 'number') {
		nonGarbage.add(ver);
		ver = status.diffToBase[ver];
	}
}


Object.freeze(exports);