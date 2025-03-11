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

import { stringOfB64Chars, bytes as randomBytes } from '../../../../lib-common/random-node';
import { SpecDescribe } from '../../../libs-for-tests/spec-module';
import { SpecIt } from '../test-utils';

type FileException = web3n.files.FileException;
type FSSyncException = web3n.files.FSSyncException;

export const specs: SpecDescribe = {
	description: '.v.archiveCurrent',
	its: []
};

let it: SpecIt = { expectation: 'fails on non-existing path' };
it.func = async function(s) {
	const { testFS } = s;
	const fName = 'non-existing-path';
	await testFS.v!.archiveCurrent(fName).then(
		() => fail('should fail for non-existing folder'),
		exc => {
			expect((exc as FileException).notFound).toBe(true);
		}
	);
};
specs.its.push(it);

it = { expectation: 'archives current synced version' };
it.func = async function(s) {
	const { testFS } = s;
	const filePath = `with archived inside/file`;
	const initFileTxt = await stringOfB64Chars(30);
	await testFS.v!.writeTxtFile(filePath, initFileTxt);
	let versions = await testFS.v!.listVersions(filePath);
	expect(versions.archived).toBeUndefined();
	if (testFS.v!.sync) {
		let syncStatus = await testFS.v!.sync.status(filePath);
		expect(syncStatus.state).toBe('unsynced');
		await testFS.v!.archiveCurrent(filePath).then(
			() => fail(`synced fs can archive only synced version`),
			(exc: FSSyncException) => {
				expect(exc.type).toBe('fs-sync');
				expect(exc.notSynced).toBeTrue();
			}
		);
		await testFS.v!.sync.upload(filePath);
		syncStatus = await testFS.v!.sync.status(filePath);
		expect(syncStatus.state).toBe('synced');
		expect(syncStatus.synced!.archived).toBeUndefined();
		await testFS.v!.archiveCurrent(filePath);
		syncStatus = await testFS.v!.sync.status(filePath);
		expect(syncStatus.synced!.archived).toContain(syncStatus.synced!.latest);
	} else {
		await testFS.v!.archiveCurrent(filePath);
	}
	const fileVer = (await testFS.stat(filePath)).version!;
	versions = await testFS.v!.listVersions(filePath);
	expect(versions.archived).toContain(fileVer);

	// after writing new version, archived version can be read
	expect(await testFS.v!.writeBytes(filePath, await randomBytes(60)))
	.toBeGreaterThan(fileVer);
	expect(
		(await testFS.v!.readTxtFile(filePath, { archivedVersion: fileVer })).txt
	).toBe(initFileTxt);
	if (testFS.v!.sync) {
		await testFS.v!.sync.upload(filePath);
		expect(
			(await testFS.v!.readTxtFile(filePath, { archivedVersion: fileVer })).txt
		).toBe(initFileTxt);
	}
};
specs.its.push(it);


Object.freeze(exports);