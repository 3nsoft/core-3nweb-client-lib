/*
 Copyright (C) 2020, 2022 3NSoft Inc.

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

import { SynchronizerOnObjId, SyncedObj, UNSYNCED_FILE_NAME_EXT, REMOTE_FILE_NAME_EXT, } from './obj-files';
import { SingleProc } from '../../../lib-common/processes/synced';
import * as fs from '../../../lib-common/async-fs-node';
import { join } from 'path';
import { NonGarbageVersions } from '../common/obj-info-file';
import { NonGarbage } from './obj-status';
import { getAndRemoveOneFrom, noop } from '../common/utils';
import { UPLOAD_HEADER_FILE_NAME_EXT } from './upload-header-file';


export class GC {

	private isStopped = false;

	/**
	 * All gc steps are done in this process.
	 */
	private readonly gcProc = new SingleProc();

	/**
	 * wip are objects that are currently processed. When wip set is empty,
	 * it gets swapped with non-empty scheduled set. 
	 */
	private wip = new Set<SyncedObj>();

	/**
	 * scheduled is a set for incoming ids that may need gc. It gets swapped
	 * with wip set.
	 */
	private scheduled = new Set<SyncedObj>();

	constructor(
		private readonly sync: SynchronizerOnObjId,
		private readonly rmObjFromCache: (obj: SyncedObj) => void,
		private readonly rmObjFolder: (objId: string) => Promise<void>,
	) {
		Object.seal(this);
	}

	scheduleCollection = (obj: SyncedObj): void => {
		if (this.isStopped) { return; }
		this.scheduled.add(obj);
		if (this.gcProc.isProcessing()) { return; }
		this.gcProc.start(this.objCollecting);
	};

	async stop(): Promise<void> {
		this.isStopped = true;
	}

	private objCollecting = async (): Promise<void> => {
		if (this.wip.size === 0) {
			[ this.wip, this.scheduled ] = [ this.scheduled, this.wip ];
		}
		const obj = getAndRemoveOneFrom(this.wip);
		if (!obj) { return; }
		await this.sync(obj.objId, () => this.collectIn(obj).catch(noop));
		return this.objCollecting();
	}

	private async collectIn(obj: SyncedObj): Promise<void> {
		const nonGarbage = obj.statusObj().getNonGarbageVersions();
		if (!(await this.checkAndRemoveWholeObjFolder(obj, nonGarbage))) {
			await removeGarbageFiles(obj, nonGarbage);
		}
	}

	private async checkAndRemoveWholeObjFolder(
		obj: SyncedObj, { local, remote }: NonGarbage
	): Promise<boolean> {
		if (obj.objId
		&& obj.statusObj().isArchived()
		&& !needsUpsyncOfRemoval(obj)
		&& (!local || (local.nonGarbage.size === 0))
		&& (remote.nonGarbage.size === 0)) {
			this.rmObjFromCache(obj);
			await this.rmObjFolder(obj.objId);
			return true;
		} else {
			return false;
		}
	}

}
Object.freeze(GC.prototype);
Object.freeze(GC);


function needsUpsyncOfRemoval(obj: SyncedObj): boolean {
	const s = obj.statusObj();
	return !(s.neverUploaded() || (s.syncStatus().state === 'synced'));
}

function canRemove(
	f: string, { local, remote, uploadVersion }: NonGarbage
): boolean {
	if (f.endsWith(UNSYNCED_FILE_NAME_EXT)) {
		const verStr = f.slice(0, f.length-1-UNSYNCED_FILE_NAME_EXT.length);
		return (local ? canGC(verStr, local) : true);
	} else if (f.endsWith(REMOTE_FILE_NAME_EXT)) {
		const verStr = f.slice(0, f.length-1-REMOTE_FILE_NAME_EXT.length);
		return canGC(verStr, remote);
	} else if (!!uploadVersion
	&& f.endsWith(UPLOAD_HEADER_FILE_NAME_EXT)) {
		const verStr = f.slice(0, f.length-1-UPLOAD_HEADER_FILE_NAME_EXT.length);
		return canGCUploadHeader(verStr, uploadVersion);
	} else {
		return false;
	}
}

function canGC(verStr: string, nonGC: NonGarbageVersions): boolean {
	const ver = parseInt(verStr);
	if (isNaN(ver)) {
		return true;
	} else if (!nonGC.nonGarbage.has(ver)
	&& (!nonGC.gcMaxVer || (ver < nonGC.gcMaxVer))) {
		return true;
	} else {
		return false;
	}
}

function canGCUploadHeader(verStr: string, uploadVersion: number): boolean {
	const ver = parseInt(verStr);
	if (isNaN(ver)) {
		return true;
	} else {
		return (ver === uploadVersion);
	}
}

async function removeGarbageFiles(
	obj: SyncedObj, nonGarbage: NonGarbage
): Promise<void> {
	const lst = await fs.readdir(obj.objFolder).catch(noop);
	if (!lst) { return; }
	const rmProcs: Promise<void>[] = [];
	for (const f of lst) {
		if (canRemove(f, nonGarbage)) {
			rmProcs.push(fs.unlink(join(obj.objFolder, f)).catch(noop));
		}
	}
	if (rmProcs.length > 0) {
		await Promise.all(rmProcs);
	}
}


Object.freeze(exports);