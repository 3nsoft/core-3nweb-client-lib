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
import { deepEqual } from '../../libs-for-tests/json-equal';
import { SpecIt } from '../test-utils';

type FileException = web3n.files.FileException;

export const specs: SpecDescribe = {
	description: '.writeJSONFile',
	its: []
};

let it: SpecIt = { expectation: 'if not allowed to create, fails for missing file' };
it.func = async function(s) {
	const { testFS } = s;
	let json = { a: 1, b: 2 };
	await testFS.writeJSONFile('non-existing-file', json, {})
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
	let initJson = { a: 1, b: 2 };
	expect(await testFS.checkFilePresence(path)).toBe(false);
	let v = await testFS.v!.writeJSONFile(path, initJson);
	expect(await testFS.checkFilePresence(path)).toBe(true);
	let { json, version } = await testFS.v!.readJSONFile(path);
	expect(deepEqual(initJson, json)).toBe(true);
	expect(version).toBe(v);
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
	let initJson = { a: 'foo', b: true, 'df-df': 23};
	let v = await testFS.v!.writeJSONFile(path, initJson);
	expect(await testFS.checkFolderPresence(grParent)).toBe(true);
	expect(await testFS.checkFolderPresence(parent2)).toBe(true);
	expect(await testFS.checkFilePresence(path)).toBe(true);
	let { json, version } = await testFS.v!.readJSONFile(path);
	expect(deepEqual(initJson, json)).toBe(true);
	expect(version).toBe(v);
};
specs.its.push(it);

it = { expectation: 'over-writes existing file with a non-exclusive call' };
it.func = async function(s) {
	const { testFS } = s;
	let path = 'file3';
	// setup initial file
	let initJson = { a: 'foo', b: true, 'df-df': 23};
	let v1 = await testFS.v!.writeJSONFile(path, initJson);
	expect(await testFS.checkFilePresence(path)).toBe(true);
	let { json, version } = await testFS.v!.readJSONFile(path);
	expect(deepEqual(initJson, json)).toBe(true);
	expect(version).toBe(v1);
	// write new file content
	let newJson = null;
	let v2 = await testFS.v!.writeJSONFile(path, newJson);
	expect(await testFS.checkFilePresence(path)).toBe(true);
	({ json, version } = await testFS.v!.readJSONFile(path));
	expect(deepEqual(newJson, json)).toBe(true);
	expect(version).toBe(v2);
};
specs.its.push(it);

it = { expectation: 'exclusive-create write throws when file already exists' };
it.func = async function(s) {
	const { testFS } = s;
	let path = 'file4';
	// setup initial file
	let initJson = { a: 'foo', b: true, 'df-df': 23};
	let v = await testFS.v!.writeJSONFile(path, initJson);
	expect(await testFS.checkFilePresence(path)).toBe(true);
	// try an exclusive write
	let newJson = null;
	await testFS.writeJSONFile(path, newJson, { create:true, exclusive:true })
	.then(() => {
		fail('exclusive-create write operation must fail, when file exists.');
	}, (exc: FileException) => {
		expect(exc.alreadyExists).toBe(true);
	});
	let { json, version } = await testFS.v!.readJSONFile(path);
	expect(deepEqual(initJson, json)).toBe(true, 'initial file content stays intact');
	expect(version).toBe(v, 'initial file version stays intact');
};
specs.its.push(it);

Object.freeze(exports);