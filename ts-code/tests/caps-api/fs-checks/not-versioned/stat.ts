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
	description: '.stat',
	its: []
};

let it: SpecIt = { expectation: 'fails to read non-existent path' };
it.func = async function(s) {
	const { testFS } = s;
	let fName = 'unknown-file';
	expect(await testFS.checkFilePresence(fName)).toBe(false);
	await testFS.stat(fName)
	.then(() => {
		fail('stat-ing must fail, when path does not exist');
	}, (err: FileException) => {
		expect(err.notFound).toBe(true);
		if (!err.notFound) { throw err; }
	});
};
specs.its.push(it);

it = { expectation: 'stats file' };
it.func = async function(s) {
	const { testFS } = s;
	let original = 'Should I be at BlackHat conference or working?';
	let originalFileSize = original.length;
	let fName = 'file1';
	await testFS.writeTxtFile(fName, original);
	let stat = await testFS.stat(fName);
	expect(typeof stat).toBe('object');
	expect(stat).not.toBeNull();		
	expect(stat.isFile).withContext('flag indicating that path points to file').toBe(true);
	expect(stat.size).withContext('file size').toBe(originalFileSize);
	expect(stat.writable).toBe(true);
	
	let sndTxt = 'I better work!';
	let sndVersionFileSize = sndTxt.length;
	await testFS.writeTxtFile(fName, sndTxt);
	stat = await testFS.stat(fName);
	expect(stat.isFile).withContext('flag indicating that path points to file').toBe(true);
	expect(stat.size).withContext('file size').toBe(sndVersionFileSize);
	expect(stat.writable).toBe(true);

	const roFS = await testFS.readonlySubRoot('');
	stat = await roFS.stat(fName);
	expect(stat.isFile).withContext('flag indicating that path points to file').toBe(true);
	expect(stat.size).withContext('file size').toBe(sndVersionFileSize);
	expect(stat.writable).toBe(false);

};
specs.its.push(it);

it = { expectation: 'stats folder' };
it.func = async function(s) {
	const { testFS } = s;
	const fName = 'folder1';
	await testFS.makeFolder(fName);
	let stat = await testFS.stat(fName);
	expect(typeof stat).toBe('object');
	expect(stat).not.toBeNull();
	expect(stat.isFolder).withContext('flag indicating that path points to folder').toBe(true);
	expect(stat.writable).toBe(true);

	const roFS = await testFS.readonlySubRoot('');
	stat = await roFS.stat(fName);
	expect(stat.isFolder).withContext('flag indicating that path points to folder').toBe(true);
	expect(stat.writable).toBe(false);

};
specs.its.push(it);

it = { expectation: `stats fs' root` };
it.func = async function(s) {
	const { testFS } = s;
	const stat = await testFS.stat('');
	expect(stat.isFolder).toBe(true);
	expect(stat.writable).toBe(true);
	let stat2 = await testFS.stat('.');
	expect(deepEqual(stat, stat2)).toBe(true);
	stat2 = await testFS.stat('/');
	expect(deepEqual(stat, stat2)).toBe(true);
};
specs.its.push(it);

Object.freeze(exports);