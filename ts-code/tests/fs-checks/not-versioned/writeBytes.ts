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
import { SpecIt } from '../test-utils';
import { bytesEqual } from '../../libs-for-tests/bytes-equal';

type FileException = web3n.files.FileException;

export const specs: SpecDescribe = {
	description: '.writeBytes',
	its: []
};

let it: SpecIt = { expectation: 'if not allowed to create, fails for missing file' };
it.func = async function(s) {
	const { testFS } = s;
	await testFS.writeBytes('non-existing-file', randomBytes(123), {})
	.then(() => {
		fail('should fail for missing file');
	}, (e: FileException) => {
		expect(e.notFound).toBe(true);
	});
};
specs.its.push(it);

it = { expectation: 'creates file in existing folder' };
it.func = async function(s) {
	const { testFS } = s;
	let path = 'file1';
	let content = randomBytes(2*1024);
	expect(await testFS.checkFilePresence(path)).toBe(false);
	await testFS.writeBytes(path, content);
	expect(await testFS.checkFilePresence(path)).toBe(true);
	let bytes = await testFS.readBytes(path);
	expect(bytesEqual(content, bytes!)).toBe(true);
};
specs.its.push(it);

it = { expectation: 'creates parent folder(s) on the way' };
it.func = async function(s) {
	const { testFS } = s;
	let fName = 'file2';
	let grParent = 'grand-parent';
	let parent2 = 'grand-parent/parent2';
	let path = `${parent2}/${fName}`;
	expect(await testFS.checkFolderPresence(grParent)).toBe(false);
	expect(await testFS.checkFolderPresence(parent2)).toBe(false);
	expect(await testFS.checkFolderPresence(path)).toBe(false);
	let content = randomBytes(2*1024);
	await testFS.writeBytes(path, content);
	expect(await testFS.checkFolderPresence(grParent)).toBe(true);
	expect(await testFS.checkFolderPresence(parent2)).toBe(true);
	expect(await testFS.checkFilePresence(path)).toBe(true);
	let bytes = await testFS.readBytes(path);
	expect(bytesEqual(content, bytes!)).toBe(true);
};
specs.its.push(it);

it = { expectation: 'over-writes existing file with a non-exclusive call' };
it.func = async function(s) {
	const { testFS } = s;
	let path = 'file3';
	// setup initial file
	let initBytes = randomBytes(123);
	await testFS.writeBytes(path, initBytes);
	expect(await testFS.checkFilePresence(path)).toBe(true);
	let bytes = await testFS.readBytes(path);
	expect(bytesEqual(initBytes, bytes!)).toBe(true);
	// write new file content
	let newContent = randomBytes(3223);
	await testFS.writeBytes(path, newContent);
	expect(await testFS.checkFilePresence(path)).toBe(true);
	bytes = await testFS.readBytes(path);
	expect(bytesEqual(newContent, bytes!)).toBe(true);
};
specs.its.push(it);

it = { expectation: 'exclusive-create write throws when file already exists' };
it.func = async function(s) {
	const { testFS } = s;
	let path = 'file4';
	// setup initial file
	let initBytes = randomBytes(123);
	await testFS.writeBytes(path, initBytes);
	expect(await testFS.checkFilePresence(path)).toBe(true);
	// try an exclusive write
	let newContent = randomBytes(3223);
	await testFS.writeBytes(path, newContent, { create:true, exclusive:true })
	.then(() => {
		fail('exclusive-create write operation must fail, when file exists.');
	}, (exc: FileException) => {
		expect(exc.alreadyExists).toBe(true);
	});
	let bytes = await testFS.readBytes(path);
	expect(bytesEqual(initBytes, bytes!)).withContext('initial file content stays intact').toBe(true);
};
specs.its.push(it);

it = {
	expectation: 'write big-ish file',
	timeout: 10*1000
};
it.func = async function(s) {
	const { testFS } = s;
	let path = 'file5';
	// write some bytes
	let bytesToWrite = randomBytes(3000000);
	await testFS.writeBytes(path, bytesToWrite);
	expect(await testFS.checkFilePresence(path)).toBe(true);
	// check that same bytes are read
	let readBytes = await testFS.readBytes(path);
	expect(bytesEqual(bytesToWrite, readBytes!)).toBe(true);
};
specs.its.push(it);


Object.freeze(exports);