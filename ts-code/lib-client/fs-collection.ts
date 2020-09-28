/*
 Copyright (C) 2017 - 2018 3NSoft Inc.

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

import { Subject, Observer as RxObserver } from 'rxjs';
import { markTransferable } from '../lib-common/mark-transferable';

type FSCollection = web3n.files.FSCollection;
type FSItem = web3n.files.FSItem;
type AsyncIterator<T> = web3n.AsyncIterator<T>;
type CollectionEvent = web3n.files.CollectionEvent;
type Observer<T> = web3n.Observer<T>;

class FSItemsCollection {

	private items = new Map<string, FSItem>();

	private changesBroadcast = new Subject<CollectionEvent>();
	private change$ = this.changesBroadcast.asObservable();

	async set(name: string, item: FSItem): Promise<void> {
		if (this.items.has(name)) { throw new Error(
			`FS item with name ${name} is already set in this collection.`); }
		this.items.set(name, item);
		this.changesBroadcast.next({
			type: 'entry-addition',
			item,
			path: name,
		});
	}

	async remove(name: string): Promise<boolean> {
		if (!this.items.delete(name)) { return false; }
		this.changesBroadcast.next({
			type: 'entry-removal',
			path: name,
		});
		return true;
	}

	async clear(): Promise<void> {
		this.items.clear();
		this.changesBroadcast.next({
			type: 'entry-removal',
		});
	}

	async get(name: string): Promise<FSItem|undefined> {
		return this.items.get(name);
	}

	async entries(): Promise<AsyncIterator<[ string, FSItem ]>> {
		const iter = this.items.entries();
		const asyncIter: AsyncIterator<[ string, FSItem ]> = {
			next: async () => iter.next()
		};
		return markTransferable(asyncIter, 'SimpleObject');
	}

	async getAll(): Promise<[ string, FSItem ][]> {
		const allItems: [ string, FSItem ][] = [];
		for (const nameAndItem of this.items.entries()) {
			allItems.push(nameAndItem);
		}
		return allItems;
	}

	watch(observer: Observer<CollectionEvent>): () => void {
		const sub = this.change$.subscribe(observer as RxObserver<CollectionEvent>);
		return () => sub.unsubscribe();
	}

	wrap(): FSCollection {
		const w: FSCollection = {
			get: this.get.bind(this),
			getAll: this.getAll.bind(this),
			entries: this.entries.bind(this),
			watch: this.watch.bind(this),
			clear: this.clear.bind(this),
			remove: this.remove.bind(this),
			set: this.set.bind(this)
		};
		return Object.freeze(markTransferable(w, 'FSCollection'));
	}

}
Object.freeze(FSItemsCollection.prototype);
Object.freeze(FSItemsCollection);

export function readonlyWrapFSCollection(c: FSCollection): FSCollection {
	const w: FSCollection = {
		get: c.get,
		getAll: c.getAll,
		entries: c.entries,
		watch: c.watch,
	};
	return Object.freeze(markTransferable(w, 'FSCollection'));
}

export function makeFSCollection(): FSCollection {
	return (new FSItemsCollection()).wrap();
}

Object.freeze(exports);