/*
 Copyright (C) 2022 3NSoft Inc.
 
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

import { assert } from "../assert";


export interface Task<PoolLabel extends string> {
	neededExecutor(): PoolLabel|undefined;
	process(): Promise<void>;
	cancel(): Promise<void>;
}


class ProcessingPool<PoolLabel extends string> {

	private readonly inProcess = new Set<Promise<void>>();
	private readonly queue: Task<PoolLabel>[] = [];
	public isRunning = false;

	constructor(
		public readonly label: PoolLabel,
		private readonly maxProcs: number,
		private readonly logError?: (err: any, msg?: string) => Promise<void>
	) {
		Object.seal(this);
	}

	add(task: Task<any>): void {
		this.queue.push(task);
		if (this.isRunning) {
			this.processNextQueued();
		}
	}

	private async processNextQueued(): Promise<void> {
		if (!this.isRunning || (this.inProcess.size >= this.maxProcs)) { return; }
		const task = this.queue.shift();
		if (!task) { return; }
		if (task.neededExecutor() !== this.label) {
			return this.processNextQueued();
		}
		let proc: Promise<void>|undefined = undefined;
		try {
			proc = task.process().catch(this.doOnError);
			this.inProcess.add(proc);
			await proc;
		} catch (err) {
			await this.doOnError(err);
		} finally {
			if (proc) {
				this.inProcess.delete(proc);
			}
		}	
		return this.processNextQueued();
	}

	pause(): void {
		this.isRunning = false;
	}

	start(): void {
		this.isRunning = true;
		const triggerCount = Math.min(this.maxProcs, this.queue.length);
		for (let i=0; i<triggerCount; i+=1) {
			this.processNextQueued();
		}
	}

	private readonly doOnError = async (err: any): Promise<void> => {
		if (this.logError) {
			await this.logError(err, `Error in pool ${this.label}`);
		}
	};

	async stop(): Promise<void> {
		if (!this.isRunning) { return; }
		this.isRunning = false;
		const cancellations = this.queue.splice(0, this.queue.length)
		.map(t => t.cancel().catch(this.doOnError));
		await Promise.all(cancellations.concat(Array.from(this.inProcess)));
	}

}
Object.freeze(ProcessingPool.prototype);
Object.freeze(ProcessingPool);


export class LabelledExecPools<PoolLabel extends string> {

	private readonly pools = new Map<PoolLabel, ProcessingPool<PoolLabel>>();
	private isRunning = false;

	constructor(
		setup: { label: PoolLabel; maxProcs: number; }[],
		logError?: ProcessingPool<PoolLabel>['logError']
	) {
		assert(setup.length > 0);
		for (const { label, maxProcs } of setup) {
			const pool = new ProcessingPool(label, maxProcs, logError);
			this.pools.set(pool.label, pool);
		}
		Object.seal(this);
	}

	add(task: Task<PoolLabel>, queueIfNotRunning = false): void {
		if (!this.isRunning && !queueIfNotRunning) { return; }
		const label = task.neededExecutor();
		if (!label) { return; }
		const pool = this.pools.get(label);
		if (!pool) { throw new Error(`Task needs unknown pool ${label}`); }
		pool.add(task);
	}

	start(): void {
		if (this.isRunning) { return; }
		this.isRunning = true;
		for (const pool of this.pools.values()) {
			pool.start();
		}
	}

	pause(): void {
		this.isRunning = false;
	}

	async stop(): Promise<void> {
		if (!this.isRunning) { return; }
		this.isRunning = false;
		const cancelations = Array.from(this.pools.values())
		.map(pool => pool.stop());
		await Promise.all(cancelations);
	}

}
Object.freeze(ProcessingPool.prototype);
Object.freeze(ProcessingPool);


Object.freeze(exports);