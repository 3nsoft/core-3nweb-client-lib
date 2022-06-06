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
import {  } from '../common/obj-info-file';
import { JSONSavingProc } from '../common/json-saving';
import { nonGarbageVersionsIn, readJSONInfoFileIn, rmArchVersionsIn, rmCurrentVersionIn, setCurrentVersionIn, VersionsInfo } from '../common/obj-info-file';
import { LogError } from '../../../lib-client/logging/log-to-file';

export interface ObjStatusInfo {
	objId: ObjId;
	isArchived?: boolean;
	versions: VersionsInfo;
}

const STATUS_FILE_NAME = 'status';


export class ObjStatus {

	private readonly saveProc: JSONSavingProc<ObjStatusInfo>;

	constructor (
		private readonly objFolder: string,
		private readonly status: ObjStatusInfo,
		private readonly logError: LogError|undefined
	) {
		this.saveProc = new JSONSavingProc(
			join(this.objFolder, STATUS_FILE_NAME),
			() => this.status);
		Object.freeze(this);
	}

	static async readFrom(
		objFolder: string, objId: ObjId, logError: LogError|undefined
	): Promise<ObjStatus> {
		const status = await readAndCheckStatus(objFolder, objId);
		return new ObjStatus(objFolder, status, logError);
	}

	static async makeNew(
		objFolder: string, objId: ObjId, logError: LogError|undefined
	): Promise<ObjStatus> {
		const status: ObjStatusInfo = {
			objId,
			versions: {
				baseToDiff: {},
				diffToBase: {}
			}
		};
		const s = new ObjStatus(objFolder, status, logError);
		await s.triggerSaveProc();
		return s;
	}

	private triggerSaveProc(captureErrors = false): Promise<void> {
		let p = this.saveProc.trigger();
		return (captureErrors ? p.catch(this.logError) : p);
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
		return {
			nonGarbage: nonGarbageVersionsIn(this.status.versions),
			gcMaxVer: this.status.versions.current
		};
	}

	async setNewCurrentVersion(
		newVersion: number, baseVer: number|undefined
	): Promise<void> {
		setCurrentVersionIn(this.status.versions, newVersion, baseVer);
		await this.triggerSaveProc();
	}

	async removeCurrentVersion(
		verObjs: ContainerWithDelete<number>
	): Promise<void> {
		this.status.isArchived = true;
		const current = rmCurrentVersionIn(this.status.versions);
		if (typeof current === 'number') {
			verObjs.delete(current);
		}
		await this.triggerSaveProc();
	}

	async removeArchivedVersion(
		version: number, verObjs: ContainerWithDelete<number>
	): Promise<void> {
		verObjs.delete(version);
		rmArchVersionsIn(this.status.versions, version);
		await this.triggerSaveProc();
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


Object.freeze(exports);