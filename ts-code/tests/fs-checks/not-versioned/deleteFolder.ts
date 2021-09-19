/*
 Copyright (C) 2016, 2020 3NSoft Inc.
 
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
	description: '.deleteFile',
	its: []
};

let it: SpecIt = { expectation: 'lists root' };
it.func = async function(s) {
	const { testFS } = s;
	const fName = 'non-existing-folder';
	expect(await testFS.checkFolderPresence(fName)).toBe(false);
	await testFS.deleteFolder(fName)
	.then(() => {
		fail('deleting non-existing folder must fail');
	}, (exc: FileException) => {
		expect(exc.notFound).toBe(true);
	});

	await testFS.writeTxtFile(fName, '');
	expect(await testFS.checkFilePresence(fName)).toBe(true);
	await testFS.deleteFolder(fName)
	.then(() => {
		fail('deleting file as folder must fail');
	}, (exc: FileException) => {
		expect(exc.notDirectory || exc.notFound).withContext('folder is not a file').toBe(true, );
	});
};
specs.its.push(it);

it = { expectation: 'deletes folder' };
it.func = async function(s) {
	const { testFS } = s;
	for (const fName of [ 'folder1', 'parent/folder2' ]) {
		await testFS.makeFolder(fName);
		expect(await testFS.checkFolderPresence(fName)).toBe(true);
		await testFS.deleteFolder(fName);
		expect(await testFS.checkFolderPresence(fName)).toBe(false);
	}
};
specs.its.push(it);

it = { expectation: 'will delete folder with content, only when flag is set' };
it.func = async function(s) {
	const { testFS } = s;
	const fName = 'folder';
	await testFS.makeFolder(fName);
	expect(await testFS.checkFolderPresence(fName)).toBe(true);
	await testFS.writeTxtFile(fName+'/folder2/file1', '');
	await testFS.writeTxtFile(fName+'/file2', '');
	
	await testFS.deleteFolder(fName)
	.then(() => {
		fail('cannot remove folder with content, when flag is not set');
	}, (exc: FileException) => {
		expect(exc.notEmpty).toBe(true);
	});
	expect(await testFS.checkFolderPresence(fName)).toBe(true);

	await testFS.deleteFolder(fName, true);
	expect(await testFS.checkFolderPresence(fName)).toBe(false);
};
specs.its.push(it);


Object.freeze(exports);