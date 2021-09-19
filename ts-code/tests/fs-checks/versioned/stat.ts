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
import { SpecIt } from '../test-utils';

type FileException = web3n.files.FileException;

export const specs: SpecDescribe = {
	description: '.stat',
	its: []
};

let it: SpecIt = { expectation: 'fails to read non-existent path' };
it.func = async function(s) {
	const { testFS } = s;
	const fName = 'unknown-file';
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
	const original = 'Should I be at BlackHat conference or working?';
	const originalFileSize = original.length;
	const fName = 'file1';
	await testFS.writeTxtFile(fName, original);
	let stat = await testFS.stat(fName);
	expect(typeof stat).toBe('object');
	expect(stat).not.toBeNull();
	expect(stat.isFile).withContext('flag indicating that path points to file').toBe(true);
	expect(stat.size).withContext('file size').toBe(originalFileSize);
	expect(typeof stat.version).toBe('number');
	const fstVersion =  stat.version!;

	const sndTxt = 'I better work!';
	const sndVersionFileSize = sndTxt.length;
	await testFS.writeTxtFile(fName, sndTxt);
	stat = await testFS.stat(fName);
	expect(stat.isFile).withContext('flag indicating that path points to file').toBe(true);
	expect(stat.size).withContext('file size').toBe(sndVersionFileSize);
	expect(stat.version).withContext('second version of the file').toBe(fstVersion + 1);
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
	expect(typeof stat.version).toBe('number');
	const fstVersion =  stat.version!;

	await testFS.writeTxtFile(`${fName}/some-file`, '');
	stat = await testFS.stat(fName);
	expect(stat.isFolder).withContext('flag indicating that path points to folder').toBe(true);
	expect(stat.version).withContext('second version of the folder').toBe(fstVersion + 1);
};
specs.its.push(it);

Object.freeze(exports);