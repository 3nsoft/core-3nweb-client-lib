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

import { SynchronizerOnObjId, SyncedObj, } from './obj-files';
import { SingleProc } from '../../../lib-common/processes/synced';
import * as fs from '../../../lib-common/async-fs-node';
import { join } from 'path';


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
		private readonly rmObjFolder: (objId: string) => Promise<void>
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
		// calculate versions that should not be removed
		const { gcMaxVer, nonGarbage } = obj.getNonGarbageVersions();

		// if object is set archived, and there is nothing in it worth keeping,
		// whole folder can be removed
		if ((nonGarbage.size === 0)
		&& obj.isArchived() && obj.sync().isSyncDone()) {
			if (!obj.isStatusFileSaved()) {
				return;
			}
			this.rmObjFromCache(obj);
			if (obj.objId) {
				await this.rmObjFolder(obj.objId);
			}
			return;
		}

		// for all other cases, we remove version files that are not worth
		// keeping.
		const lst = await fs.readdir(obj.objFolder).catch(noop);
		if (!lst) { return; }
		const rmProcs: Promise<void>[] = [];
		for (const f of lst) {
			const ver = parseInt(f);
			if (isNaN(ver) || nonGarbage.has(ver)
			|| (gcMaxVer && (ver >= gcMaxVer))) { continue; }
			rmProcs.push(fs.unlink(join(obj.objFolder, f)).catch(noop));
		}
		if (rmProcs.length > 0) {
			await Promise.all(rmProcs);
		}
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

function noop() {}


Object.freeze(exports);