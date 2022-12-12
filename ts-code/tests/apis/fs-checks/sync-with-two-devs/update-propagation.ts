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

import { utf8 } from '../../../../lib-common/buffer-utils';
import { stringOfB64CharsSync, bytes as randomBytes } from '../../../../lib-common/random-node';
import { bytesEqual } from '../../../libs-for-tests/bytes-equal';
import { deepEqual } from '../../../libs-for-tests/json-equal';
import { SpecDescribe } from '../../../libs-for-tests/spec-module';
import { observeFileForOneEvent, observeFolderForOneEvent, SpecItWithTwoDevsFSs } from '../test-utils';

type FileException = web3n.files.FileException;
type RemoteChangeEvent = web3n.files.RemoteChangeEvent;

export const specs: SpecDescribe = {
	description: '--',
	its: []
};

let it: SpecItWithTwoDevsFSs = {
	expectation: 'when online, other device observes events'
};
it.func = async function({ dev1FS, dev2FS }) {
	const file = 'file-1';
	let fs1 = dev1FS();
	let fs2 = dev2FS();

	const evAtDev2 = observeFolderForOneEvent<RemoteChangeEvent>(fs2);
	let status = await fs2.v!.sync!.status('');
	expect(status.state).withContext(`from setup`).toBe('synced');

	await fs1.writeTxtFile(file, stringOfB64CharsSync(100));

	await fs1.v!.sync!.upload(file);
	await fs1.v!.sync!.upload('');

	const folderChangeEvent = await evAtDev2;
	expect(folderChangeEvent.type).toBe('remote-change');
	status = await fs2.v!.sync!.status('');
	expect(status.state).toBe('behind');

	await fs2.readTxtFile(file).then(
		() => fail(`There should be no file still in folder on dev 2`),
		(exc: FileException) => expect(exc.notFound).toBeTrue()
	);

	await fs2.v!.sync!.adoptRemote('');

	status = await fs2.v!.sync!.status('');
	const statusOnDev1 = await fs1.v!.sync!.status('');
	expect(status.state).toBe('synced');
	expect(status.synced!.latest).toBe(statusOnDev1.synced!.latest);
	expect(await fs2.readTxtFile(file))
	.toBe(await fs1.readTxtFile(file));
};
specs.its.push(it);

it = {
	expectation: 'other device should check updates when coming online'
};
it.func = async function({ dev1FS, dev2FS, dev2 }) {
	const file = 'file-1';
	let fs1 = dev1FS();
	let fs2 = dev2FS();

	let status = await fs2.v!.sync!.status('');
	expect(status.state).withContext(`from setup`).toBe('synced');
	await dev2.stop();

	await fs1.writeTxtFile(file, stringOfB64CharsSync(100));

	await fs1.v!.sync!.upload(file);
	await fs1.v!.sync!.upload('');

	await dev2.start();
	fs2 = dev2FS();

	status = await fs2.v!.sync!.status('');
	expect(status.state).toBe('synced');

	status = await fs2.v!.sync!.updateStatusInfo('');

	expect(status.state).toBe('behind');

	await fs2.v!.sync!.adoptRemote('');

	status = await fs2.v!.sync!.status('');
	const statusOnDev1 = await fs1.v!.sync!.status('');
	expect(status.state).toBe('synced');
	expect(status.synced!.latest).toBe(statusOnDev1.synced!.latest);
	expect(await fs2.readTxtFile(file))
	.toBe(await fs1.readTxtFile(file));
};
specs.its.push(it);

