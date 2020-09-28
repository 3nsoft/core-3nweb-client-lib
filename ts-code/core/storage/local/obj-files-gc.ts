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
import { SingleProc } from '../../../lib-common/processes';
import { join } from 'path';
import { LocalObj } from './obj-files';


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
		if (this.gcProc.getP()) { return; }
		this.gcProc.start(this.objCollecting);
	};

	private objCollecting = async (): Promise<void> => {
		if (this.wip.size === 0) {
			[ this.wip, this.scheduled ] = [ this.scheduled, this.wip ];
		}
		const obj = getAndRemoveOneFrom(this.wip);
		if (!obj) { return; }

		// calculate versions that should not be removed
		const { gcMaxVer, nonGarbage } = obj.getNonGarbageVersions();

		// if object is set archived, and there is nothing in it worth keeping,
		// whole folder can be removed
		if (obj.isArchived()) {
			if (nonGarbage.size === 0) {
				this.rmObjFromCache(obj);
				if (obj.objId) {
					await this.rmObjFolder(obj.objId);
				}
				return;
			}
		}

		// for all other cases, we remove version files that are not worth
		// keeping.
		const lst = await fs.readdir(obj.objFolder);
		const rmProcs: Promise<void>[] = [];
		for (const f of lst) {
			const ver = parseInt(f);
			if (isNaN(ver) || nonGarbage.has(ver)
			|| (gcMaxVer && (ver >= gcMaxVer))) { continue; }
			rmProcs.push(fs.unlink(join(obj.objFolder, f)).catch(() => {}));
		}
		while (rmProcs.length > 0) {
			await rmProcs.pop();
		}
		return this.objCollecting();
	}

}
Object.freeze(GC.prototype);
Object.freeze(GC);


function getAndRemoveOneFrom<T>(set: Set<T>): T|undefined {
	const iter = set.values();
	const { value, done } = iter.next();
	if (done) { return; }
	set.delete(value);
	return value;
}

Object.freeze(exports);