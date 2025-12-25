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

import { stringOfB64CharsSync } from '../../../../lib-common/random-node';
import { SpecDescribe } from '../../../libs-for-tests/spec-module';
import { watchForEvents } from '../../../libs-for-tests/watching';
import { SpecItWithTwoDevsFSs } from '../test-utils';

type FSSyncException = web3n.files.FSSyncException;
type FolderEvent = web3n.files.FolderEvent;
type FileEvent = web3n.files.FileEvent;
type RemoteEvent = web3n.files.RemoteEvent;

export const specs: SpecDescribe = {
	description: '--',
	its: []
};

let it: SpecItWithTwoDevsFSs = {
	expectation: 'conflict in folder can be resolved by adopting remote version'
};
it.func = async function({ dev1FS, dev2FS }) {
	const file = 'file-for-conflict';

	let folderStatus = await dev2FS().v!.sync!.status('');
	expect(folderStatus.state).withContext(`from setup`).toBe('synced');

	// make file simulatneously on both devices
	await dev1FS().writeTxtFile(file, stringOfB64CharsSync(100));
	await dev2FS().writeTxtFile(file, stringOfB64CharsSync(70));
	folderStatus = await dev2FS().v!.sync!.status('');
	expect(folderStatus.state).toBe('unsynced');

	// and upload changes from dev1
	await dev1FS().v!.sync!.upload(file);
	await dev1FS().v!.sync!.upload('');
	folderStatus = await dev2FS().v!.sync!.status('');
	expect(folderStatus.state).toBe('conflicting');

	expect(await dev2FS().readTxtFile(file))
	.withContext(`we have placed a different content into these conflicting file versions`)
	.not.toBe(await dev1FS().readTxtFile(file));

	// folder versions diff is a tool for getting folder conflict details
	const diff = await dev2FS().v!.sync!.diffCurrentAndRemoteFolderVersions('');
	expect(diff).toBeDefined();
	expect(diff!.currentVersion).toBe(folderStatus.local!.latest!);
	expect(diff!.remoteVersion).toBe(folderStatus.remote!.latest!);
	expect(diff!.inCurrent!.find(item => ((item.name === file) && item.isFile)))
	.toBeDefined();
	expect(diff!.inRemote!.find(item => ((item.name === file) && item.isFile)))
	.toBeDefined();
	expect(diff!.nameOverlaps!).toContain(file);

	const syncEvents = watchForEvents<FolderEvent|RemoteEvent>(
		obs => dev2FS().watchFolder('', obs),
		2,
		ev => ((ev as FolderEvent).src === 'sync')
	);

	// adopt remote in a conflict state
	await dev2FS().v!.sync!.adoptRemote('').then(
		() => fail(``),
		(exc: FSSyncException) => {
			expect(exc.type).toBe('fs-sync');
			expect(exc.conflict).toBeTrue();
		}
	);
	await dev2FS().v!.sync!.adoptRemote('', { remoteVersion: folderStatus.remote!.latest });

	await syncEvents.completion;
	expect(syncEvents.collectedEvents.find(ev => (
		(ev.type === 'entry-removal') && (ev.name === file)
	)))
	.withContext(`Different object on the same path is removed`)
	.toBeDefined();
	expect(syncEvents.collectedEvents.find(ev => (
		(ev.type === 'entry-addition') && (ev.entry.name === file)
	)))
	.withContext(`Element from remote version is added`)
	.toBeDefined();

	folderStatus = await dev2FS().v!.sync!.status('');
	expect(folderStatus.state).toBe('synced');

	// we have also adopted here new file object on the same path
	expect(await dev2FS().readTxtFile(file))
	.withContext(`after adoption of folder dev2 reads correct file object`)
	.toBe(await dev1FS().readTxtFile(file));
	let fileStatus = await dev2FS().v!.sync!.status(file);
	expect(fileStatus.state)
	.withContext(`when a file system item is brought the first time from a server, its state should necessarily be synced`)
	.toBe('synced');
};
specs.its.push(it);

