/*
 Copyright (C) 2020 3NSoft Inc.

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

import { SynchronizerOnObjId, SyncedObj } from './obj-files';
import { SingleProc } from '../../../lib-common/processes';


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
		if (this.gcProc.getP()) { return; }
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

		// XXX


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