/*
 Copyright (C) 2020 3NSoft Inc.
 
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

import { SpecDescribe } from '../libs-for-tests/spec-module';
import { bytesSync as randomBytes } from '../../lib-common/random-node';
import { bytesEqual } from '../libs-for-tests/bytes-equal';
import { SpecIt } from '../fs-checks/test-utils';

type LayoutSection = web3n.files.LayoutSection;
type FileLayout = web3n.files.FileLayout;

export const specs: SpecDescribe = {
	description: 'gives file sinks, able to truncate file content',
	its: []
};

let it: SpecIt = { expectation: 'of a newly created file' };
it.func = async function(s) {
	const { testFS } = s;

	function expectSection(
		l: FileLayout, sectionInd: number, src: LayoutSection['src'],
		ofs: number, len: number
	): void {
		const section = l.sections[sectionInd];
		if (section) {
			expect(section.src).withContext(`source in section ${sectionInd}`).toBe(src);
			expect(section.ofs).withContext(`offset in section ${sectionInd}`).toBe(ofs);
			expect(section.len).withContext(`length in section ${sectionInd}`).toBe(len);
		} else {
			fail(`section index ${sectionInd} is not in layout with ${l.sections.length} sections`);
		}
	}

	const fName = 'file1';

	const sink = await testFS.getByteSink(
		fName, { create: true, exclusive: true });
	let size = await sink.getSize();
	expect(size).toBe(0);

	let layout = await sink.showLayout();
	expect(layout.base).toBeFalsy();
	expect(Array.isArray(layout.sections)).toBeTruthy();
	expect(layout.sections.length).toBe(0);

	await sink.truncate(10000);
	size = await sink.getSize();
	expect(size).toBe(10000);
	layout = await sink.showLayout();
	expect(layout.sections.length).toBe(1);
	if (testFS.type === 'device') {
		expectSection(layout, 0, 'new', 0, 10000);
	} else {
		expectSection(layout, 0, 'empty', 0, 10000);
	}

	const chunk = randomBytes(10000);
	await sink.splice(0, chunk.length, chunk);
	size = await sink.getSize();
	expect(size).toBe(10000);
	layout = await sink.showLayout();
	expect(layout.sections.length).toBe(1);
	expectSection(layout, 0, 'new', 0, size);

	await sink.truncate(5000);

	size = await sink.getSize();
	expect(size).toBe(5000);
	layout = await sink.showLayout();
	expect(layout.sections.length).toBe(1);
	expectSection(layout, 0, 'new', 0, size);

	await sink.done();

	const content = await testFS.readBytes(fName);
	expect(content!.length).toBe(size);
	expect(bytesEqual(content!, chunk.subarray(0, size))).toBe(true);

};
specs.its.push(it);


it = {
	expectation: 'and supports truncating without writing to file (scenario 1), checking version',
	notIncludedIn: 'device-fs'
};
it.func = async function(s) {
	const { testFS } = s;

	async function checkSizeOf(
		file: string, expectedSize: number, expectedVersion: number
	) {
		const { size, version } = await testFS.stat(file);
		expect(size).withContext(`file size of "${file}"`).toBe(expectedSize);
		expect(version).withContext(`file version`).toBe(expectedVersion);
	}
	const file = 'file to truncate';

	let fileVersion = await testFS.v!.writeTxtFile(
		file, '', { create:true, exclusive:true });
	await checkSizeOf(file, 0, fileVersion);

	let { sink, version } = await testFS.v!.getByteSink(file, {});
	await sink.truncate(500);
	await sink.done();

	await checkSizeOf(file, 500, version);

	({ sink, version } = await testFS.v!.getByteSink(file, {}));
	await sink.truncate(100);
	await sink.done();

	await checkSizeOf(file, 100, version);
};
specs.its.push(it);


it = {
	expectation: 'and supports truncating without writing to file (scenario 1), without checking versions'
};
it.func = async function(s) {
	const { testFS } = s;

	async function checkSizeOf(file: string, expectedSize: number) {
		const { size, version } = await testFS.stat(file);
		expect(size).withContext(`file size of "${file}"`).toBe(expectedSize);
	}
	const file = 'file to truncate';

	await testFS.writeTxtFile(file, '', { create:true, exclusive:true });
	await checkSizeOf(file, 0);

	let sink = await testFS.getByteSink(file, {});
	await sink.truncate(500);
	await sink.done();

	await checkSizeOf(file, 500);

	sink = await testFS.getByteSink(file, {});
	await sink.truncate(100);
	await sink.done();

	await checkSizeOf(file, 100);
};
specs.its.push(it);
