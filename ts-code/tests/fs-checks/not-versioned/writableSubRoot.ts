/*
 Copyright (C) 2016 - 2018, 2020 3NSoft Inc.
 
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

export const specs: SpecDescribe = {
	description: '.writableSubRoot',
	its: []
};

let it: SpecIt = { expectation: 'creates sub-root based on existing folder' };
it.func = async function(s) {
	const { testFS } = s;
	const path = 'sub-root';
	await testFS.makeFolder(path);
	expect(await testFS.checkFolderPresence(path)).toBe(true);
	const subRoot = await testFS.writableSubRoot(path);
	expect(subRoot).toBeTruthy();
	expect(subRoot.writable).toBe(true);
	expect(!!subRoot.v).toBe(!!testFS.v);
	const lst = await subRoot.listFolder('');
	expect(Array.isArray(lst)).toBe(true);
};
specs.its.push(it);

it = { expectation: 'creates new folder for a sub-root' };
it.func = async function(s) {
	const { testFS } = s;
	const path = 'sub-root2';
	expect(await testFS.checkFolderPresence(path)).toBe(false);
	const subRoot = await testFS.writableSubRoot(path);
	expect(subRoot).toBeTruthy();
	expect(subRoot.writable).toBe(true);
	expect(!!subRoot.v).toBe(!!testFS.v);
	const lst = await subRoot.listFolder('');
	expect(Array.isArray(lst)).toBe(true);
};
specs.its.push(it);

it = { expectation: 'creates parent folder(s) on the way' };
it.func = async function(s) {
	const { testFS } = s;
	const fName = 'sub-root';
	const grParent = 'grand-parent';
	const parent = 'grand-parent/parent';
	const path = `${parent}/${fName}`;
	expect(await testFS.checkFolderPresence(grParent)).toBe(false);
	expect(await testFS.checkFolderPresence(parent)).toBe(false);
	expect(await testFS.checkFolderPresence(path)).toBe(false);
	const subRoot = await testFS.writableSubRoot(path);
	expect(subRoot).toBeTruthy();
	expect(subRoot.writable).toBe(true);
	expect(!!subRoot.v).toBe(!!testFS.v);
	const lst = await subRoot.listFolder('');
	expect(Array.isArray(lst)).toBe(true);
	expect(await testFS.checkFolderPresence(path)).toBe(true);
};
specs.its.push(it);

it = {
	expectation: `concurrently created (on the same folder) sub-roots access the same file tree`
};
it.func = async function(s) {
	const { testFS } = s;
	const subRootFolder = 'sub-root';
	const promise1 = testFS.writableSubRoot(subRootFolder);
	const promise2 = testFS.writableSubRoot(subRootFolder);

	// create file in one fs
	const fName = 'file 1';
	const fileContent = `Sub-roots to the same folder should display same thing`;
	const subRoot1 = await promise1;
	await subRoot1.writeTxtFile(fName, fileContent);

	// see that file is present via another fs
	const subRoot2 = await promise2;
	expect(await subRoot2.checkFilePresence(fName)).toBe(true);
	const readContent = await subRoot2.readTxtFile(fName);
	expect(readContent).toBe(fileContent);
}
specs.its.push(it);

Object.freeze(exports);