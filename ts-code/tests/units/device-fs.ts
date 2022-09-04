/*
 Copyright (C) 2016 - 2017, 2020 - 2021 3NSoft Inc.
 
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

import { itCond, beforeAllWithTimeoutLog, afterAllCond, afterEachCond } from '../libs-for-tests/jasmine-utils';
import { DeviceFS } from '../../lib-client/local-files/device-fs';
import { rmDirWithContent, mkdir, rmdir } from '../../lib-common/async-fs-node';
import { resolve } from 'path';
import { loadSpecs } from '../libs-for-tests/spec-module';
import { SetupWithTestFS, clearFS } from '../apis/fs-checks/test-utils';
import { platform } from 'os';

type FileException = web3n.files.FileException;

const TEST_DATA = resolve(__dirname, '../../../test-data');

describe('DeviceFS', () => {

	const rootPath = resolve(TEST_DATA, 'root');

	beforeAllWithTimeoutLog(async () => {
		await rmDirWithContent(TEST_DATA).catch((e: FileException) => {
			if (!e.notFound) { throw e; }
		});
		await mkdir(TEST_DATA);
		await mkdir(rootPath);
	});

	afterAllCond(async () => {
		await rmDirWithContent(TEST_DATA);
	});

	itCond('is created with static make function', async () => {

		// creating on non-existing folder should fail
		try {
			await DeviceFS.makeWritable(resolve(TEST_DATA, 'not-existing-folder'));
			fail('device fs should not be created in non-existing folder');
		} catch (e) {
			expect((e as FileException).notFound).toBeTruthy();
		}

		let rootPath = resolve(TEST_DATA, 'root-for-creation');
		await mkdir(rootPath);

		let devFS = await DeviceFS.makeWritable(rootPath);
		expect(devFS).toBeTruthy();

		rmdir(rootPath);

	});

	describe('is web3n.files.WritableFS', () => {

		const s = {} as SetupWithTestFS;

		beforeAllWithTimeoutLog(async () => {
			s.isUp = true;
			s.testFS = await DeviceFS.makeWritable(rootPath);
		});

		afterEachCond(async () => {
			await clearFS(s.testFS);
		});

		loadSpecs(
			s,
			resolve(__dirname, '../apis/fs-checks/not-versioned'),
			((platform() === 'win32') ?
				[ 'win-local-fs', 'device-fs' ] :
				[ 'device-fs' ]));

		loadSpecs(
			s,
			resolve(__dirname, '../apis/file-sink-checks'),
			[ 'device-fs' ]);

	});

});