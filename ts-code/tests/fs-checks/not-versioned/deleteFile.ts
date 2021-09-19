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
	description: '.deleteFile',
	its: []
};

let it: SpecIt = { expectation: 'cannot delete non-existing file' };
it.func = async function(s) {
	const { testFS } = s;
	const fName = 'non-existing-file';
	expect(await testFS.checkFilePresence(fName)).toBe(false);
	await testFS.deleteFile(fName)
	.then(() => {
		fail('deleting non-existing file must fail');
	}, (exc: FileException) => {
		expect(exc.notFound).toBe(true);
	});

	await testFS.makeFolder(fName);
	expect(await testFS.checkFolderPresence(fName)).toBe(true);
	await testFS.deleteFile(fName)
	.then(() => {
		fail('deleting folder as file must fail');
	}, (exc: FileException) => {
		expect(exc.notFile || exc.opNotPermitted).withContext('folder is not a file').toBe(true, );
	});
};
specs.its.push(it);

it = { expectation: 'deletes file' };
it.func = async function(s) {
	const { testFS } = s;
	for (const fName of [ 'file1', 'folder/file1' ]) {
		await testFS.writeTxtFile(fName, '');
		expect(await testFS.checkFilePresence(fName)).toBe(true);
		await testFS.deleteFile(fName);
		expect(await testFS.checkFilePresence(fName)).toBe(false);
	}
};
specs.its.push(it);

Object.freeze(exports);