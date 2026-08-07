/*
 Copyright (C) 2020, 2026 3NSoft Inc.
 
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
import { bytes as randomBytes } from '../../../lib-common-on-node/random-node';
import { bytesEqual } from '../../libs-for-tests/bytes-equal';
import { SpecIt } from '../fs-checks/test-utils';
import { utf8 } from '../../../lib-common/buffer-utils';
import { deepEqual } from '../../libs-for-tests/json-equal';

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

	const chunk1 = await randomBytes(10000);
	await sink.splice(0, chunk1.length, chunk1);
	size = await sink.getSize();
	expect(size).toBe(10000);
	layout = await sink.showLayout();
	expect(layout.sections.length).toBe(1);
	expectSection(layout, 0, 'new', 0, size);

	const chunk2 = await randomBytes(100);
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
	const chunk1 = await randomBytes(10000);
	await sink.splice(0, chunk1.length, chunk1);
	const chunk2 = await randomBytes(100);
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

// XXX enbale this when capturing this bug
it = {
	expectation: 'usecase with removing and adding sections of json', disableIn: 'device-fs'
};
it.func = async function(s) {
	const { testFS } = s;
	const file = 'incremental-file';

	const COMMA_BYTE = utf8.pack(',');
	const SQ_BRACKET_BYTE = utf8.pack(']');
	const completeContent = [
		{
			record: {
				msgId:"F-vo1A4zInEBGq994-e3KvrE9a8QXLcr",
			}
		},
		{
			record: {
				msgId:"JYXfEEcg3-iX7UDjG3BU0Jha9DYX_Jt-",
			}
		}
	];

	const TEST_XATTR = 'attr-for-test';
	const attrValue1 = Date.now();
	const attrValue2 = { comment: 'now json value', ts: Date.now() };

	// the following splice pattern hit an error, hence seemingly out of the blue use case, but it is an echo

	// XXX removal of fs.updateXAttrs() call removes error in this situation

console.log(`p 1`);
	await testFS.writeTxtFile(file, `[]`);
console.log(`p 2`);

	let sink = await testFS.getByteSink(file, { truncate: false });
console.log(`p 2.1`);
	await sink.splice(1, 1);
console.log(`p 2.2`);
	let bytes = utf8.pack(JSON.stringify(completeContent[0]));
console.log(`p 2.3`);
	await sink.splice(1, 0, bytes);
console.log(`p 2.4`);
	await sink.splice(1+bytes.length, 0, SQ_BRACKET_BYTE);
console.log(`p 2.5`);
	await sink.done();
console.log(`p 2.6`);
	await testFS.updateXAttrs(file, { set: { [TEST_XATTR]: attrValue1 } });
console.log(`p 3`);

globalThis.log$ = true;

	sink = await testFS.getByteSink(file, { truncate: false });
console.log(`p 3.1 -------- getting size`);
	const len = await sink.getSize();
console.log(`p 3.2 ------------ replacing one last byte in content, \n layout`, await sink.showLayout());
	await sink.splice(len-1, 1, COMMA_BYTE);
// 	await sink.splice(len-1, 1);
// console.log(`p 3.2+ ---------------------------------- replacing one last byte in content, \n layout`, await sink.showLayout());
// 	await sink.splice(len-1, 0, COMMA_BYTE);
	// await sink.splice(len-1, 1, utf8.pack(',  '));
console.log(`p 3.3 ----------- writing content after last replaced byte, \n layout`, await sink.showLayout());
	bytes = utf8.pack(JSON.stringify(completeContent[1]));
	await sink.splice(len, 0, bytes);
console.log(`p 3.4 -------- turning logging off, \n layout`, await sink.showLayout());

globalThis.log$ = false;

	await sink.splice(len+bytes.length, 0, SQ_BRACKET_BYTE);
console.log(`p 3.5, \n layout`, await sink.showLayout());
	const attrWrite = testFS.updateXAttrs(file, { set: { [TEST_XATTR]: attrValue2 } });
console.log(`p 3.6`);
	await sink.done();
	await attrWrite;
console.log(`p 4`);

	expect(deepEqual(completeContent, await testFS.readJSONFile(file))).toBeTrue();

console.log(`p 5`);

};
// specs.its.push(it);


Object.freeze(exports);