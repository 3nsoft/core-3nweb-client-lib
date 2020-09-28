/*
 Copyright (C) 2016, 2018, 2020 3NSoft Inc.
 
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
import { deepEqual } from '../../libs-for-tests/json-equal';
import { SpecIt } from '../test-utils';

type FileException = web3n.files.FileException;

export const specs: SpecDescribe = {
	description: '.listFolder',
	its: []
};

let it: SpecIt = { expectation: 'lists root' };
it.func = async function(s) {
	const { testFS } = s;
	let lst = await testFS.listFolder('');
	expect(Array.isArray(lst)).toBe(true);
	expect(lst.length).toBe(0);

	await testFS.makeFolder('folder1');
	await testFS.writeTxtFile('file1', '');
	await testFS.writeTxtFile('folder1/file2', '');

	lst = await testFS.listFolder('');
	expect(lst.length).toBe(2);
	for (let entry of lst) {
		if (entry.isFile) {
			expect(entry.name).toBe('file1');
		} else if (entry.isFolder) {
			expect(entry.name).toBe('folder1');
		} else {
			fail(`folder listing has unknown type: ${JSON.stringify(entry, null, '  ')}`);
		}
	}

	let lst2 = await testFS.listFolder('.');
	expect(deepEqual(lst2, lst)).toBe(true);
	
	lst2 = await testFS.listFolder('/');
	expect(deepEqual(lst2, lst)).toBe(true);
	
	lst2 = await testFS.listFolder('../../');
	expect(deepEqual(lst2, lst)).toBe(true);
};
specs.its.push(it);

it = { expectation: 'fails to list non-existing folder' };
it.func = async function(s) {
	const { testFS } = s;
	let fName = 'non-existing-folder';
	expect(await testFS.checkFolderPresence(fName)).toBe(false);
	await testFS.listFolder(fName)
	.then(() => {
		fail('listing should fail for non-existing folder')
	}, (exc: FileException) => {
		expect(exc.notFound).toBe(true);
	});
	
	await testFS.writeTxtFile(fName, '123');
	expect(await testFS.checkFilePresence(fName)).toBe(true);
	await testFS.listFolder(fName)
	.then(() => {
		fail('listing should fail on path that points to file')
	}, (exc: FileException) => {
		expect(exc.notDirectory).toBe(true);
	});
};
specs.its.push(it);

it = { expectation: 'lists folder without links' };
it.func = async function(s) {
	const { testFS } = s;
	let fName = 'f1/f2';
	await testFS.makeFolder('f1/f2');
	await testFS.writeTxtFile(fName+'/file1', '');
	await testFS.writeTxtFile(fName+'/folder1/file2', '');

	let lst = await testFS.listFolder(fName);
	expect(Array.isArray(lst)).toBe(true);
	expect(lst.length).toBe(2);
	for (let entry of lst) {
		if (entry.isFile) {
			expect(entry.name).toBe('file1');
		} else if (entry.isFolder) {
			expect(entry.name).toBe('folder1');
		} else {
			fail(`folder listing has unknown type: ${JSON.stringify(entry, null, '  ')}`);
		}
	}
};
specs.its.push(it);

it = {
	expectation: 'lists folder with links',
	notIncludedIn: 'win-local-fs'
};
it.func = async function(s) {
	const { testFS } = s;
	let fName = 'f1/f2';
	await testFS.makeFolder('f1/f2');
	await testFS.writeTxtFile(fName+'/file1', '');
	await testFS.writeTxtFile(fName+'/folder1/file2', '');
	await testFS.link(fName+'/link1',
		await testFS.readonlyFile(fName+'/folder1/file2'));

	let lst = await testFS.listFolder(fName);
	expect(Array.isArray(lst)).toBe(true);
	expect(lst.length).toBe(3);
	for (let entry of lst) {
		if (entry.isFile) {
			expect(entry.name).toBe('file1');
		} else if (entry.isFolder) {
			expect(entry.name).toBe('folder1');
		} else if (entry.isLink) {
			expect(entry.name).toBe('link1');
		} else {
			fail(`folder listing has unknown type: ${JSON.stringify(entry, null, '  ')}`);
		}
	}
};
specs.its.push(it);

Object.freeze(exports);