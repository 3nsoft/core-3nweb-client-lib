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

export async function asyncIteration<T>(iter: web3n.AsyncIterator<T>,
		func: (v: T) => Promise<void>): Promise<void> {
	let item: IteratorResult<T>;
	do {
		item = await iter.next();
		if (item.done) { return; }
		await func(item.value);
	} while (true);
}

export async function asyncFind<T>(iter: web3n.AsyncIterator<T>,
		predicate: (v: T) => Promise<boolean>): Promise<T|undefined> {
	let item: IteratorResult<T>;
	do {
		item = await iter.next();
		if (item.done) { return; }
		if (await predicate(item.value)) { return item.value; }
	} while (true);
}

Object.freeze(exports);