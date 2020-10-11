/*
 Copyright (C) 2019 3NSoft Inc.
 
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

import * as weak from 'weak-napi';

export class WeakRef<T> {

	private constructor (
		private readonly ref: T
	) {
		Object.freeze(this);
	}

	static makeFor<T>(o: T): WeakRef<T> {
		return new WeakRef<T>(weak(o));
	}

	addCallback(cb: Function): void {
		weak.addCallback(this.ref, cb);
	}

	removeCallback(cb: Function): void {
		weak.removeCallback(this.ref, cb);
	}

	removeCallbacks(): void {
		weak.removeCallbacks(this.ref);
	}

	get(): T|undefined {
		return weak.get(this.ref);
	}

	isDead(): boolean {
		return weak.isDead(this.ref);
	}

}
Object.freeze(WeakRef.prototype);
Object.freeze(WeakRef);


Object.freeze(exports);