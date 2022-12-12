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

import { bytes as randomBytes } from '../../../../lib-common/random-node';
import { SpecDescribe } from '../../../libs-for-tests/spec-module';
import { SpecIt } from '../test-utils';
import { deepEqual } from '../../../libs-for-tests/json-equal';

type FileException = web3n.files.FileException;
type FSSyncException = web3n.files.FSSyncException;

export const specs: SpecDescribe = {
	description: '.v.sync.upload',
	its: []
};

let it: SpecIt = { expectation: 'fails to read non-existent path' };
it.func = async function(s) {
	const { testFS } = s;
	const fName = 'unknown-file';
	expect(await testFS.checkFilePresence(fName)).toBe(false);
	await testFS.v!.sync!.upload(fName)
	.then(() => {
		fail('reading status must fail, when path does not exist');
	}, (err: FileException) => {
		expect(err.notFound).toBeTrue();
		if (!err.notFound) { throw err; }
	});
};
specs.its.push(it);

it = { expectation: 'uploads versions' };
it.func = async function(s) {
	const { testFS } = s;
	const file1 = 'some folder/file 1';

	const v1 = await testFS.v!.writeBytes(file1, await randomBytes(10));
	let syncStatus = await testFS.v!.sync!.status(file1);
	expect(syncStatus.state).toBe('unsynced');
	expect(syncStatus.synced).toBeUndefined();
	expect(syncStatus.local).toBeDefined();
	expect(syncStatus.local!.latest).toBe(v1);

	// file version written as a whole
	const v2 = await testFS.v!.writeBytes(file1, await randomBytes(10));
	syncStatus = await testFS.v!.sync!.status(file1);
	expect(syncStatus.local!.latest).toBe(v2);

	try {
		await testFS.v!.sync!.upload(file1, { localVersion: v1 });
		fail(`Version ${v1} is not current can't be upload`);
	} catch (exc) {
		expect((exc as FSSyncException).type).toBe('fs-sync');
	}

	let uploadedVersion = await testFS.v!.sync!.upload(
		file1, { localVersion: v2 }
	);
	expect(uploadedVersion)
	.withContext(`first uploaded version should be equal to 1`)
	.toBe(1);

	syncStatus = await testFS.v!.sync!.status(file1);
	expect(syncStatus.state).toBe('synced');
	expect(syncStatus.synced).toBeDefined();
	expect(syncStatus.local).toBeUndefined();
	expect(syncStatus.synced!.latest).toBe(uploadedVersion);
	expect((await testFS.stat(file1)).version!).toBe(uploadedVersion!);

	// file version written as a diff from a synced version
	const {
		sink: sink3, version: v3
	} = await testFS.v!.getByteSink(file1, { truncate: false });
	expect(v3).withContext(`normal increase of version by 1`).toBe(2);
	await sink3.splice(10, 0, await randomBytes(10));
	await sink3.done();
	syncStatus = await testFS.v!.sync!.status(file1);
	expect(syncStatus.local!.latest).toBe(v3);

	// note upload of latest version, when version isn't given
	uploadedVersion = await testFS.v!.sync!.upload(file1);
	expect(uploadedVersion)
	.withContext(`next uploaded version increases by 1`)
	.toBe(2);

	// file version written as a diff from a synced version and diff of that
	let sink = (await testFS.v!.getByteSink(file1, { truncate: false })).sink;
	await sink.splice(20, 0, await randomBytes(10));
	await sink.done();
	sink = (await testFS.v!.getByteSink(file1, { truncate: false })).sink;
	await sink.splice(25, 0, await randomBytes(10));
	await sink.done();
	syncStatus = await testFS.v!.sync!.status(file1);
	expect(syncStatus.local!.latest).toBe(v3 + 2);

	uploadedVersion = await testFS.v!.sync!.upload(file1);
	expect(uploadedVersion)
	.withContext(`next uploaded version increases by 1`)
	.toBe(3);
	syncStatus = await testFS.v!.sync!.status(file1);

	// upload of uploaded is a noop
	uploadedVersion = await testFS.v!.sync!.upload(file1);
	expect(uploadedVersion)
	.withContext(`noop returns no version, as nothing was uploaded`)
	.toBeUndefined();
	expect(deepEqual(syncStatus, await testFS.v!.sync!.status(file1)))
	.withContext(`nothing changed with noop`)
	.toBeTrue();

};
specs.its.push(it);

const mb = 1024*1024;

it = { expectation: 'uploads big file versions', timeout: 10000 };
it.func = async function(s) {
	const { testFS } = s;
	const file1 = 'some folder/file 1';

	// file version written as a whole
	await testFS.v!.writeBytes(file1, await randomBytes(3*mb));
	await testFS.v!.sync!.upload(file1);
	let syncStatus = await testFS.v!.sync!.status(file1);
	expect(syncStatus.synced!.latest)
	.withContext(`first uploaded version should be equal to 1`).toBe(1);
	expect((await testFS.stat(file1)).version!).toBe(1);

	// file version written as a diff from a synced version
	const {
		sink: sinkForV2, version: v2
	} = await testFS.v!.getByteSink(file1, { truncate: false });
	expect(v2).withContext(`normal increase of version by 1`).toBe(2);
	await sinkForV2.splice(2*mb, 0, await randomBytes(2*mb));
	await sinkForV2.done();
	await testFS.v!.sync!.upload(file1);
	syncStatus = await testFS.v!.sync!.status(file1);
	expect(syncStatus.synced!.latest)
	.withContext(`next uploaded version increases by 1`).toBe(2);

};
specs.its.push(it);

it = { expectation: 'refuses to upload folder if any child is never uploaded' };
it.func = async function(s) {
	const { testFS } = s;
	const folder = 'folder-to-upload';
	const childName = `child-file`;
	const childPath = `${folder}/${childName}`;

	expect(await testFS.checkFolderPresence(folder)).toBeFalse();
	await testFS.writeBytes(childPath, await randomBytes(10));
	expect(await testFS.checkFolderPresence(folder)).toBeTrue();
	let syncStatus = await testFS.v!.sync!.status(childPath);
	expect(syncStatus.synced).toBeUndefined();
	expect(syncStatus.existsInSyncedParent).toBeFalsy();

	// child never uploaded at this point
	await testFS.v!.sync!.upload(folder).then(
		() => fail(`upload of folder must fail with child that was never uploaded`),
		(exc: FSSyncException) => {
			expect(exc.type).toBe('fs-sync');
			expect(exc.childNeverUploaded).toBeTrue();
			expect(exc.childName).toBe(childName);
		}
	);

	// upload child and update into unsynced state
	await testFS.v!.sync!.upload(childPath);
	syncStatus = await testFS.v!.sync!.status(childPath);
	expect(syncStatus.state).toBe('synced');
	expect(syncStatus.existsInSyncedParent).toBeFalsy();
	await testFS.writeBytes(childPath, await randomBytes(20));
	syncStatus = await testFS.v!.sync!.status(childPath);
	expect(syncStatus.synced).toBeDefined();
	expect(syncStatus.state).toBe('unsynced');
	expect(syncStatus.existsInSyncedParent).toBeFalsy();

	await testFS.v!.sync!.upload(folder);
	syncStatus = await testFS.v!.sync!.status(folder);
	expect(syncStatus.state).toBe('synced');

	// note again that upload is not uploading children
	syncStatus = await testFS.v!.sync!.status(childPath);
	expect(syncStatus.state).toBe('unsynced');
	expect(syncStatus.existsInSyncedParent).toBeTruthy();

};
specs.its.push(it);


Object.freeze(exports);