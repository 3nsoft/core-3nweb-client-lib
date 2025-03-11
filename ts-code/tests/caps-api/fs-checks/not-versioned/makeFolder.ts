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
import { SpecIt } from '../test-utils';

type FileException = web3n.files.FileException;

export const specs: SpecDescribe = {
	description: '.makeFolder',
	its: []
};

let it: SpecIt = { expectation: 'creates in existing parent' };
it.func = async function(s) {
	const { testFS } = s;
	let fName = 'folder';
	expect(await testFS.checkFolderPresence(fName)).toBe(false);
	await testFS.makeFolder(fName);
	expect(await testFS.checkFolderPresence(fName)).toBe(true);
};
specs.its.push(it);

it = {
	expectation: 'is a no-op, when folder exists, and a call is not exclusive'
};
it.func = async function(s) {
	const { testFS } = s;
	for (let fName of [ 'folder2', 'parent2/folder2' ]) {
		expect(await testFS.checkFolderPresence(fName)).toBe(false);
		await testFS.makeFolder(fName);
		expect(await testFS.checkFolderPresence(fName)).toBe(true);
		await testFS.makeFolder(fName)
		.catch(() => {
			fail('non exclusive creation should not throw');
		});
		expect(await testFS.checkFolderPresence(fName)).toBe(true);
	}
};
specs.its.push(it);

it = { expectation: 'exclusive creation fails if folder exists' };
it.func = async function(s) {
	const { testFS } = s;
	for (let fName of [ 'folder3', 'parent3/folder3' ]) {
		expect(await testFS.checkFolderPresence(fName)).toBe(false);
		await testFS.makeFolder(fName);
		expect(await testFS.checkFolderPresence(fName)).toBe(true);
		await testFS.makeFolder(fName, true)
		.then(() => {
			fail('Exclusive creation of folder fails to throw.');
		}, (e: FileException) => {
			if (!e.alreadyExists) { fail('incorrect exception'); }
		});
	}
};
specs.its.push(it);

it = { expectation: 'creates parent folder(s) on the way' };
it.func =async function(s) {
	const { testFS } = s;
	let fName = 'folder';
	let grParent = 'grand-parent';
	let parent2 = 'grand-parent/parent2';
	let path = `${parent2}/${fName}`;
	expect(await testFS.checkFolderPresence(grParent)).toBe(false);
	expect(await testFS.checkFolderPresence(parent2)).toBe(false);
	expect(await testFS.checkFolderPresence(path)).toBe(false);
	await testFS.makeFolder(path);
	expect(await testFS.checkFolderPresence(path)).toBe(true);
};
specs.its.push(it);

it = { expectation: 'can handle concurrent creation' }
it.func = async function(s) {
	const { testFS } = s;
	let path = 'concurrent/a/b/c/d/e/f/g/h';
	expect(await testFS.checkFolderPresence(path)).toBe(false);
	let concurrentTasks: Promise<void>[] = [];
	for (let i=0; i < 10; i+=1) {
		concurrentTasks.push(testFS.makeFolder(path));
	}
	await Promise.all(concurrentTasks);
	expect(await testFS.checkFolderPresence(path)).toBe(true);
};
specs.its.push(it);

Object.freeze(exports);