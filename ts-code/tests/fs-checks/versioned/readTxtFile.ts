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

type FileException = web3n.files.FileException;

export const specs: SpecDescribe = {
	description: '.readTxtFile',
	its: []
};

let it: SpecIt = { expectation: 'fails to read non-existent file' };
it.func = async function(s) {
	const { testFS } = s;
	let fName = 'unknown-file';
	expect(await testFS.checkFilePresence(fName)).toBe(false);
	await testFS.readTxtFile(fName)
	.then(() => {
		fail('reading text must fail, when file does not exist');
	}, (err: FileException) => {
		expect(err.notFound).toBe(true);
		if (!err.notFound) { throw err; }
	});
};
specs.its.push(it);

it = { expectation: 'reads json file' };
it.func = async function(s) {
	const { testFS } = s;
	let original = 'Should I be at BlackHat conference or working?';
	let fName = 'file1';
	let v1 = await testFS.v!.writeTxtFile(fName, original);
	let { txt, version } = await testFS.v!.readTxtFile(fName);
	expect(txt).withContext('file read should produce original text').toBe(original);
	expect(version).withContext('file version at reading should exactly the same as that on respective write').toBe(v1);
	
	let v2 = await testFS.v!.writeBytes(fName, new Uint8Array(0));
	expect(v2).toBeGreaterThan(v1);
	({ txt, version } = await testFS.v!.readTxtFile(fName));
	expect(txt).withContext('empty file should be read as an empty string').toBe('');
	expect(version).withContext('file version at reading should exactly the same as that on respective write').toBe(v2);
};
specs.its.push(it);

Object.freeze(exports);