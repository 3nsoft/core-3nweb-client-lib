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

export namespace cryptoWorkLabels {

	export type LabelType = 'asmail' | 'storage';

	export function makeFor(type: LabelType, id: string): number {
		const low = charsToNumber(id, 0, 5);
		const high = labelToHighNum(type) + charsToNumber(id, 0, 3) & 0x1ffff;
		return (low + (high * 0x100000000));
	}

	function labelToHighNum(type: LabelType): number {
		switch (type) {
			case 'storage':
				return 1 << 17;
			case 'asmail':
				return 2 << 17;
		}
	}

	export function typeOf(label: number): LabelType|undefined {
		switch ((label / 0x100000000) >> 17) {
			case 1:
				return 'storage';
			case 2:
				return 'asmail';
			default:
				return;
		}
	}

	function charsToNumber(s: string, start: number, len: 5|3): number {
		const rounds = Math.max(Math.min(s.length - start, len), 0 );
		let num = 0;
		for (let i=0; i<rounds; i+=1) {
			num ^= s.charCodeAt(i) << (i*7);
		}
		return num;
	}

	export function makeForNonce(type: LabelType, n: Uint8Array): number {
		const low = n[0] + (n[1] << 8) + (n[2] << 16) + (n[3] << 24);
		const high = labelToHighNum(type) +
			(n[4] + (n[5] << 8) + (n[6] << 16)) & 0x1ffff;
		return (low + (high * 0x100000000));
	}

	export function makeRandom(type: LabelType): number {
		const low = (Math.random() * 0xffffffff) & 0xffffffff;
		const high = labelToHighNum(type) +
			(Math.random() * 0x1ffff) & 0x1ffff;
		return (low + (high * 0x100000000));
	}

}
Object.freeze(cryptoWorkLabels);


export abstract class LabeledWorkQueues {

	private readonly workQueues = new Map<number, number>();

	protected addToWorkQueue(workLabel: number): void {
		const inQueue = this.workQueues.get(workLabel);
		this.workQueues.set(workLabel, (inQueue ? inQueue+1 : 1));
	}

	protected removeFromWorkQueue(workLabel: number): void {
		const inQueue = this.workQueues.get(workLabel);
		if (inQueue && (inQueue > 1)) {
			this.workQueues.set(workLabel, inQueue-1);
		} else {
			this.workQueues.delete(workLabel);
		}
	}

	protected abstract idleWorkers(): number;

	canStartUnderWorkLabel(workLabel: number): number {
		const maxIdle = this.idleWorkers() - this.workQueues.size;
		if (maxIdle <= 0) {
			return (this.workQueues.has(workLabel) ? 0 : 1);
		}
		const inQueue = this.workQueues.get(workLabel);
		return (inQueue ? Math.max(0, inQueue) : maxIdle);
	}

	async wrapOpPromise<T>(
		workLabel: number, workOp: Promise<T>
	): Promise<T> {
		this.addToWorkQueue(workLabel);
		try {
			return await workOp;
		} finally {
			this.removeFromWorkQueue(workLabel);
		}
	}

}
Object.freeze(LabeledWorkQueues.prototype);
Object.freeze(LabeledWorkQueues);


export class InProcAsyncExecutor extends LabeledWorkQueues {

	private opsInExec = 0;

	constructor(
		private readonly maxOfRunning = 1
	) {
		super();
		Object.seal(this);
	}

	idleWorkers(): number {
		return Math.max((this.maxOfRunning - this.opsInExec), 0);
	}

	async execOpOnNextTick<T>(workLabel: number, op: () => T): Promise<T> {
		this.opsInExec += 1;
		try {
			return await this.wrapOpPromise(workLabel, onNextTick(op));
		} finally {
			this.opsInExec -= 1;
		}
	}

}
Object.freeze(InProcAsyncExecutor.prototype);
Object.freeze(InProcAsyncExecutor);


export class ExecCounter extends LabeledWorkQueues {

	constructor(
		protected readonly idleWorkers: () => number
	) {
		super();
		Object.seal(this);
	}

}
Object.freeze(ExecCounter.prototype);
Object.freeze(ExecCounter);


async function onNextTick<T>(action: () => T): Promise<T> {
	return new Promise<T>((resolve, reject) => process.nextTick(() => {
		try {
			resolve(action());
		} catch (err) {
			reject(err);
		}
	}));
}


Object.freeze(exports);