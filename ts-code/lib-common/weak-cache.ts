/*
 Copyright (C) 2016 - 2019, 2021 3NSoft Inc.
 
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

import { WeakReference, makeWeakRefFor } from './weakref';
import { TimedCache } from './timed-cache';


// XXX WeakReference shields choice between inbuilt and napi implementations of
// weaks. But inbuilt uses FinalizationRegistry, which is better used in cache
// directly. Take a look at following code:
// let registry = new FinalizationRegistry(key => { ... removes WeakRef });
// registry.register(val, key, val);
// ... on delete do: registry.unregister(val);
// Note that our WeakReference wrap has its own FinalizationRegistry, making it
// heavier.
export class WeakCache<TKey, TVal> {

	private readonly wRefs = new Map<TKey, WeakReference<TVal>>();

	constructor() {
		Object.freeze(this);
	}

	get(key: TKey): TVal|undefined {
		const wRef = this.wRefs.get(key);
		if (wRef) {
			const v = wRef.get();
			if (v === undefined) {
				this.wRefs.delete(key);
			} else {
				return v;
			}
		}
		return;	// explicit return of undefined
	}

	has(key: TKey): boolean {
		return (this.get(key) !== undefined);
	}

	set(key: TKey, val: TVal): void {
		const wRef = makeWeakRefFor(val);
		wRef.addCallback(this.makeCB(key, wRef));
		this.wRefs.set(key, wRef);
	}

	private makeCB(key: TKey, wRef: WeakReference<TVal>): Function {
		return () => {
			if (wRef === this.wRefs.get(key)) {
				this.wRefs.delete(key);
			}
		}
	}

	delete(key: TKey): void {
		this.wRefs.delete(key);
	}

	clear(): void {
		this.wRefs.clear();
	}

}
Object.freeze(WeakCache.prototype);
Object.freeze(WeakCache);


export class WeakCacheWithMinLifeTime<TKey, TVal>
implements TimedCache<TKey, TVal> {

	private readonly wCache = new WeakCache<TKey, TVal>();

	private filling: Map<TKey, TVal> = new Map<TKey, TVal>();
	private waiting: Map<TKey, TVal> = new Map<TKey, TVal>();
	private interval: NodeJS.Timer;

	constructor(millis: number) {
		this.interval = setInterval(
			() => { this.dropAndRotate(); }, millis);
		this.interval.unref();
		Object.seal(this);
	}

	private dropAndRotate(): void {
		this.waiting.clear();
		const b = this.waiting;
		this.waiting = this.filling;
		this.filling = b;
	}

	get(key: TKey): TVal|undefined {
		let v = this.filling.get(key);
		if (v !== undefined) { return v; }
		v = this.waiting.get(key);
		if (v !== undefined) {
			this.filling.set(key, v);
			return v;
		}
		v = this.wCache.get(key);
		if (v !== undefined) {
			this.filling.set(key, v);
		}
		return v;
	}

	has(key: TKey): boolean {
		return (this.get(key) !== undefined);
	}

	resetLifeTimeOf(key: TKey): boolean {
		// it is like has(), but we want an explicit name of a side-effect one
		// may want produce, cause c.has(k) somewhere may be puzzling.
		return (this.get(key) !== undefined);
	}

	set(key: TKey, val: TVal): void {
		this.filling.set(key, val);
		this.wCache.set(key, val);
	}

	delete(key: TKey): void {
		this.filling.delete(key);
		this.waiting.delete(key);
		this.wCache.delete(key);
	}

	clear(): void {
		this.filling.clear();
		this.waiting.clear();
		this.wCache.clear();
	}

	destroy(): void {
		if (!this.interval) { return; }
		clearInterval(this.interval);
		this.interval = (undefined as any);
		this.filling = (undefined as any);
		this.waiting = (undefined as any);
	}

}
Object.freeze(WeakCacheWithMinLifeTime.prototype);
Object.freeze(WeakCacheWithMinLifeTime);


Object.freeze(exports);