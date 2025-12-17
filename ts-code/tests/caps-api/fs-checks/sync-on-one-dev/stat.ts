/*
 Copyright (C) 2025 3NSoft Inc.
 
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

import { sleep } from '../../../../lib-common/processes/sleep';
import { bytes as randomBytes } from '../../../../lib-common/random-node';
import { SpecDescribe } from '../../../libs-for-tests/spec-module';
import { SpecIt } from '../test-utils';

type FileException = web3n.files.FileException;

export const specs: SpecDescribe = {
	description: '.v.stat',
	its: []
};

let it: SpecIt = { expectation: 'fails to read non-existent path' };
it.func = async function(s) {
	const { testFS } = s;
	const fName = 'unknown-file';
	expect(await testFS.checkFilePresence(fName)).toBe(false);
	await testFS.v!.stat(fName)
	.then(() => {
		fail('reading status must fail, when path does not exist');
	}, (err: FileException) => {
		expect(err.notFound).toBe(true);
		if (!err.notFound) { throw err; }
	});
};
specs.its.push(it);

it = { expectation: `gets stats` };
it.func = async function(s) {
	const { testFS } = s;
	const file1 = 'some folder/file 1';
	const fstSize = 10;
	await testFS.v!.writeBytes(file1, await randomBytes(fstSize));
	const v1stats = await testFS.stat(file1);
	expect(v1stats.versionSyncBranch).toBe('local');
	await sleep(10);
	await testFS.v!.sync!.upload(file1);
	await sleep(10);
	const sndSize = 20;
	await testFS.v!.writeBytes(file1, await randomBytes(sndSize));
	const syncStatus = await testFS.v!.sync!.status(file1, true);

	const statsLocal = await testFS.v!.stat(file1);
	expect(statsLocal.version).toBe(syncStatus.local?.latest);
	expect(statsLocal.size).toBe(sndSize);

	const statsSynced = await testFS.v!.stat(file1, { remoteVersion: syncStatus.synced?.latest });
	expect(statsSynced.version).toBe(syncStatus.synced?.latest);
	expect(statsSynced.size).toBe(fstSize);
	expect(statsSynced.versionSyncBranch).toBe('synced');

	expect(statsSynced.ctime!.valueOf()).toBe(statsLocal.ctime!.valueOf());
	expect(statsSynced.mtime!.valueOf()).toBeLessThan(statsLocal.mtime!.valueOf());
	expect(statsSynced.ctime!.valueOf()).toBe(v1stats.ctime!.valueOf());
	expect(statsSynced.mtime!.valueOf()).toBe(v1stats.mtime!.valueOf());
};
specs.its.push(it);

Object.freeze(exports);