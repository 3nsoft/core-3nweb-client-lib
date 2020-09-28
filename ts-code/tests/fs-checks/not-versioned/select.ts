/*
 Copyright (C) 2018, 2020 3NSoft Inc.
 
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

import { SpecDescribe } from '../../libs-for-tests/spec-module';
import { SpecIt } from '../test-utils';

type FileException = web3n.files.FileException;

export const specs: SpecDescribe = {
	description: '.select',
	its: []
};

let it: SpecIt = { expectation: 'fails early for non-existent path' };
it.func = async function(s) {
	const { testFS } = s;
	let path = 'unknown-folder';
	expect(await testFS.checkFolderPresence(path)).toBe(false);
	await testFS.select(path, { name: '*.png', action: 'include' })
	.then(() => {
		fail('select must fail, when folder does not exist');
	}, (err: FileException) => {
		expect(err.notFound).toBe(true);
		if (!err.notFound) { throw err; }
	});
};
specs.its.push(it);

it = { expectation: 'selects entities in a file tree' };
it.func = async function(s) {
	const { testFS } = s;
	const path = 'testing select';
	await testFS.makeFolder(path);
	// setup files
	const filePaths: string[] = [
		'some.zip', 'some/some/sOME.zip', '1/Some-folder/3.zip',
		'else.txt', 'else/else/some.txt', 'else.zip/some.txt'
	];
	for (const fPath of filePaths) {
		await testFS.writeTxtFile(`${path}/${fPath}`, '');
	}

	// select *.zip files
	let criteria: web3n.files.SelectCriteria = {
		name: '*.zip',
		type: 'file',
		action: 'include',
	};
	let { items, completion } = await testFS.select(path, criteria);

	expect(typeof completion.catch).toBe('function');
	expect(typeof completion.then).toBe('function');

	// wait till collection process is done
	await completion;

	let found = await items.getAll();
	expect(found.length).toBe(3);
	for (const [ name, item ] of found) {
		expect(name.endsWith('.zip')).toBe(true);
		expect(item.isFile).toBe(true);
		expect(item.location!.path).toBe(name, `name key for item in collection is the same as path, to ensure uniqueness`);
		expect(filePaths.includes(name.substring(1))).toBeTruthy();
		expect(item.location!.storageType).toBeFalsy();
		expect(item.location!.storageUse).toBeFalsy();
		expect(item.location!.fs.writable).toBe(false);
	}

	// select *.zip folder
	criteria.type = 'folder';
	({ items, completion } = await testFS.select(path, criteria));
	await completion;
	found = await items.getAll();
	expect(found.length).toBe(1);
	expect(found[0][0].endsWith('.zip')).toBe(true);
	expect(found[0][1].isFolder).toBe(true);

	// select folders else
	criteria = {
		name: {
			p: 'else',
			type: 'exact'
		},
		type: 'folder',
		action: 'include',
	};
	({ items, completion } = await testFS.select(path, criteria));
	await completion;
	found = await items.getAll();
	expect(found.length).toBe(2);
	expect(found[0][0].endsWith('/else')).toBe(true);
	expect(found[0][1].isFolder).toBe(true);

	// select all with o and e in the name
	criteria = {
		name: '*o*e*',
		action: 'include',
	};
	({ items, completion } = await testFS.select(path, criteria));
	await completion;
	found = await items.getAll();
	expect(found.length).toBe(7);

	// select all folders
	criteria = {
		name: '*',
		type: 'folder',
		action: 'include',
	};
	({ items, completion } = await testFS.select(path, criteria));
	await completion;
	found = await items.getAll();
	expect(found.length).toBe(7);
};
specs.its.push(it);


Object.freeze(exports);