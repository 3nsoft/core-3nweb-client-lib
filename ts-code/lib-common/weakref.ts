/*
 Copyright (C) 2019, 2021 3NSoft Inc.
 
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

export interface WeakReference<T> {
	addCallback(cb: Function): void;
	removeCallback(cb: Function): void;
	removeCallbacks(): void;
	get(): T|undefined;
}

type WeakRef<T> = {
	new(o: T);
	deref(): T|undefined;
};
declare var WeakRef: WeakRef<any>;
type FinalizationRegistry = {
	new(cb: Function);
	register(o: any): void;
};
declare var FinalizationRegistry: FinalizationRegistry;

export function makeWeakRefFor<T>(o: T): WeakReference<T> {
	if ((typeof WeakRef !== 'undefined')
	&& (typeof FinalizationRegistry !== 'undefined')) {
		return new WeakRefInbuiltImpl(o);
	} else {
		throw new Error(`Weak reference are not available`);
	}
}


class WeakRefInbuiltImpl<T> implements WeakReference<T> {

	private readonly ref: WeakRef<T>;
	private readonly registry: FinalizationRegistry;
	private readonly callbacks: Function[] = [];

	constructor (o: T) {
		this.ref = new WeakRef(o);
		this.registry = new FinalizationRegistry(this.makeCleanupCallback());
		Object.freeze(this);
	}

	private makeCleanupCallback(): (() => void) {
		return () => {
			for (const cb of this.callbacks) {
				try {
					cb();
				} catch (err) {
					console.error(err);
				}
			}
		};
	}

	addCallback(cb: Function): void {
		this.callbacks.push(cb);
	}

	removeCallback(cb: Function): void {
		const ind = this.callbacks.indexOf(cb);
		if (ind >= 0) {
			this.callbacks.splice(ind, 1);
		}
	}

	removeCallbacks(): void {
		this.callbacks.splice(0, this.callbacks.length);
	}

	get(): T|undefined {
		return this.ref.deref();
	}

}
Object.freeze(WeakRefInbuiltImpl.prototype);
Object.freeze(WeakRefInbuiltImpl);


Object.freeze(exports);