/*
 Copyright (C) 2016, 2018, 2020, 2025 3NSoft Inc.
 
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

import { SpecDescribe } from '../../../libs-for-tests/spec-module';
import { SpecIt } from '../test-utils';

type FileException = web3n.files.FileException;

export const specs: SpecDescribe = {
	description: '.move',
	its: []
};

let it: SpecIt = { expectation: 'cannot move non-existing element' };
it.func = async function(s) {
	const { testFS } = s;
	for (let src of ['non/existing/thing', 'thing']) {
		await testFS.move(src, 'thing2')
		.then(() => {
			fail('move should fail, when source path does not exist');
		}, (exc: FileException) => {
			expect(exc.notFound).toBe(true);
		});
	}
};
specs.its.push(it);

it = { expectation: 'cannot move when destination path already exists' };
it.func = async function(s) {
	const { testFS } = s;
	let src = 'folder1/file';
	let srcFileContent = '1st file';
	await testFS.writeTxtFile(src, srcFileContent);
	for (let dst of [ 'folder2/file2', 'folder1/file2' ]) {
		await testFS.writeTxtFile(dst, '2nd file');
		expect(await testFS.readTxtFile(dst)).not.toBe(srcFileContent);

		await testFS.move(src, dst)
		.then(() => {
			fail('move should fail, when destination path already exists');
		}, (exc: FileException) => {
			expect(exc.alreadyExists).toBe(true);
		});
		expect(await testFS.readTxtFile(dst)).not.toBe(srcFileContent, 'existing destination path should stay intact');
	}
};
specs.its.push(it);

it = { expectation: 'moves element in the same folder' };
it.func = async function(s) {
	const { testFS } = s;

	// moving folder
	let src = 'folder3/folder';
	let dst = 'folder3/folder-moved';
	await testFS.makeFolder(src);
	expect(await testFS.checkFolderPresence(src)).toBe(true);
	expect(await testFS.checkFolderPresence(dst)).toBe(false);
	await testFS.move(src, dst);
	expect(await testFS.checkFolderPresence(src)).toBe(false);
	expect(await testFS.checkFolderPresence(dst)).toBe(true);

	// moving file
	src = 'folder3/file';
	dst = 'folder3/file-moved';
	await testFS.writeTxtFile(src, 'file to move');
	expect(await testFS.checkFilePresence(src)).toBe(true);
	expect(await testFS.checkFilePresence(dst)).toBe(false);
	await testFS.move(src, dst);
	expect(await testFS.checkFilePresence(src)).toBe(false);
	expect(await testFS.checkFilePresence(dst)).toBe(true);

};
specs.its.push(it);

it = { expectation: 'moves element to a different folder' };
it.func = async function(s) {
	const { testFS } = s;

	// moving folder
	let src = 'folder4/folder';
	let dst = 'folder5/folder-moved';
	await testFS.makeFolder(src);
	expect(await testFS.checkFolderPresence(src)).toBe(true);
	expect(await testFS.checkFolderPresence(dst)).toBe(false);
	await testFS.move(src, dst);
	expect(await testFS.checkFolderPresence(src)).toBe(false);
	expect(await testFS.checkFolderPresence(dst)).toBe(true);

	// moving file
	src = 'folder4/file';
	dst = 'folder5/file-moved';
	await testFS.writeTxtFile(src, 'file to move');
	expect(await testFS.checkFilePresence(src)).toBe(true);
	expect(await testFS.checkFilePresence(dst)).toBe(false);
	await testFS.move(src, dst);
	expect(await testFS.checkFilePresence(src)).toBe(false);
	expect(await testFS.checkFilePresence(dst)).toBe(true);
};
specs.its.push(it);

it = { expectation: 'creates parent section(s) in destination path' };
it.func = async function(s) {
	const { testFS } = s;

	// moving folder
	let src = 'folder6/folder';
	let dstParent = 'folder6.dst/sub-folder';
	let dst = `${dstParent}/folder-moved`;
	await testFS.makeFolder(src);
	expect(await testFS.checkFolderPresence(src)).toBe(true);
	expect(await testFS.checkFolderPresence(dstParent)).toBe(false);
	await testFS.move(src, dst);
	expect(await testFS.checkFolderPresence(src)).toBe(false);
	expect(await testFS.checkFolderPresence(dst)).toBe(true);

	// moving file
	src = 'folder6/file';
	dstParent = 'folder6.dst-2/sub-folder-2';
	dst = `${dstParent}/file-moved`;
	await testFS.writeTxtFile(src, 'file to move');
	expect(await testFS.checkFilePresence(src)).toBe(true);
	expect(await testFS.checkFolderPresence(dstParent)).toBe(false);
	await testFS.move(src, dst);
	expect(await testFS.checkFilePresence(src)).toBe(false);
	expect(await testFS.checkFilePresence(dst)).toBe(true);
};
specs.its.push(it);

Object.freeze(exports);