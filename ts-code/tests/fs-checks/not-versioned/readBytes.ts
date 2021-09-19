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
import { bytesSync as randomBytes } from '../../../lib-common/random-node';
import { bytesEqual } from '../../libs-for-tests/bytes-equal';
import { SpecIt } from '../test-utils';

type FileException = web3n.files.FileException;

export const specs: SpecDescribe = {
	description: '.readBytes',
	its: []
};

let it: SpecIt = { expectation: 'fails to read non-existent file' };
it.func = async function(s) {
	const { testFS } = s;
	let fName = 'unknown-file';
	expect(await testFS.checkFilePresence(fName)).toBe(false);
	await testFS.readBytes(fName)
	.then(() => {
		fail('reading bytes must fail, when file does not exist');
	}, (err: FileException) => {
		expect(err.notFound).toBe(true);
		if (!err.notFound) { throw err; }
	});
};
specs.its.push(it);

it = { expectation: 'reads whole file' };
it.func = async function(s) {
	const { testFS } = s;
	let originalBytes = randomBytes(12*1024+3);
	let fName = 'file1';
	await testFS.writeBytes(fName, originalBytes);
	let bytes = await testFS.readBytes(fName);
	expect(bytesEqual(bytes!, originalBytes)).withContext('file read should produce array with all bytes').toBe(true);

	fName = 'file2';
	await testFS.writeBytes(fName, new Uint8Array(0));
	bytes = await testFS.readBytes(fName);
	expect(bytes).withContext('reading empty file should produce undefined').toBeUndefined();
};
specs.its.push(it);

it = { expectation: 'reads part of the file' };
it.func = async function(s) {
	const { testFS } = s;
	let fName = 'file3';
	let originalBytes = randomBytes(12*1024+333);
	await testFS.writeBytes(fName, originalBytes);

	let bytes = await testFS.readBytes(fName, 12, 3456);
	expect(bytesEqual(bytes!, originalBytes.subarray(12, 3456))).withContext('should read from a proper file interior').toBe(true);

	bytes = await testFS.readBytes(fName, 12*1024);
	expect(bytesEqual(bytes!, originalBytes.subarray(12*1024))).withContext('read should start from interior and go to file\'s end').toBe(true);

	bytes = await testFS.readBytes(fName, 12*1024, 1024*1024);
	expect(bytesEqual(bytes!, originalBytes.subarray(12*1024))).withContext('when end parameter is greater than file size, bytes up to files end must be read').toBe(true);
	
	bytes = await testFS.readBytes(fName, undefined, 123);
	expect(bytesEqual(bytes!, originalBytes)).withContext('when start parameter is not given, end should also be ignored').toBe(true);
	
	bytes = await testFS.readBytes(fName, 1024*1024, 1024*1024+4);
	expect(bytes).withContext('when start is greater than file size, undefined must be returned').toBeUndefined();
	
	bytes = await testFS.readBytes(fName, 1024*1024);
	expect(bytes).withContext('when start is greater than file size, undefined must be returned').toBeUndefined();

	await testFS.readBytes(fName, -1).then(
		() => fail('negative parameters should cause throwing up'),
		() => {});

	await testFS.readBytes(fName, 1, -2).then(
		() => fail('negative parameters should cause throwing up'),
		() => {});
	
	bytes = await testFS.readBytes(fName, 1234, 100);
	expect(bytes).withContext('when end is smaller than start , undefined must be returned').toBeUndefined();
};
specs.its.push(it);

Object.freeze(exports);