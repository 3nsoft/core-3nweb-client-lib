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
	description: '.readonlyFile',
	its: []
};

let it: SpecIt = { expectation: 'fails for non-existent file' };
it.func = async function(s) {
	const { testFS } = s;
	let fName = 'unknown-file';
	expect(await testFS.checkFilePresence(fName)).toBe(false);
	try {
		await testFS.readonlyFile(fName);
		fail('getting file object must fail, when file does not exist');
	} catch (err) {
		expect((err as FileException).notFound).toBe(true);
		if (!err.notFound) { throw err; }
	}
};
specs.its.push(it);

it = { expectation: 'gives file object' };
it.func = async function(s) {
	const { testFS } = s;
	let original = 'Should I be at BlackHat conference or working?';
	let fName = 'file';
	await testFS.writeTxtFile(fName, original);
	
	let file = await testFS.readonlyFile(fName);
	expect(typeof file).toBe('object');
	expect(file.writable).toBe(false);
	expect(!!file.v).toBe(!!testFS.v);
	expect(file.name).toBe(fName, 'file object should have file name');
	expect(file.isNew).toBe(false, 'readonly file must exist');		
};
specs.its.push(it);

Object.freeze(exports);