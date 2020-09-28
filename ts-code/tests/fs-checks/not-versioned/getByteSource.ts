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
	description: '.getByteSource',
	its: []
};

let it: SpecIt = { expectation: 'fails to read non-existent file' };
it.func = async function(s) {
	const { testFS } = s;
	await testFS.getByteSource('non-existing-file')
	.then(() => {
		fail('should fail for missing file');
	}, (e: FileException) => {
		expect(e.notFound).toBe(true);
	});
};
specs.its.push(it);

it = { expectation: 'reads file bytes with seeking available' };
it.func = async function(s) {
	const { testFS } = s;
	const original = randomBytes(12*1024+3);
	let fName = 'file1';
	await testFS.writeBytes(fName, original);

	let src = await testFS.getByteSource(fName);
	expect(await src.getPosition()).toBe(0);

	let chunk = await src.read(200);
	expect(bytesEqual(chunk!, original.subarray(0, 200))).toBe(true);

	await src.seek(3000);
	expect(await src.getPosition()).toBe(3000, 'seek method changes position in file.');
	chunk = await src.read(200);
	expect(bytesEqual(chunk!, original.subarray(3000, 3200))).toBe(true);

	await src.seek(11000);
	expect(await src.getPosition()).toBe(11000, 'seek method changes position in file.');
	chunk = await src.read(200);
	expect(bytesEqual(chunk!, original.subarray(11000, 11200))).toBe(true);
	
	await src.seek(1000);
	expect(await src.getPosition()).toBe(1000);
	chunk = await src.read(200);
	expect(bytesEqual(chunk!, original.subarray(1000, 1200))).toBe(true);

	chunk = await src.read(undefined);
	expect(bytesEqual(chunk!, original.subarray(1200))).toBe(true, 'read should be from current position to file\'s end');
	
	expect(typeof (await src.read(100))).toBe('undefined', 'null is returned, whewn there are no more bytes to read');

	fName = 'file2';
	await testFS.writeBytes(fName, new Uint8Array(0));
	src = await testFS.getByteSource(fName);
	expect(typeof (await src.read(100))).toBe('undefined', 'reading empty file should produce empty array');
};
specs.its.push(it);

Object.freeze(exports);