it = {
	expectation: `conflict in folder can be resolved by uploading local version, assembled from elements on both sides of the conflict`
};
it.func = async function({ dev1FS, dev2FS }) {
	const file = 'file-for-conflict';
	const fileFromDev1 = 'file-from-dev1';
	const fileFromDev2 = 'file-from-dev2';

	let folderStatus = await dev2FS().v!.sync!.status('');
	expect(folderStatus.state).withContext(`from setup`).toBe('synced');
	expect(folderStatus.synced?.latest).withContext(`from setup`).toBe(1);

	// make file simulatneously on both devices
	await dev1FS().writeTxtFile(file, stringOfB64CharsSync(100));
	await dev1FS().writeTxtFile(fileFromDev1, stringOfB64CharsSync(100));
	await dev2FS().writeTxtFile(file, stringOfB64CharsSync(70));
	await dev2FS().writeTxtFile(fileFromDev2, stringOfB64CharsSync(70));
	folderStatus = await dev2FS().v!.sync!.status('');
	expect(folderStatus.state).toBe('unsynced');
	// and upload changes from dev1
	await dev1FS().v!.sync!.upload(file);
	await dev1FS().v!.sync!.upload(fileFromDev1);
	await dev1FS().v!.sync!.upload('');
	// and upload on dev2 files, one will be adopted later, another removed
	await dev2FS().v!.sync!.upload(file);
	await dev2FS().v!.sync!.upload(fileFromDev2);

	folderStatus = await dev2FS().v!.sync!.status('');
	expect(folderStatus.state).toBe('conflicting');
	expect(folderStatus.remote?.latest).toBe(2);

	// folder versions diff is a tool for getting folder conflict details
	const diff = await dev2FS().v!.sync!.diffCurrentAndRemoteFolderVersions('');
	expect(diff).toBeDefined();
	expect(diff!.currentVersion).toBe(folderStatus.local!.latest!);
	expect(diff!.remoteVersion).toBe(folderStatus.remote!.latest!);
	expect(diff!.inCurrent!.find(item => (item.name === file))).toBeDefined();
	expect(diff!.inCurrent!.find(item => (item.name === fileFromDev2)))
	.toBeDefined();
	expect(diff!.inRemote!.find(item => (item.name === file))).toBeDefined();
	expect(diff!.inRemote!.find(item => (item.name === fileFromDev1)))
	.toBeDefined();
	expect(diff!.nameOverlaps!).toContain(file);

	// we can stat remote child
	let statsRemote = await dev2FS().v!.sync!.statRemoteItem('', file);
	let statsLocal = await dev2FS().stat(file);
	let statsOn1 = await dev1FS().stat(file);
	expect(statsRemote.mtime?.valueOf()).not.toBe(statsLocal.mtime?.valueOf());
	expect(statsRemote.mtime?.valueOf()).toBe(statsOn1.mtime?.valueOf());
	expect(statsRemote.size).not.toBe(statsLocal.size);
	expect(statsRemote.size).toBe(statsOn1.size);

	// we can read remote child
	let remoteChild = await dev2FS().v!.sync!.getRemoteFileItem('', file);
	expect(await remoteChild.readTxt()).toBe(await dev1FS().readTxtFile(file));
	expect((await remoteChild.stat()).size).toBe(statsOn1.size);

	// adopt on dev2 some remote elements from dev1
	await dev2FS().v!.sync!.adoptRemoteFolderItem('', file, { replaceLocalItem: true });
	await dev2FS().v!.sync!.adoptRemoteFolderItem('', fileFromDev1);

	expect(await dev2FS().readTxtFile(file))
	.toBe(await dev1FS().readTxtFile(file));
	expect(await dev2FS().readTxtFile(fileFromDev1))
	.toBe(await dev1FS().readTxtFile(fileFromDev1));
	expect(await dev1FS().checkFilePresence(fileFromDev2)).toBeFalse();

	// note need of explicit parameters when uploading from conflict state
	folderStatus = await dev2FS().v!.sync!.status('');
	expect(folderStatus.state).toBe('conflicting');
	await dev2FS().v!.sync!.upload('').then(
		() => fail(`Upload in conflict must require explicit parameters`),
		(exc: FSSyncException) => {
			expect(exc.type).toBe('fs-sync');
			expect(exc.versionMismatch).toBeTrue();
		}
	);

	// upload new version, now from dev2
	await dev2FS().v!.sync!.upload('', { uploadVersion: folderStatus.remote!.latest! + 1 });
	folderStatus = await dev2FS().v!.sync!.status('');
	expect(folderStatus.state).toBe('synced');
	expect(folderStatus.synced?.latest).toBe(3);

	// get new version on dev1 and check contents
	await dev1FS().v!.sync!.adoptRemote('');
	const lst = await dev1FS().listFolder('');
	expect(lst.find(e => ((e.name === file) && e.isFile))).toBeDefined();
	expect(lst.find(e => ((e.name === fileFromDev1) && e.isFile))).toBeDefined();
	expect(lst.find(e => ((e.name === fileFromDev2) && e.isFile))).toBeDefined();
	expect(await dev2FS().readTxtFile(fileFromDev2))
	.toBe(await dev1FS().readTxtFile(fileFromDev2));
};
specs.its.push(it);

