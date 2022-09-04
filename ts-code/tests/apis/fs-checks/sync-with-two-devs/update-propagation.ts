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

import { Observable } from 'rxjs';
import { take } from 'rxjs/operators';
import { stringOfB64CharsSync } from '../../../../lib-common/random-node';
import { SpecDescribe } from '../../../libs-for-tests/spec-module';
import { SpecItWithTwoDevsFSs } from '../test-utils';

type FileException = web3n.files.FileException;
type RemoteChangeEvent = web3n.files.RemoteChangeEvent;
type Observer<T> = web3n.Observer<T>;

export const specs: SpecDescribe = {
	description: '--',
	its: []
};

let it: SpecItWithTwoDevsFSs = {
	expectation: 'when online, other device observes events'
};
it.func = async function({ dev1FS, dev2FS }) {
	const file = 'file-1';

	const evAtDev2 = (new Observable((
		obs: Observer<RemoteChangeEvent>
	) => dev2FS().watchFolder('', obs)))
	.pipe(
		take(1)
	)
	.toPromise();
	let status = await dev2FS().v!.sync!.status('');
	expect(status.state).withContext(`from setup`).toBe('synced');

	await dev1FS().writeTxtFile(file, stringOfB64CharsSync(100));

	await dev1FS().v!.sync!.upload(file);
	await dev1FS().v!.sync!.upload('');

	const folderChangeEvent = await evAtDev2;
	expect(folderChangeEvent.type).toBe('remote-change');
	status = await dev2FS().v!.sync!.status('');
	expect(status.state).toBe('behind');

	await dev2FS().readTxtFile(file).then(
		() => fail(`There should be no file still in folder on dev 2`),
		(exc: FileException) => expect(exc.notFound).toBeTrue()
	);

	await dev2FS().v!.sync!.adoptRemote('');

	status = await dev2FS().v!.sync!.status('');
	const statusOnDev1 = await dev1FS().v!.sync!.status('');
	expect(status.state).toBe('synced');
	expect(status.synced!.latest).toBe(statusOnDev1.synced!.latest);
	expect(await dev2FS().readTxtFile(file))
	.toBe(await dev1FS().readTxtFile(file));
};
specs.its.push(it);

it = {
	expectation: 'other device should check updates when coming online'
};
it.func = async function({ dev1FS, dev2FS, dev2 }) {
	const file = 'file-1';

	let status = await dev2FS().v!.sync!.status('');
	expect(status.state).withContext(`from setup`).toBe('synced');
	await dev2.stop();

	await dev1FS().writeTxtFile(file, stringOfB64CharsSync(100));

	await dev1FS().v!.sync!.upload(file);
	await dev1FS().v!.sync!.upload('');

	await dev2.start();

	status = await dev2FS().v!.sync!.status('');
	expect(status.state).toBe('synced');

	status = await dev2FS().v!.sync!.updateStatusInfo('');

	expect(status.state).toBe('behind');

	await dev2FS().v!.sync!.adoptRemote('');

	status = await dev2FS().v!.sync!.status('');
	const statusOnDev1 = await dev1FS().v!.sync!.status('');
	expect(status.state).toBe('synced');
	expect(status.synced!.latest).toBe(statusOnDev1.synced!.latest);
	expect(await dev2FS().readTxtFile(file))
	.toBe(await dev1FS().readTxtFile(file));
};
specs.its.push(it);


Object.freeze(exports);