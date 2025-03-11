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

import { SpecDescribe } from '../../libs-for-tests/spec-module';
import { bytesSync as randomBytes } from '../../../lib-common/random-node';
import { bytesEqual } from '../../libs-for-tests/bytes-equal';
import { SpecIt } from '../fs-checks/test-utils';

type LayoutSection = web3n.files.LayoutSection;
type FileLayout = web3n.files.FileLayout;

export const specs: SpecDescribe = {
	description: 'gives file sinks, able to splice file content',
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
			expect(section.src).withContext(`wrong source in section ${sectionInd}`).toBe(src);
			expect(section.ofs).withContext(`wrong offset in section ${sectionInd}`).toBe(ofs);
			expect(section.len).withContext(`wrong length in section ${sectionInd}`).toBe(len);
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
	expect(Array.isArray(layout.sections)).toBeTruthy();
	expect(layout.sections.length).toBe(0);

	const chunk1 = randomBytes(10000);
	await sink.splice(0, chunk1.length, chunk1);
	size = await sink.getSize();
	expect(size).toBe(10000);
	layout = await sink.showLayout();
	expect(layout.sections.length).toBe(1);
	expectSection(layout, 0, 'new', 0, size);

	const chunk2 = randomBytes(100);
	await sink.splice(11000, 0, chunk2);
	size = await sink.getSize();
	layout = await sink.showLayout();
	if (testFS.type === 'device') {
		expect(layout.sections.length).toBe(1);
		expectSection(layout, 0, 'new', 0, size);
	} else {
		expect(layout.sections.length).toBe(3);
		expectSection(layout, 0, 'new', 0, 10000);
		expectSection(layout, 1, 'empty', 10000, 1000);
		expectSection(layout, 2, 'new', 11000, 100);
	}

	await sink.done();

	const content = await testFS.readBytes(fName);
	expect(content!.length).toBe(size);
	expect(bytesEqual(content!.subarray(0, 10000), chunk1)).toBe(true);
	expect(bytesEqual(content!.subarray(11000), chunk2)).toBe(true);

}; 
specs.its.push(it);


it = { expectation: 'of an existing file without inserting new bytes' };
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
			fail(`section indexes ${sectionInd} is not in layout with ${l.sections.length} sections`);
		}
	}

	// setup original file
	const fName = 'file1';
	let sink = await testFS.getByteSink(
		fName, { create: true, exclusive: true });
	const chunk1 = randomBytes(10000);
	await sink.splice(0, chunk1.length, chunk1);
	const chunk2 = randomBytes(100);
	await sink.splice(11000, 0, chunk2);
	await sink.done();
	const initSize = await sink.getSize();

	// sink for this test
	sink = await testFS.getByteSink(fName, { create: false });

	await sink.splice(5000, 4000);
	let size = await sink.getSize();
	expect(size).toBe(initSize - 4000);
	let layout = await sink.showLayout();
	if (testFS.type === 'device') {
		expect(layout.sections.length).toBe(1);
		expectSection(layout, 0, 'new', 0, size);
	} else {
		expect(layout.sections.length).toBe(3);
		expectSection(layout, 0, 'base', 0, 6000);
		expectSection(layout, 1, 'empty', 6000, 1000);
		expectSection(layout, 2, 'base', 7000, 100);
	}

	await sink.done();

	const content = await testFS.readBytes(fName);
	expect(content!.length).toBe(size);
	expect(bytesEqual(content!.subarray(0, 5000), chunk1.subarray(0, 5000))).toBe(true);
	expect(bytesEqual(content!.subarray(5000, 6000), chunk1.subarray(9000))).toBe(true);
	expect(bytesEqual(content!.subarray(7000), chunk2)).toBe(true);

};
specs.its.push(it);


Object.freeze(exports);