/*
 Copyright 2022, 2025 3NSoft Inc.
 
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

import { IdKeysStorage, LoginKeysJSON } from "../../core/id-manager/key-storage";
import { stringOfB64Chars } from "../../lib-common/random-node";
import { afterEachCond, beforeAllWithTimeoutLog, itCond } from "../libs-for-tests/jasmine-utils";
import { deepEqual } from "../libs-for-tests/json-equal";
import { setupWithUsers } from "../libs-for-tests/setups";
import { makeSetupWithTwoDevsFSs } from "./test-utils";

async function failOnErrLog(err: any): Promise<void> {
	fail(err);
}

async function failOnWarning(msg: string): Promise<void> {
	fail(msg);
}

describe('Key storage of IdManager', () => {

	const baseSetup = setupWithUsers();

	const testFolder = `id-manager-test`;

	const {
		fsSetup: setup, setupDevsAndFSs
	} = makeSetupWithTwoDevsFSs(testFolder);

	beforeAllWithTimeoutLog(async () => {
		await setupDevsAndFSs(baseSetup);
	}, 20000);

	afterEachCond(async () => {
		if (!setup.isUp) { return; }
		await setup.resetFS();
	});

	itCond(`initializes with and without storage`, async () => {
		const { dev2, dev1FS, dev2FS } = setup;
		await dev2.stop();
		const loginKeys: LoginKeysJSON = {
			address: await stringOfB64Chars(50),
			keys: [ {
				alg: await stringOfB64Chars(5),
				k: await stringOfB64Chars(48),
				kid: await stringOfB64Chars(15),
				use: await stringOfB64Chars(6)
			} ]
		};

		const {
			store: storeOnDev1, setupManagerStorage
		} = IdKeysStorage.makeWithoutStorage(failOnErrLog, failOnWarning);

		await storeOnDev1.getSavedKey().then(
			() => fail(`Non-initialized storage should fail`), () => {}
		);

		const fsOnDev1 = dev1FS();

		expect((await fsOnDev1.listFolder('')).length)
		.withContext(`there are no files before setup`).toBe(0);
		await setupManagerStorage(fsOnDev1, loginKeys);
		expect((await fsOnDev1.listFolder('')).length)
		.withContext(`setup write some file`).toBeGreaterThan(0);

		expect(deepEqual(await storeOnDev1.getSavedKey(), loginKeys.keys[0]))
		.withContext(`keys should be available after setup`).toBeTrue();

		await dev2.start();
		const fsOnDev2 = dev2FS();

		expect((await fsOnDev2.listFolder('')).length)
		.withContext(`dev2 should've missed all changes on dev1`).toBe(0);
		expect((await fsOnDev2.v!.sync!.status('')).state)
		.withContext(`dev2 should've missed all changes on dev1`).toBe('behind');

		const storeOnDev2 = IdKeysStorage.makeWithStorage(
			fsOnDev2, failOnErrLog, failOnWarning
		);

		expect(deepEqual(await storeOnDev2.getSavedKey(), loginKeys.keys[0]))
		.withContext(`on dev2 have key that was saved on dev1`).toBeTrue();
		expect((await fsOnDev2.listFolder('')).length)
		.withContext(`getting saved key updated state of fs`).toBeGreaterThan(0);
	}, undefined, setup);

});