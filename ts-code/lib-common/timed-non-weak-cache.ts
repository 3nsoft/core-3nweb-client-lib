/*
 Copyright (C) 2016 - 2017, 2020 3NSoft Inc.
 
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

import { TimedCache } from "./timed-cache";

export class TimeWindowCache<TKey, TVal> implements TimedCache<TKey, TVal> {
	private filling: Map<TKey, TVal> = new Map<TKey, TVal>();
	private waiting: Map<TKey, TVal> = new Map<TKey, TVal>();
	private interval: NodeJS.Timer|void;

	constructor(
		periodMillis: number,
	) {
		this.interval = setInterval(() => this.dropAndRotate(), periodMillis)
		.unref();
		Object.seal(this);
	}

	private dropAndRotate(): void {
		this.waiting.clear();
		const b = this.waiting;
		this.waiting = this.filling;
		this.filling = b;
	}

	resetLifeTimeOf(key: TKey): boolean {
		// it is like has(), but we want an explicit name of a side-effect one
		// may want produce, cause c.has(k) somewhere may be puzzling.
		return (this.get(key) !== undefined);
	}

	get(key: TKey): TVal | undefined {
		let v = this.filling.get(key);
		if (v !== undefined) { return v; }
		v = this.waiting.get(key);
		if (v !== undefined) {
			this.waiting.delete(key);
			this.filling.set(key, v);
		}
		return v
	}

	has(key: TKey): boolean {
		return (this.get(key) !== undefined);
	}

	set(key: TKey, val: TVal): void {
		this.filling.set(key, val);
	}

	delete(key: TKey): void {
		this.filling.delete(key);
		this.waiting.delete(key);
	}

	keys(): TKey[] {
		const allKeys: TKey[] = [];
		for (const key of this.filling.keys()) {
			allKeys.push(key);
		}
		for (const key of this.waiting.keys()) {
			allKeys.push(key);
		}
		return allKeys;
	}

	clear(): void {
		this.filling.clear();
		this.waiting.clear();
	}

	destroy() {
		if (!this.interval) { return; }
		clearInterval(this.interval);
		this.interval = undefined;
		this.filling = (undefined as any);
		this.waiting = (undefined as any);
	}

}
Object.freeze(TimeWindowCache.prototype);
Object.freeze(TimeWindowCache);


Object.freeze(exports);