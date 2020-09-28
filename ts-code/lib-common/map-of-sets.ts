/*
 Copyright (C) 2017 3NSoft Inc.
 
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

export class MapOfSets<TKey, TValue> {
	
	private map = new Map<TKey, Set<TValue>>();

	constructor() {
		Object.freeze(this);
	}

	get(key: TKey): Set<TValue> | undefined {
		return this.map.get(key);
	}

	add(key: TKey, value: TValue): void {
		let set = this.map.get(key);
		if (set === undefined) {
			set = new Set<TValue>();
			this.map.set(key, set);
		}
		set.add(value);
	}

	remove(key: TKey, value: TValue): void {
		const set = this.map.get(key);
		if (set === undefined) { return; }
		set.delete(value);
		if (set.size === 0) {
			this.map.delete(key);
		}
	}

	removeAll(key: TKey): void {
		this.map.delete(key);
	}

	clear(): void {
		this.map.clear();
	}

}
Object.freeze(MapOfSets.prototype);
Object.freeze(MapOfSets);

Object.freeze(exports);