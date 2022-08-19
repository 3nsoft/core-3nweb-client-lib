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
import { deepEqual } from '../../libs-for-tests/json-equal';
import { SpecIt } from '../test-utils';

type FileException = web3n.files.FileException;

export const specs: SpecDescribe = {
	description: '.v.readJSONFile',
	its: []
};

let it: SpecIt = { expectation: 'fails to read non-existent file' };
it.func = async function(s) {
	const { testFS } = s;
	let fName = 'unknown-file';
	expect(await testFS.checkFilePresence(fName)).toBe(false);
	await testFS.v!.readJSONFile(fName)
	.then(() => {
		fail('reading json must fail, when file does not exist');
	}, (err: FileException) => {
		expect(err.notFound).toBe(true);
		if (!err.notFound) { throw err; }
	});
};
specs.its.push(it);

it = { expectation: 'reads json file' };
it.func = async function(s) {
	const { testFS } = s;
	let original = { a: 'foo', b: true, 'df-df': 23};
	let fName = 'file1';
	let v1 = await testFS.v!.writeJSONFile(fName, original);
	let { json, version } = await testFS.v!.readJSONFile(fName);
	expect(deepEqual(json, original)).withContext('file read should produce original json').toBe(true);
	expect(version).withContext('file version at reading should exactly the same as that on respective write').toBe(v1);
	
	let v2 = await testFS.v!.writeBytes(fName, new Uint8Array(0));
	expect(v2).toBeGreaterThan(v1);
	await testFS.readJSONFile(fName)
	.then(() => {
		fail('reading empty file should fail, as empty is not valid json');
	}, (exc) => {
		expect(exc).toBeTruthy();
	});
};
specs.its.push(it);

Object.freeze(exports);