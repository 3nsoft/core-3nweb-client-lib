/*
 Copyright (C) 2022 3NSoft Inc.
 
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
	description: '.v.listVersions',
	its: []
};

let it: SpecIt = { expectation: 'fails on non-existing path' };
it.func = async function(s) {
	const { testFS } = s;
	const fName = 'non-existing-path';
	await testFS.v!.listVersions(fName).then(
		() => fail('should fail for non-existing folder'),
		exc => {
			expect((exc as FileException).notFound).toBe(true);
		}
	);
};
specs.its.push(it);

it = { expectation: `shows item's versions` };
it.func = async function(s) {
	const { testFS } = s;
	const folderPath = `some/dir`;
	const filePath = `${folderPath}/file`;
	const fileVer = await testFS.v!.writeTxtFile(filePath, 'some');
	let versions = await testFS.v!.listVersions(filePath);
	expect(versions.current).toBe(fileVer);
	expect(versions.archived).toBeUndefined();
	const folderVer = (await testFS.stat(folderPath)).version!;
	versions = await testFS.v!.listVersions(folderPath);
	expect(versions.current).toBe(folderVer);
	expect(versions.archived).toBeUndefined();
};
specs.its.push(it);


Object.freeze(exports);