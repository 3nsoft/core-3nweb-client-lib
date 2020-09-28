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
	try {
		await testFS.readBytes(fName)
		fail('reading bytes must fail, when file does not exist');
	} catch (err) {
		expect((err as FileException).notFound).toBe(true);
		if (!err.notFound) { throw err; }
	}
};
specs.its.push(it);

it = { expectation: 'reads whole file' };
it.func = async function(s) {
	const { testFS } = s;
	let originalBytes = randomBytes(12*1024+3);
	let fName = 'file1';
	let v1 = await testFS.v!.writeBytes(fName, originalBytes);
	let { bytes, version } = await testFS.v!.readBytes(fName);
	expect(bytesEqual(bytes!, originalBytes)).toBe(true, 'file read should produce array with all bytes');
	expect(version).toBe(v1, 'file version at reading should exactly the same as that on respective write');
	
	let v2 = await testFS.v!.writeBytes(fName, new Uint8Array(0));
	expect(v2).toBeGreaterThan(v1);
	({ bytes, version } = await testFS.v!.readBytes(fName));
	expect(typeof bytes).toBe('undefined', 'reading empty file should produce undefined');
	expect(version).toBe(v2, 'file version at reading should exactly the same as that on respective write');
};
specs.its.push(it);

it = { expectation: 'reads part of the file' };
it.func = async function(s) {
	const { testFS } = s;
	let fName = 'file3';
	let originalBytes = randomBytes(12*1024+333);
	let v = await testFS.v!.writeBytes(fName, originalBytes);
	
	let { bytes, version } = await testFS.v!.readBytes(fName, 12, 3456);
	expect(bytesEqual(bytes!, originalBytes.subarray(12, 3456))).toBe(true, 'should read from a proper file interior.');
	expect(version).toBe(v);
	
	({ bytes, version } = await testFS.v!.readBytes(fName, 12*1024));
	expect(bytesEqual(bytes!, originalBytes.subarray(12*1024))).toBe(true, 'read should start from interior and go to file\'s end.');
	expect(version).toBe(v);
	
	({ bytes, version } = await testFS.v!.readBytes(fName, 12*1024, 1024*1024));
	expect(bytesEqual(bytes!, originalBytes.subarray(12*1024))).toBe(true, 'when end parameter is greater than file size, bytes up to files end must be read.');
	expect(version).toBe(v);
	
	({ bytes, version } = await testFS.v!.readBytes(fName, undefined, 123));
	expect(bytesEqual(bytes!, originalBytes)).toBe(true, 'when start parameter is not given, end should also be ignored');
	expect(version).toBe(v);
	
	({ bytes, version } = await testFS.v!.readBytes(fName, 1024*1024, 1024*1024+4));
	expect(typeof bytes).toBe('undefined', 'when start is greater than file size, undefined must be returned');
	expect(version).toBe(v);
	
	({ bytes, version } = await testFS.v!.readBytes(fName, 1024*1024));
	expect(typeof bytes).toBe('undefined', 'when start is greater than file size, undefined must be returned');
	expect(version).toBe(v);

	await testFS.readBytes(fName, -1).then(
		() => fail('negative parameters should cause throwing up'),
		() => {});

	await testFS.readBytes(fName, 1, -2).then(
		() => fail('negative parameters should cause throwing up'),
		() => {});
	
	({ bytes, version } = await testFS.v!.readBytes(fName, 1234, 100));
	expect(typeof bytes).toBe('undefined', 'when end is smaller than start , undefined must be returned');
	expect(version).toBe(v);
};
specs.its.push(it);

Object.freeze(exports);