it = {
	expectation: 'remote version is downloaded non-automatically'
};
it.func = async function({ dev1FS, dev2FS }) {
	const file = 'file-1';
	let fs1 = dev1FS();
	let fs2 = dev2FS();

	// case 1: remote version of folder

	const folderEventAt2 = observeFolderForOneEvent<RemoteChangeEvent>(fs2);

	await fs1.writeTxtFile(file, stringOfB64CharsSync(100));
	await fs1.v!.sync!.upload(file);
	await fs1.v!.sync!.upload('');

	const folderEv = await folderEventAt2;
	expect(folderEv.type).toBe('remote-change');
	expect((await fs2.v!.sync!.status('')).remote?.latest)
	.toBe(folderEv.newVersion);

	expect(
		await fs2.v!.sync!.isRemoteVersionOnDisk('', folderEv.newVersion)
	).toBe('none');

	await fs2.v!.sync!.download('', folderEv.newVersion);

	expect(
		await fs2.v!.sync!.isRemoteVersionOnDisk('', folderEv.newVersion)
	).toBe('complete');

	// case 2: remote version of file

	expect(await fs2.checkFilePresence(file)).toBeFalse();
	await fs2.v!.sync!.adoptRemote('');
	expect(await fs2.readTxtFile(file)).toBe(await fs1.readTxtFile(file));

	let fileEventAt2 = observeFileForOneEvent<RemoteChangeEvent>(fs2, file);
	await fs1.writeBytes(file, await randomBytes(880000));
	await fs1.v!.sync!.upload(file);

	let fileEv = await fileEventAt2;
	expect(fileEv.type).toBe('remote-change');
	expect((await fs2.v!.sync!.status(file)).remote?.latest)
	.toBe(fileEv.newVersion);

	expect(
		await fs2.v!.sync!.isRemoteVersionOnDisk(file, fileEv.newVersion)
	).toBe('none');

	await fs2.v!.sync!.download(file, fileEv.newVersion);

	expect(
		await fs2.v!.sync!.isRemoteVersionOnDisk(file, fileEv.newVersion)
	).toBe('complete');
	expect(bytesEqual(
		(await fs2.v!.readBytes(
			file, undefined, undefined, { remoteVersion: fileEv.newVersion }
		)).bytes!,
		(await fs1.readBytes(file))!
	)).toBeTrue();

	// case 3: reading remote version of file without adopting it

	fileEventAt2 = observeFileForOneEvent<RemoteChangeEvent>(fs2, file);
	await fs1.writeBytes(file, await randomBytes(770000));
	await fs1.v!.sync!.upload(file);
	fileEv = await fileEventAt2;

	expect(
		await fs2.v!.sync!.isRemoteVersionOnDisk(file, fileEv.newVersion)
	).toBe('none');

	expect(bytesEqual(
		(await fs2.v!.readBytes(
			file, undefined, undefined, { remoteVersion: fileEv.newVersion }
		)).bytes!,
		(await fs1.readBytes(file))!
	)).toBeTrue();

	expect(
		await fs2.v!.sync!.isRemoteVersionOnDisk(file, fileEv.newVersion)
	).toBe('complete');

};
specs.its.push(it);

it = {
	expectation: 'file incrementally written and uploaded, then read on a second device'
};
it.func = async function({ dev1FS, dev2FS }) {
	const file = 'incremental-file';
	let fs1 = dev1FS();
	let fs2 = dev2FS();

	const COMMA_BYTE = utf8.pack(',');
	const SQ_BRACKET_BYTE = utf8.pack(']');
	const completeContent = [
		{
			type:"addition",
			record: {
				msgId:"F-vo1A4zInEBGq994-e3KvrE9a8QXLcr",
				msgType:"mail",
				deliveryTS:1664923830399,
				key:"0Uz7wGW4P7hdik7fuStC+avi7iXk7AZ5B1KxJCxIOQk=",keyStatus:"published_intro",
				mainObjHeaderOfs:72,
				"removeAfter":0
			}
		},
		{
			type:"addition",
			record: {
				msgId:"JYXfEEcg3-iX7UDjG3BU0Jha9DYX_Jt-",
				msgType:"mail",
				deliveryTS:1664923830658,
				key:"gjArW3Mr3ACnoFds/wKFZJm+pp9De1TlNhWIkpyd4Ow=",
				keyStatus:"published_intro",
				mainObjHeaderOfs:72,
				removeAfter:0
			}
		}
	];

	// we do this file writing and uploading, cause this pattern hit an error,
	// hence, we add this test with this seemingly out of the blue setup

	await fs1.writeTxtFile(file, `[]`);
	await fs1.v!.sync!.upload(file);
	await fs1.v!.sync!.upload('');

	let sink = await fs1.getByteSink(file, { truncate: false });
	await sink.splice(1, 1);
	let bytes = utf8.pack(JSON.stringify(completeContent[0]));
	await sink.splice(1, 0, bytes);
	await sink.splice(1+bytes.length, 0, SQ_BRACKET_BYTE);
	await sink.done();
	await fs1.v!.sync!.upload(file);

	sink = await fs1.getByteSink(file, { truncate: false });
	const len = await sink.getSize();
	await sink.splice(len-1, 1, COMMA_BYTE);
	bytes = utf8.pack(JSON.stringify(completeContent[1]));
	await sink.splice(len, 0, bytes);
	await sink.splice(len+bytes.length, 0, SQ_BRACKET_BYTE);
	await sink.done();

	expect(deepEqual(completeContent, await fs1.readJSONFile(file))).toBeTrue();

	await fs1.v!.sync!.upload(file);

	// and on the second device

	await fs2.v!.sync!.updateStatusInfo('');
	expect((await fs2.v!.sync!.status('')).state).toBe('behind');
	await fs2.v!.sync!.adoptRemote('');

	expect((await fs2.v!.sync!.status(file)).state).toBe('synced');
	expect(deepEqual(completeContent, await fs2.readJSONFile(file))).toBeTrue();

};
specs.its.push(it);


Object.freeze(exports);