it = {
	expectation: 'conflict in file can be resolved by adopting remote version'
};
it.func = async function({ dev1FS, dev2FS }) {
	const file = 'file-for-conflict';

	// create file on dev1 and upload, so that dev2 can get it
	await dev1FS().writeTxtFile(file, stringOfB64CharsSync(100));
	await dev1FS().v!.sync!.upload(file);
	await dev1FS().v!.sync!.upload('');
	await dev2FS().v!.sync!.status('');	// implicit check of server
	await dev2FS().v!.sync!.adoptRemote('');
	let fileStatus = await dev2FS().v!.sync!.status(file);
	expect(fileStatus.state).withContext(`when a file system item is brought the first time from a server, its state should necessarily be synced`)
	.toBe('synced');
	const fstObservedVersion = fileStatus.synced!.latest!;

	// change file on dev1 and propagate
	await dev1FS().writeTxtFile(file, stringOfB64CharsSync(200));
	await dev1FS().v!.sync!.upload(file);
	fileStatus = await dev2FS().v!.sync!.status(file);
	expect(fileStatus.state).withContext(`changes to a file system item that come from a server can be adopted only explicitly, and state should indicate that current version is behind remote one`).toBe('behind');
	expect(fileStatus.remote!.latest!).toBeGreaterThan(fstObservedVersion);

	// change file on dev2 to reach conflict state
	await dev2FS().writeTxtFile(file, stringOfB64CharsSync(150));
	fileStatus = await dev2FS().v!.sync!.status(file);
	expect(fileStatus.state).toBe('conflicting');

	const syncEvents = watchForEvents<FileEvent|RemoteEvent>(
		obs => dev2FS().watchFile(file, obs),
		1,
		ev => ((ev as FolderEvent).src === 'sync')
	);

	// adopt remote in a conflict state
	await dev2FS().v!.sync!.adoptRemote(file).then(
		() => fail(``),
		(exc: FSSyncException) => {
			expect(exc.type).toBe('fs-sync');
			expect(exc.conflict).toBeTrue();
		}
	);
	await dev2FS().v!.sync!.adoptRemote(file, { remoteVersion: fileStatus.remote!.latest });

	await syncEvents.completion;
	expect(syncEvents.collectedEvents.find(ev => (ev.type === 'file-change')))
	.withContext(``)
	.toBeDefined();

	fileStatus = await dev2FS().v!.sync!.status('');
	expect(fileStatus.state).toBe('synced');
	expect(await dev2FS().readTxtFile(file))
	.toBe(await dev1FS().readTxtFile(file));
};
specs.its.push(it);

