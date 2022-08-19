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

import { bytes as randomBytes } from '../../../lib-common/random-node';
import { SpecDescribe } from '../../libs-for-tests/spec-module';
import { SpecIt } from '../test-utils';

type FileException = web3n.files.FileException;

export const specs: SpecDescribe = {
	description: '.v.sync.status',
	its: []
};

let it: SpecIt = { expectation: 'fails to read non-existent path' };
it.func = async function(s) {
	const { testFS } = s;
	const fName = 'unknown-file';
	expect(await testFS.checkFilePresence(fName)).toBe(false);
	await testFS.v!.sync!.status(fName)
	.then(() => {
		fail('reading status must fail, when path does not exist');
	}, (err: FileException) => {
		expect(err.notFound).toBe(true);
		if (!err.notFound) { throw err; }
	});
};
specs.its.push(it);

it = { expectation: 'gets synchronization status' };
it.func = async function(s) {
	const { testFS } = s;
	const file1 = 'some folder/file 1';
	const v1 = await testFS.v!.writeBytes(file1, await randomBytes(10));
	const syncStatus = await testFS.v!.sync!.status(file1);
	expect(syncStatus.state).toBe('unsynced');
	expect(syncStatus.local!.latest).toBe(v1);
	expect(syncStatus.synced).toBeUndefined();
	expect(syncStatus.remote).toBeUndefined();
};
specs.its.push(it);

Object.freeze(exports);