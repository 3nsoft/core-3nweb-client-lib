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
 this program. If not, see <http://www.gnu.org/licenses/>.
*/


export interface TimedCache<TKey, TVal> {

	get(key: TKey): TVal|undefined;

	has(key: TKey): boolean;

	resetLifeTimeOf(key: TKey): boolean;

	set(key: TKey, val: TVal): void;

	delete(key: TKey): void;

	keys(): TKey[];

	clear(): void;

	destroy(): void;

}

export function makeTimedCache<TKey, TVal>(
	millis: number
): TimedCache<TKey, TVal> {
	return new CacheConstructor(millis);
}

// not all embeddings have js weak references, and this is captured be calling
// fallable require inside the function and with a fallback option
const CacheConstructor = (function() {
	try {
		return require('./weak-cache').WeakCacheWithMinLifeTime;
	} catch (err) {
		return require('./timed-non-weak-cache').TimeWindowCache;
	}
})();


Object.freeze(exports);