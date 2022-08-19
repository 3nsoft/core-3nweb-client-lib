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

import * as fs from '../../../lib-common/async-fs-node';
import { SingleProc } from '../../../lib-common/processes/synced';
import { join } from 'path';
import { LocalObj } from './obj-files';
import { getAndRemoveOneFrom, noop } from '../common/utils';
import { NonGarbage } from './obj-status';


export class GC {

	/**
	 * All gc steps are done in this process.
	 */
	private readonly gcProc = new SingleProc();

	/**
	 * wip are objects that are currently processed. When wip set is empty,
	 * it gets swapped with non-empty scheduled set. 
	 */
	private wip = new Set<LocalObj>();

	/**
	 * scheduled is a set for incoming ids that may need gc. It gets swapped
	 * with wip set.
	 */
	private scheduled = new Set<LocalObj>();

	constructor(
		private readonly rmObjFromCache: (obj: LocalObj) => void,
		private readonly rmObjFolder: (objId: string) => Promise<void>
	) {
		Object.seal(this);
	}

	scheduleCollection = (obj: LocalObj): void => {
		this.scheduled.add(obj);
		if (this.gcProc.isProcessing()) { return; }
		this.gcProc.start(this.objCollecting);
	};

	private objCollecting = async (): Promise<void> => {
		if (this.wip.size === 0) {
			[ this.wip, this.scheduled ] = [ this.scheduled, this.wip ];
		}
		const obj = getAndRemoveOneFrom(this.wip);
		if (!obj) { return; }
		try {
			await this.collectIn(obj);
		} catch (err) {}
		return this.objCollecting();
	}

	private async collectIn(obj: LocalObj): Promise<void> {
		const nonGarbage = obj.statusObj().getNonGarbageVersions();
		if (!(await this.checkAndRemoveWholeObjFolder(obj, nonGarbage))) {
			await removeGarbageFiles(obj, nonGarbage)
		}
	}

	private async checkAndRemoveWholeObjFolder(
		obj: LocalObj, { nonGarbage }: NonGarbage
	): Promise<boolean> {
		// if object is set archived, and there is nothing in it worth keeping,
		// whole folder can be removed
		if (obj.objId
		&& obj.statusObj().isArchived()
		&& (nonGarbage.size === 0)) {
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


async function removeGarbageFiles(
	obj: LocalObj, nonGarbage: NonGarbage
): Promise<void> {
	const lst = await fs.readdir(obj.objFolder);
	const rmProcs: Promise<void>[] = [];
	for (const f of lst) {
		if (canGC(f, nonGarbage)) {
			rmProcs.push(fs.unlink(join(obj.objFolder, f)).catch(noop));
		}
	}
	if (rmProcs.length > 0) {
		await Promise.all(rmProcs);
	}
}

function canGC(f: string, { gcMaxVer, nonGarbage }: NonGarbage): boolean {
	const ver = parseInt(f);
	if (isNaN(ver)) {
		return false;
	} else if (!nonGarbage.has(ver)
	&& (!gcMaxVer || (ver < gcMaxVer))) {
		return true;
	} else {
		return false;
	}
}


Object.freeze(exports);