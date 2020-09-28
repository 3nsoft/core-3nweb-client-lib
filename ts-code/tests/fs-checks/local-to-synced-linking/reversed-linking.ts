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
import { SpecItWithTwoFSs } from '../test-utils';

export const specs: SpecDescribe = {
	description: '.link should fail to link from synced into local storage,',
	its: []
};

let it: SpecItWithTwoFSs = { expectation: 'linking file' };
it.func = async function(s) {
	const { syncedTestFS, localTestFS } = s;
	const original = 'Should I be at BlackHat conference or working?';
	const fName = 'file1';
	await localTestFS.writeTxtFile(fName, original);
	const file = await localTestFS.readonlyFile(fName);

	const linkPath = 'link1';
	await syncedTestFS.link(linkPath, file).catch((err) => {
		expect(typeof err).toBe('object');
	});
};
specs.its.push(it);

it = { expectation: 'linking folder' };
it.func = async function(s) {
	const { syncedTestFS, localTestFS } = s;
	const original = 'Should I be at BlackHat conference or working?';
	const folderName = 'folder1';
	const fName = 'file1';
	await localTestFS.writeTxtFile(`${folderName}/${fName}`, original);
	const folder = await localTestFS.writableSubRoot(folderName);

	const linkPath = 'link1';
	await syncedTestFS.link(linkPath, folder).catch((err) => {
		expect(typeof err).toBe('object');
	});
};
specs.its.push(it);
