/*
 Copyright (C) 2022, 2025 3NSoft Inc.
 
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
import { defer } from '../../../../lib-common/processes/deferred';

type FileException = web3n.files.FileException;
type FSSyncException = web3n.files.FSSyncException;
type ReadonlyFS = web3n.files.ReadonlyFS;
type UploadStartEvent = web3n.files.UploadStartEvent;
type UploadDoneEvent = web3n.files.UploadDoneEvent;

export const specs: SpecDescribe = {
  description: '.v.sync.startedUpload',
  its: []
};

let it: SpecIt = { expectation: 'fails to read non-existent path' };
it.func = async function(s) {
	const { testFS } = s;
	const fName = 'unknown-file';
	expect(await testFS.checkFilePresence(fName)).toBe(false);
	await testFS.v!.sync!.startUpload(fName)
	.then(() => {
		fail('reading status must fail, when path does not exist');
	}, (err: FileException) => {
		expect(err.notFound).toBeTrue();
		if (!err.notFound) { throw err; }
	});
};
specs.its.push(it);

function collectFileUploadEvents(fs: ReadonlyFS, path: string): {
	startEvent: Promise<UploadStartEvent>; doneEvent: Promise<UploadDoneEvent>;
} {
	const startEvent = defer<UploadStartEvent>();
	const doneEvent = defer<UploadDoneEvent>();
	const unsub = fs.watchFile(path, {
		next: ev => {
			switch (ev.type) {
				case 'upload-started':
					startEvent.resolve(ev);
					break;
				case 'upload-done':
					doneEvent.resolve(ev);
					unsub();
					break;
			}
		}
	});
	return {
		startEvent: startEvent.promise,
		doneEvent: doneEvent.promise
	};
}

it = { expectation: 'uploads versions' };
it.func = async function(s) {
	const { testFS } = s;
	const file1 = 'some folder/file 1';

	const v1 = await testFS.v!.writeBytes(file1, await randomBytes(10));
	let syncStatus = await testFS.v!.sync!.status(file1, true);
	expect(syncStatus.state).toBe('unsynced');
	expect(syncStatus.synced).toBeUndefined();
	expect(syncStatus.local).toBeDefined();
	expect(syncStatus.local!.latest).toBe(v1);

	// file version written as a whole
	const v2 = await testFS.v!.writeBytes(file1, await randomBytes(10));
	syncStatus = await testFS.v!.sync!.status(file1, true);
	expect(syncStatus.local!.latest).toBe(v2);

	try {
		await testFS.v!.sync!.startUpload(file1, { localVersion: v1 });
		fail(`Version ${v1} is not current can't be upload`);
	} catch (exc) {
		expect((exc as FSSyncException).type).toBe('fs-sync');
	}

	let events = collectFileUploadEvents(testFS, file1);
	let startedUpload = await testFS.v!.sync!.startUpload(file1, { localVersion: v2 });
	expect(startedUpload).withContext(`upload should be started`).toBeDefined();
	expect(startedUpload!.uploadVersion).withContext(`first uploaded version should be equal to 1`).toBe(1);

	syncStatus = await testFS.v!.sync!.status(file1, true);
	expect(syncStatus.uploading).toBeDefined();
	expect(syncStatus.uploading!.localVersion).toBe(v2);
	expect(syncStatus.uploading!.remoteVersion).toBe(startedUpload!.uploadVersion);

	// await upload events and completion
	let startEvent = await events.startEvent;
	expect(startEvent.type).toBe('upload-started');
	expect(startEvent.uploadTaskId).toBe(startedUpload!.uploadTaskId);
	expect(startEvent.localVersion).toBe(v2);
	expect(startEvent.uploadVersion).toBe(startedUpload!.uploadVersion);
	expect(startEvent.totalBytesToUpload).toBeGreaterThan(10);

	await events.doneEvent;
	syncStatus = await testFS.v!.sync!.status(file1, true);
	expect(syncStatus.state).toBe('synced');
	expect(syncStatus.uploading).toBeUndefined();
	expect(syncStatus.synced).toBeDefined();
	expect(syncStatus.local).toBeUndefined();
	expect(syncStatus.synced!.latest).toBe(startedUpload!.uploadVersion);
	expect((await testFS.stat(file1)).version!).toBe(startedUpload!.uploadVersion);

	// file version written as a diff from a synced version
	const {
		sink: sink3, version: v3
	} = await testFS.v!.getByteSink(file1, { truncate: false });
	expect(v3).withContext(`normal increase of version by 1`).toBe(2);
	await sink3.splice(10, 0, await randomBytes(10));
	await sink3.done();
	syncStatus = await testFS.v!.sync!.status(file1, true);
	expect(syncStatus.local!.latest).toBe(v3);
	expect(syncStatus.uploading).toBeUndefined();

	events = collectFileUploadEvents(testFS, file1);

	// note upload of latest version, when version isn't given
	startedUpload = await testFS.v!.sync!.startUpload(file1);
	expect(startedUpload!.uploadVersion)
	.withContext(`next uploaded version increases by 1`)
	.toBe(2);
	syncStatus = await testFS.v!.sync!.status(file1, true);
	expect(syncStatus.uploading)
	.withContext(`started upload normally won't be fast to complete by this point`)
	.toBeDefined();
	expect(syncStatus.uploading!.localVersion).toBe(v3);
	expect(syncStatus.uploading!.remoteVersion).toBe(2);

	// watch and await upload completion
	await events.doneEvent;
	syncStatus = await testFS.v!.sync!.status(file1, true);
	expect(syncStatus.uploading)
	.withContext(`upload must be complete after watch end`)
	.toBeUndefined();

	// file version written as a diff from a synced version and diff of that
	let sink = (await testFS.v!.getByteSink(file1, { truncate: false })).sink;
	await sink.splice(20, 0, await randomBytes(10));
	await sink.done();
	sink = (await testFS.v!.getByteSink(file1, { truncate: false })).sink;
	await sink.splice(25, 0, await randomBytes(10));
	await sink.done();
	syncStatus = await testFS.v!.sync!.status(file1, true);
	expect(syncStatus.local!.latest).toBe(v3 + 2);

	events = collectFileUploadEvents(testFS, file1);

	startedUpload = await testFS.v!.sync!.startUpload(file1);
	expect(startedUpload!.uploadVersion)
	.withContext(`next uploaded version increases by 1`)
	.toBe(3);
	await events.doneEvent;
	syncStatus = await testFS.v!.sync!.status(file1, true);
	expect(syncStatus.uploading)
	.withContext(`upload must be complete after watch end`)
	.toBeUndefined();

	// upload of uploaded is a noop
	startedUpload = await testFS.v!.sync!.startUpload(file1);
	expect(startedUpload)
	.withContext(`noop returns undefined, as upload wasn't started`)
	.toBeUndefined();
	expect(deepEqual(syncStatus, await testFS.v!.sync!.status(file1, true)))
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
	let syncStatus = await testFS.v!.sync!.status(file1, true);
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
	syncStatus = await testFS.v!.sync!.status(file1, true);
	expect(syncStatus.synced!.latest)
	.withContext(`next uploaded version increases by 1`).toBe(2);

};
// XXX add this, when changed to proper event checking
// specs.its.push(it);


Object.freeze(exports);