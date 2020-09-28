/*
 Copyright (C) 2018 3NSoft Inc.

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

import { makeFSCollection } from './fs-collection';
import { posix } from 'path';

type FileException = web3n.files.FileException;
type ReadonlyFS = web3n.files.ReadonlyFS;
type SelectCriteria = web3n.files.SelectCriteria;
type FSCollection = web3n.files.FSCollection;
type FSItem = web3n.files.FSItem;
type ListingEntry = web3n.files.ListingEntry;

export async function selectInFS(fs: ReadonlyFS, path: string,
		criteria: SelectCriteria):
		Promise<{ items: FSCollection; completion: Promise<void>; }> {
	// besides limiting fs to path, turning fs into readonly subroot ensures
	// that fs object is a wrapped view and doesn't leak internals, 
	fs = await fs.readonlySubRoot(path);

	const items = makeFSCollection();
	const iterCB = (parentPath: string, entry: ListingEntry): void => {
		if (match(entry, criteria)) {
			if (criteria.action === 'include') {
				const path = posix.join(parentPath, entry.name);
				items.set!(path, fsItemFor(fs, path, entry));
			}
		} else {
			if (criteria.action === 'exclude') {
				const path = posix.join(parentPath, entry.name);
				items.set!(path, fsItemFor(fs, parentPath, entry));
			}
		}
	};
	const completion = deepIter(fs, '/', iterCB, criteria.depth);
	return { items, completion };
}

function match(entry: ListingEntry, criteria: SelectCriteria): boolean {
	if (!matchType(entry, criteria.type)) { return false; }
	if (typeof criteria.name === 'string') {
		return matchNamePattern(entry.name, criteria.name);
	} else if (criteria.name.type === 'pattern') {
		return matchNamePattern(entry.name, criteria.name.p);
	} else if (criteria.name.type === 'regexp') {
		return !!entry.name.match(criteria.name.p);
	} else if (criteria.name.type === 'exact') {
		return (criteria.name.p === entry.name);
	}
	return false;
}

function matchNamePattern(name: string, p: string): boolean {
	p = p.toLowerCase();
	name = name.toLowerCase();
	const sections = p.split('*');
	if (sections.length === 1) { return (name === p); }
	let pos = 0;
	for (let i=0; i<sections.length; i+=1) {
		const section = sections[i];
		if (section.length === 0) { continue; }
		if (i === 0) {
			if (!name.startsWith(section)) { return false; }
			pos += section.length;
			continue;
		}
		if ((i+1) === sections.length) {
			return name.substring(pos).endsWith(section);
		}
		const secPos = name.substring(pos).indexOf(section);
		if (secPos < 0) { return false; }
		pos += secPos + section.length;
	}
	return true;
}

function matchType(entry: ListingEntry, type: SelectCriteria['type']): boolean {
	if (!type) { return true; }
	const entryType: SelectCriteria['type'] =
		(entry.isFile ? 'file' : (entry.isFolder ? 'folder' : 'link'));
	return (Array.isArray(type) ?
		type.includes(entryType) : (type === entryType));
}

function fsItemFor(fs: ReadonlyFS, path: string, entry: ListingEntry):
		FSItem {
	return {
		isFile: entry.isFile,
		isFolder: entry.isFolder,
		isLink: entry.isLink,
		location: { fs, path },
	};
}

async function deepIter(fs: ReadonlyFS, path: string,
		cb: (parent: string, entry: ListingEntry) => void,
		depth?: number): Promise<void> {
	const lst = await fs.listFolder(path);
	for (const entry of lst) {
		cb(path, entry);
		if (entry.isFolder && ((depth === undefined) || (depth > 0))) {
			await deepIter(fs, posix.join(path, entry.name), cb,
				(depth === undefined) ? undefined : (depth - 1))
			.catch((exc: FileException) => {
				if ((exc.type !== 'file')
				|| (!exc.notFound && !exc.notDirectory)) { throw exc; }
			});
		}
	}
}


Object.freeze(exports);