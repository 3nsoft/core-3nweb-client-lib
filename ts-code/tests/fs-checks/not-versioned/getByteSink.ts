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
import { bytesEqual }
	from '../../libs-for-tests/bytes-equal';
import { makeContinuousSink } from '../../../lib-common/obj-streaming/sink-utils';
import { SpecIt } from '../test-utils';

type FileException = web3n.files.FileException;

export const specs: SpecDescribe = {
	description: '.getByteSink',
	its: []
};

let it: SpecIt = {
	expectation: 'if not allowed to create, fails for missing file'
};
it.func = async function(s) {
	const { testFS } = s;
	await testFS.getByteSink('non-existing-file', {})
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
	const path = 'file1';
	const content = randomBytes(2*1024);
	expect(await testFS.checkFilePresence(path)).toBe(false);
	const sink = await testFS.getByteSink(path, {create:true});
	expect(await testFS.checkFilePresence(path)).toBe(true);
	expect(await sink.getSize()).toBe(0);
	const continousSink = makeContinuousSink(sink);
	for (let pointer=0; pointer < content.length; pointer+=250) {
		const chunkEnd = pointer + 250;
		await continousSink(content.subarray(pointer, chunkEnd));
		expect(await sink.getSize()).toBe(
			Math.min(chunkEnd, content.length));
	}
	expect(await sink.getSize()).toBe(content.length);
	await continousSink(null);
	const bytes = await testFS.readBytes(path);
	expect(!!bytes).toBe(true);
	expect(bytesEqual(content, bytes!)).toBe(true);
};
specs.its.push(it);

it = { expectation: 'creates parent folder(s) on the way' };
it.func = async function(s) {
	const { testFS } = s;
	const fName = 'file2';
	const grParent = 'grand-parent';
	const parent2 = 'grand-parent/parent2';
	const path = `${parent2}/${fName}`;
	expect(await testFS.checkFolderPresence(grParent)).toBe(false);
	expect(await testFS.checkFolderPresence(parent2)).toBe(false);
	expect(await testFS.checkFolderPresence(path)).toBe(false);
	const sink = await testFS.getByteSink(path, {create:true});
	expect(await testFS.checkFolderPresence(grParent)).toBe(true);
	expect(await testFS.checkFolderPresence(parent2)).toBe(true);
	expect(await testFS.checkFilePresence(path)).toBe(true);
	// note that file existed before sink closing
	await sink.done();
};
specs.its.push(it);

it = { expectation: 'opens existing file' };
it.func = async function(s) {
	const { testFS } = s;
	const path = 'file2';
	const bytes = randomBytes(2*1024);
	const originalSize = bytes.length;
	await testFS.writeBytes(path, bytes);
	expect(await testFS.checkFilePresence(path)).toBe(true);
	const sink = await testFS.getByteSink(path, {truncate:false});
	expect(await sink.getSize()).withContext('Existing file should be opened as is').toBe(originalSize);
	const continousSink = makeContinuousSink(sink, originalSize);
	await continousSink(bytes);
	expect(await sink.getSize()).toBe(originalSize + bytes.length);
	await continousSink(null);
};
specs.its.push(it);

Object.freeze(exports);