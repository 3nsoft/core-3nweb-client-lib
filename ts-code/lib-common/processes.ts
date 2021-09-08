/*
 Copyright (C) 2015, 2017, 2019 - 2021 3NSoft Inc.
 
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

import { errWithCause } from "./exceptions/error";

export function sleep(millis: number): Promise<void> {
	return new Promise<void>((resolve) => {
		setTimeout(resolve, millis).unref();
	});
}

/**
 * This represents a function that will create a promise, potentially starting
 * some background process, only when it is called. Such wrap of code is needed
 * for scheduling, as very often any start of an action must be postponed till
 * later time. Scheduler needs a not-yet-started activity, as scheduler has
 * control action's start.
 */
export type Action<T> = () => Promise<T>;

/**
 * This is a container of processes, labeled by some ids. It allows to track if
 * there is a process already in progress with a given id. And, it allows to
 * chain process, when needed.
 * 
 * Common use of such class is to reuse getting of some expensive resource(s).
 */
export class NamedProcs {
	
	private processes = new Map<string, SingleProc>();
	
	constructor() {
		Object.freeze(this);
	}
	
	/**
	 * @param id is a string key of a process
	 * @return a promise of a process' completion, or undefined, if process with
	 * given id is unknown.
	 */
	getP<T>(id: string): Promise<T> | undefined {
		const proc = this.processes.get(id);
		return (proc ? proc.getP() : undefined);
	}
	
	/**
	 * This method will add a promise of an already started process.
	 * @param id is a string key of a process
	 * @param promise of an already started process
	 * @return a promise of a process' completion.
	 */
	addStarted<T>(id: string, promise: Promise<T>): Promise<T> {
		if (this.getP(id)) { throw new Error(
			'Process with id "'+id+'" is already in progress.'); }
		return this.startOrChain(id, () => promise);
	}
	
	/**
	 * This method will start a given action only, if a process with a given id
	 * is not running.
	 * @param id is a string key of a process
	 * @param action is a function that starts some process
	 * @return a promise of a process' completion.
	 */
	start<T>(id: string, action: Action<T>): Promise<T> {
		if (this.getP(id)) { throw new Error(
			'Process with id "'+id+'" is already in progress.'); }
		return this.startOrChain(id, action);
	}
	
	/**
	 * This method will chain a given action to an already running process, or,
	 * if identified process is not running, this will start given action under
	 * a given id.
	 * @param id is a string key of a process
	 * @param action is a function that starts some process
	 * @return a promise of a process' completion.
	 */
	startOrChain<T>(id: string, action: Action<T>): Promise<T> {
		let proc = this.processes.get(id);
		if (!proc) {
			proc = new SingleProc(() => this.processes.delete(id));
			this.processes.set(id, proc);
		}
		return proc.startOrChain(action);
	}
	
}
Object.freeze(NamedProcs.prototype);
Object.freeze(NamedProcs);


/**
 * This is a container of process. It allows to track if a process is already
 * in progress. It also allows to chain process, when needed.
 * 
 * Common use of such class is to reuse getting of some expensive resource, or
 * do ning something as an exclusive process.
 */
export class SingleProc {
	
	private actions: {
		action: Action<any>;
		deferred: Deferred<any>;
	}[] = [];
	private running = false;
	
	constructor(
		private onGoingIdle?: () => void
	) {
		Object.seal(this);
	}
	
	getP<T>(): Promise<T>|undefined {
		return ((this.actions.length === 0) ?
			undefined :
			this.actions[this.actions.length-1].deferred.promise);
	}
	
	addStarted<T>(promise: Promise<T>): Promise<T> {
		if (this.actions.length > 0) { throw new Error(
			'Process is already in progress.'); }
		return this.startOrChain(() => promise);
	}
	
	start<T>(action: Action<T>): Promise<T> {
		if (this.actions.length > 0) { throw new Error(
			'Process is already in progress.'); }
		return this.startOrChain(action);
	}

	private async runIfIdle(): Promise<void> {
		if (this.running) { return; }
		this.running = true;
		while (this.actions.length > 0) {
			const { action, deferred } = this.actions[0];
			try {
				const res = await action();
				deferred.resolve(res);
			} catch (err) {
				deferred.reject(err);
			}
			this.actions.shift();
		}
		this.running = false;
		// paranoid check after seeing LiquidCore 0.7.10 on iOS
		if (this.actions.length > 0) {
			return this.runIfIdle();
		}
		// when listener is used, like with NamedPcos
		if (this.onGoingIdle) {
			this.onGoingIdle();
		}
	}
	
	startOrChain<T>(action: Action<T>): Promise<T> {
		const deferred = defer<T>();
		this.actions.push({ action, deferred });
		this.runIfIdle();
		return deferred.promise;
	}
	
}
Object.freeze(SingleProc.prototype);
Object.freeze(SingleProc);


export class DeduppedRunner<T> {

	private proc: Promise<T>|undefined = undefined;
	private waiting: Deferred<T>|undefined = undefined;
	
