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

import { SpecDescribe } from '../../../libs-for-tests/spec-module';
import { deepEqual } from '../../../libs-for-tests/json-equal';
import { SpecIt } from '../test-utils';

type FileException = web3n.files.FileException;

export const specs: SpecDescribe = {
	description: '.v.listFolder',
	its: []
};

let it: SpecIt = { expectation: 'lists root' };
it.func = async function(s) {
	const { testFS } = s;
	let { lst, version } = await testFS.v!.listFolder('');
	expect(Array.isArray(lst)).toBe(true);
	expect(typeof version).toBe('number');
	expect(lst.length).toBe(0);

	const initVersion = version;

	await testFS.makeFolder('folder1');
	await testFS.writeTxtFile('file1', '');
	await testFS.writeTxtFile('folder1/file2', '');

	({ lst, version } = await testFS.v!.listFolder(''));
	expect(lst.length).toBe(2);
	expect(version).toBe(initVersion + 2);
	for (let entry of lst) {
		if (entry.isFile) {
			expect(entry.name).toBe('file1');
		} else if (entry.isFolder) {
			expect(entry.name).toBe('folder1');
		} else {
			fail(`folder listing has unknown type: ${JSON.stringify(entry, null, '  ')}`);
		}
	}

	let lst2 = (await testFS.v!.listFolder('.')).lst;
	expect(deepEqual(lst2, lst)).toBe(true);
	
	lst2 = (await testFS.v!.listFolder('/')).lst;
	expect(deepEqual(lst2, lst)).toBe(true);
	
	lst2 = (await testFS.v!.listFolder('../../')).lst;
	expect(deepEqual(lst2, lst)).toBe(true);
};
specs.its.push(it);

it = { expectation: 'fails to list non-existing folder' };
it.func = async function(s) {
	const { testFS } = s;
	let fName = 'non-existing-folder';
	expect(await testFS.checkFolderPresence(fName)).toBe(false);
	try {
		await testFS.v!.listFolder(fName);
		fail('listing should fail for non-existing folder')
	} catch (exc) {
		expect((exc as FileException).notFound).toBe(true);
	}
	
	await testFS.writeTxtFile(fName, '123');
	expect(await testFS.checkFilePresence(fName)).toBe(true);
	try {
		await testFS.listFolder(fName)
		fail('listing should fail on path that points to file')
	} catch (exc) {
		expect((exc as FileException).notDirectory).toBe(true);
	}
};
specs.its.push(it);

it = { expectation: 'lists folder' };
it.func = async function(s) {
	const { testFS } = s;
	let fName = 'f1/f2';
	await testFS.makeFolder('f1/f2');
	await testFS.writeTxtFile(fName+'/file1', '');
	await testFS.writeTxtFile(fName+'/folder1/file2', '');
	await testFS.link(fName+'/link1',
		await testFS.readonlyFile(fName+'/folder1/file2'));

	let { lst, version } = await testFS.v!.listFolder(fName);
	expect(Array.isArray(lst)).toBe(true);
	expect(typeof version).toBe('number');
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