it = {
	expectation: 'conflict in file can be resolved by uploading local version'
};
it.func = async function({ dev1FS, dev2FS }) {
	const file = 'file-for-conflict';

	// create file on dev1 and upload, so that dev2 can get it
	await dev1FS().writeTxtFile(file, stringOfB64CharsSync(100));
	await dev1FS().v!.sync!.upload(file);
	await dev1FS().v!.sync!.upload('');
	await dev2FS().v!.sync!.status('');	// implicit check of server
	await dev2FS().v!.sync!.adoptRemote('');

	// change file on dev1 and dev2
	await dev1FS().writeTxtFile(file, stringOfB64CharsSync(200));
	await dev2FS().writeTxtFile(file, stringOfB64CharsSync(150));

	// and upload changes from dev1 to reach conflict on dev2
	await dev1FS().v!.sync!.upload(file);
	let fileStatusOnDev2 = await dev2FS().v!.sync!.status(file);
	expect(fileStatusOnDev2.state).toBe('conflicting');

	// push version on dev2 higher to see it going down to uploaded level
	for (let i=0; i<3; i+=1) {
		await dev2FS().writeTxtFile(file, stringOfB64CharsSync(151+i));
	}
	const remoteVersionBeforeUpload = fileStatusOnDev2.remote!.latest!;
	expect((await dev2FS().stat(file)).version!)
	.toBeGreaterThan(remoteVersionBeforeUpload+1);

	await dev2FS().v!.sync!.upload(file).then(
		() => fail(`Upload in conflicting state should require explicit versioning`),
		(exc: FSSyncException) => {
			expect(exc.versionMismatch).toBeTrue();
		}
	);
	await dev2FS().v!.sync!.upload(file, { uploadVersion: fileStatusOnDev2.remote!.latest! + 1 });

	fileStatusOnDev2 = await dev2FS().v!.sync!.status(file);
	expect(fileStatusOnDev2.state).toBe('synced');
	expect(fileStatusOnDev2.synced!.latest!).toBe(remoteVersionBeforeUpload+1);

	await dev1FS().v!.sync!.status(file);	// implicit check of server
	await dev1FS().v!.sync!.adoptRemote(file);
	expect(await dev2FS().readTxtFile(file))
	.toBe(await dev1FS().readTxtFile(file));
};
specs.its.push(it);

it = {
	expectation: 'upload over conflict concurrent with file write via sink'
};
it.func = async function({ dev1FS, dev2FS }) {
	const file = 'file-for-conflict';

	// create file on dev1 and upload, so that dev2 can get it
	await dev1FS().writeTxtFile(file, stringOfB64CharsSync(100));
	await dev1FS().v!.sync!.upload(file);
	await dev1FS().v!.sync!.upload('');
	await dev2FS().v!.sync!.status('');	// implicit check of server
	await dev2FS().v!.sync!.adoptRemote('');

	// change file on dev1 and dev2
	await dev1FS().writeTxtFile(file, stringOfB64CharsSync(200));
	await dev2FS().writeTxtFile(file, stringOfB64CharsSync(150));

	// and upload changes from dev1 to reach conflict on dev2
	await dev1FS().v!.sync!.upload(file);
	let fileStatusOnDev2 = await dev2FS().v!.sync!.status(file);
	expect(fileStatusOnDev2.state).toBe('conflicting');
	expect(fileStatusOnDev2.remote!.latest!).toBe(2);

	// push version on dev2 higher to see it going down to uploaded level
	let contentBeforeUpload: string = undefined as any;
	for (let i=0; i<3; i+=1) {
		contentBeforeUpload = stringOfB64CharsSync(151+i);
		await dev2FS().writeTxtFile(file, contentBeforeUpload);
	}

	// start long write to run concurrent with upload
	const longWrite = await dev2FS().v!.getByteSink(file);
	// make concurrent upload
	const uploadCompletion = dev2FS().v!.sync!.upload(file, { uploadVersion: fileStatusOnDev2.remote!.latest! + 1 });
	await longWrite.sink.truncate(20);
	// complete the write
	await longWrite.sink.done();
	// upload was scheduled after write completion, hence, awaiting after it
	await uploadCompletion;

	fileStatusOnDev2 = await dev2FS().v!.sync!.status(file);
	expect(fileStatusOnDev2.state).toBe('unsynced');
	expect(fileStatusOnDev2.synced!.latest!).toBe(3);
	expect(fileStatusOnDev2.local!.latest!).toBe(longWrite.version);

	await dev1FS().v!.sync!.status(file);
	await dev1FS().v!.sync!.adoptRemote(file);
	expect(await dev1FS().readTxtFile(file)).toBe(contentBeforeUpload);

	await dev2FS().v!.sync!.upload(file);
	fileStatusOnDev2 = await dev2FS().v!.sync!.status(file);
	expect(fileStatusOnDev2.state).toBe('synced');
	expect(fileStatusOnDev2.synced!.latest!).toBe(4);

	await dev1FS().v!.sync!.status(file);
	await dev1FS().v!.sync!.adoptRemote(file);
	expect(await dev2FS().readTxtFile(file))
	.toBe(await dev1FS().readTxtFile(file));
};
specs.its.push(it);


Object.freeze(exports);