	constructor(
		private readonly action: Action<T>
	) {
		Object.seal(this);
	}

	trigger(): Promise<T> {
		if (this.proc) {
			if (!this.waiting) {
				this.waiting = defer();
			}
			return this.waiting.promise;
		} else {
			this.proc = this.startAction();
			return this.proc;
		}
	}

	private async startAction(): Promise<T> {
		const deferredBeforeStart = this.waiting;
		this.waiting = undefined;
		try {
			const result = await this.action();
			if (deferredBeforeStart) {
				deferredBeforeStart.resolve(result);
			}
			return result;
		} catch (err) {
			if (deferredBeforeStart) {
				deferredBeforeStart.reject(err);
			}
			throw err;
		} finally {
			this.proc = undefined;
			if (this.waiting) {
				this.proc = this.startAction();
			}
		}
	}

}
Object.freeze(DeduppedRunner.prototype);
Object.freeze(DeduppedRunner);


/**
 * This wraps given function/method into syncing wrap.
 */
export function makeSyncedFunc<T extends Function>(
	syncProc: SingleProc, thisArg: any, func: T
): T {
	return ((...args) => syncProc.startOrChain(() => func.apply(thisArg, args))) as any as T;
}


export interface Deferred<T> {
	promise: Promise<T>;
	resolve: (result?: T|PromiseLike<T>) => void;
	reject: (err: any) => void;
}

export function defer<T>(): Deferred<T> {
	const d = <Deferred<T>> {};
	d.promise = new Promise<T>((resolve, reject) => {
		d.resolve = resolve;
		d.reject = reject;
	});
	Object.freeze(d);
	return d;
}


export class PressureValve {

	private stopper: Deferred<void>|undefined = undefined;

	constructor() {
		Object.seal(this);
	}

	toggle(flag: boolean): void {
		if (flag) {
			if (this.stopper) { return; }
			this.stopper = defer();
		} else {
			if (!this.stopper) { return; }
			this.stopper.resolve();
			this.stopper = undefined;
		}
	}

	pressWithError(err: any): void {
		this.toggle(true);
		this.stopper!.reject(errWithCause(err, `Backpressure error`));
	}

	readonly pressure = async (): Promise<void> => {
		if (!this.stopper) { return; }
		await this.stopper.promise;
	}

}
Object.freeze(PressureValve.prototype);
Object.freeze(PressureValve);


export function callWithTimeout<T>(
	f: () => Promise<T>, timeout: number, timeoutErr: () => any
): Promise<T> {
	let isDone = false;
	const deferred = defer<T>();
	f().then(res => {
		if (isDone) { return; }
		isDone = true;
		deferred.resolve(res);
	}, err => {
		if (isDone) { return; }
		isDone = true;
		deferred.reject(err);
	});
	sleep(timeout).then(() => {
		if (isDone) { return; }
		isDone = true;
		const err = timeoutErr();
		if (err) {
			deferred.reject(err);
		}
	});
	return deferred.promise;
}


export class Worker<T> {

	private readonly queue: T[] = [];
	private readonly set = new Set<T>();
	private isRunning = false;
	private readonly procs: Promise<void>[] = [];
	private maxProcs = 1;

	constructor(
		private readonly process: (w: T) => Promise<void>,
		private readonly stopPendingIn: (queue: T[]) => Promise<void>
	) {
		Object.seal(this);
	}

	add(w: T, queueIfNotRunning = false): void {
		if (this.isRunning) {
			this.addToQueueOnce(w);
			this.runQueued();
		} else if (queueIfNotRunning) {
			this.addToQueueOnce(w);
		}
	}

	private addToQueueOnce(w: T): void {
		if (!this.set.has(w)) {
			this.queue.push(w);
			this.set.add(w);
		}
	}

	private getFromQueueHead(): T|undefined {
		const w = this.queue.shift();
		if (!w) { return; }
		this.set.delete(w);
		return w;
	}

	private async runQueued(): Promise<void> {
		if (!this.isRunning || (this.procs.length >= this.maxProcs)) { return; }
		const w = this.getFromQueueHead();
		if (!w) { return; }
		const proc = this.process(w);
		this.procs.push(proc);
		try {
			await proc;
		} finally {
			const i = this.procs.indexOf(proc);
			if (i >= 0) {
				this.procs.splice(i, 1);
			}
			this.runQueued();
		}
	}

	start(maxNumOfProcs: number): void {
		this.maxProcs = maxNumOfProcs;
		this.isRunning = true;
		this.runQueued();
	}

	pause(): void {
		this.isRunning = false;
	}

	async stop(): Promise<void> {
		this.isRunning = false;
		const queue = this.queue.splice(0, this.queue.length);
		this.set.clear();
		await this.stopPendingIn(queue);
		while (this.procs.length > 0) {
			await this.procs.pop();
		}
	}

}
Object.freeze(Worker.prototype);
Object.freeze(Worker);


Object.freeze(exports);