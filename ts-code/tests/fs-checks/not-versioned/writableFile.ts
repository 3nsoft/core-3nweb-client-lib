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
	description: '.writableFile',
	its: []
};

let it: SpecIt = {
	expectation: 'fails for non-existing file, in non-create mode'
};
it.func = async function(s) {
	const { testFS } = s;
	let fName = 'unknown-file';
	expect(await testFS.checkFilePresence(fName)).toBe(false);
	try {
		await testFS.writableFile(fName, {});
		fail('getting file object must fail, when file does not exist');
	} catch (err) {
		expect((err as FileException).notFound).toBe(true);
		if (!err.notFound) { throw err; }
	}
};
specs.its.push(it);

it = { expectation: 'fails for existing file, in exclusive create mode' };
it.func = async function(s) {
	const { testFS } = s;
	let fName = 'file';
	await testFS.writeTxtFile(fName, '');
	expect(await testFS.checkFilePresence(fName)).toBe(true);
	try {
		await testFS.writableFile(fName, { create:true, exclusive:true });
		fail('getting file object must fail, when file exists');
	} catch (err) {
		expect((err as FileException).alreadyExists).toBe(true);
		if (!err.alreadyExists) { throw err; }
	}
};
specs.its.push(it);

it = { expectation: 'gives file object for non-existing file' };
it.func = async function(s) {
	const { testFS } = s;
	let fName = 'new-file';
	expect(await testFS.checkFilePresence(fName)).toBe(false);
	
	let file = await testFS.writableFile(fName);
	expect(typeof file).toBe('object');
	expect(file.name).toBe(fName, 'file object should have file name');
	expect(file.isNew).toBe(true, 'readonly file must exist');
	expect(file.writable).toBe(true);
	expect(!!file.v).toBe(!!testFS.v);
	
	expect(await testFS.checkFilePresence(fName)).toBe(false, 'File does not exist, while nothing has been written to it.');

	let txt = 'some text';
	await file.writeTxt(txt);
	expect(await testFS.checkFilePresence(fName)).toBe(true, 'File is created on the first write.');
	expect(await file.readTxt()).toBe(txt);
};
specs.its.push(it);

Object.freeze(exports);