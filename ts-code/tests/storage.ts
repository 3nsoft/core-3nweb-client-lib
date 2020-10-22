/*
 Copyright (C) 2016, 2018, 2020 3NSoft Inc.
 
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

import { itAsync, afterEachAsync, beforeAllAsync, afterAllAsync } from './libs-for-tests/async-jasmine';
import { setupWithUsers } from './libs-for-tests/setups';
import { loadSpecs } from './libs-for-tests/spec-module';
import { resolve } from 'path';
import { platform } from 'os';
import { reverseDomain } from '../core';
import { testApp } from './libs-for-tests/core-runner';
import { clearFS, SetupWithTestFS, SetupWithTwoFSs } from './fs-checks/test-utils';
import { StorageException } from '../core/storage';

type AppFSSetting = web3n.caps.common.AppFSSetting;
type commonW3N = web3n.caps.common.W3N;

const allowedAppFS = (testApp.capsRequested.storage!.appFS as AppFSSetting[])
.map(s => reverseDomain(s.domain));

describe('3NStorage', () => {

	const s = setupWithUsers(true);
	let w3n: commonW3N;

	beforeAllAsync(async () => {
		if (!s.isUp) { return; }
		w3n = s.testAppCapsByUserIndex(0);
	});

	itAsync('storage capability is present in test app', async () => {
		expect(typeof w3n.storage).toBe('object');
	}, undefined, s);

	describe('.getAppSyncedFS', () => {

		itAsync('will not produce FS for domain (reversed), not associated with app',
				async () => {
			await w3n.storage!.getAppSyncedFS('com.app.unknown')
			.then(() => {
				fail('should not produce FS for an arbitrary app');
			}, (e: StorageException) => {
				expect(e.runtimeException).toBe(true);
				expect(e.type).toBe('storage');
				expect(e.notAllowedToOpenFS).toBeTruthy();
			});
		}, undefined, s);

		itAsync('produces FS for domains (reversed), associated with app',
				async () => {
			for (const appDomain of allowedAppFS) {
				const fs = await w3n.storage!.getAppSyncedFS(appDomain);
				expect(fs).toBeTruthy();
			}
		}, undefined, s);

		itAsync('concurrently produces FS for an app', async () => {
			const appDomain = allowedAppFS[0];
			const promises: Promise<web3n.files.FS>[] = [];
			for (let i=0; i<10; i+=1) {
				const promise = w3n.storage!.getAppSyncedFS(appDomain);
				promises.push(promise);
			}
			await Promise.all(promises)
			.then((fss) => {
				for (const fs of fss) {
					expect(fs).toBeTruthy();
				}
			}, () => {
				fail(`Fail to concurrently get app fs`);
			});
		}, undefined, s);

	});

	describe('.getAppLocalFS', () => {

		itAsync('will not produce FS for domain, not associated with app',
				async () => {
			await w3n.storage!.getAppLocalFS('com.app.unknown')
			.then(() => {
				fail('should not produce FS for an arbitrary app');
			}, (e: StorageException) => {
				expect(e.runtimeException).toBe(true);
				expect(e.type).toBe('storage');
				expect(e.notAllowedToOpenFS).toBeTruthy();
			});
		}, undefined, s);

		itAsync('produces FS for domains (reversed), associated with app',
				async () => {
			for (const appDomain of allowedAppFS) {
				const fs = await w3n.storage!.getAppLocalFS(appDomain);
				expect(fs).toBeTruthy();
			}
		}, undefined, s);

		itAsync('concurrently produces FS for an app', async () => {
			const appDomain = allowedAppFS[0];
			const promises: Promise<web3n.files.FS>[] = [];
			for (let i=0; i<10; i+=1) {
				const promise = w3n.storage!.getAppLocalFS(appDomain);
				promises.push(promise);
			}
			await Promise.all(promises)
			.then((fss) => {
				for (const fs of fss) {
					expect(fs).toBeTruthy();
				}
			}, () => {
				fail(`Fail to concurrently get app fs`);
			});
		}, undefined, s);

	});

	describe('local FS is a web3n.files.WritableFS', () => {

		const fsSetup = {} as SetupWithTestFS;

		beforeAllAsync(async () => {
			if (!s.isUp) { return; }
			fsSetup.isUp = true;
			fsSetup.testFS = await w3n.storage!.getAppLocalFS(allowedAppFS[0]);
		});

		afterEachAsync(async () => {
			if (!s.isUp) { return; }
			await clearFS(fsSetup.testFS);
		});

		loadSpecs(
			fsSetup,
			resolve(__dirname, 'fs-checks/not-versioned'),
			((platform() === 'win32') ? [ 'win-local-fs' ] : undefined));

		loadSpecs(
			fsSetup,
			resolve(__dirname, 'file-sink-checks'));

	});

	describe('local FS is a web3n.files.WritableFS with versioned API', () => {

		const fsSetup = {} as SetupWithTestFS;

		beforeAllAsync(async () => {
			if (!s.isUp) { return; }
			fsSetup.isUp = true;
			fsSetup.testFS = await w3n.storage!.getAppLocalFS(allowedAppFS[0]);
		});

		afterEachAsync(async () => {
			if (!s.isUp) { return; }
			await clearFS(fsSetup.testFS);
		});

		loadSpecs(
			fsSetup,
			resolve(__dirname, 'fs-checks/versioned'));

	});

	describe('synced FS is a web3n.files.WritableFS', () => {

		const fsSetup = {} as SetupWithTestFS;

		beforeAllAsync(async () => {
			if (!s.isUp) { return; }
			fsSetup.isUp = true;
			fsSetup.testFS = await w3n.storage!.getAppSyncedFS(allowedAppFS[0]);
		});

		afterEachAsync(async () => {
			if (!s.isUp) { return; }
			await clearFS(fsSetup.testFS);
		});

		loadSpecs(
			fsSetup,
			resolve(__dirname, 'fs-checks/not-versioned'));

		loadSpecs(
			fsSetup,
			resolve(__dirname, 'file-sink-checks'));

	});

	describe('synced FS is a web3n.files.WritableFS with versioned API', () => {

		const fsSetup = {} as SetupWithTestFS;

		beforeAllAsync(async () => {
			if (!s.isUp) { return; }
			fsSetup.isUp = true;
			fsSetup.testFS = await w3n.storage!.getAppSyncedFS(allowedAppFS[0]);
		});

		afterEachAsync(async () => {
			if (!s.isUp) { return; }
			await clearFS(fsSetup.testFS);
		});

		loadSpecs(
			fsSetup,
			resolve(__dirname, 'fs-checks/versioned'));

	});

	describe('local to synced FS linking', () => {

		const fsSetup = {} as SetupWithTwoFSs;

		beforeAllAsync(async () => {
			if (!s.isUp) { return; }
			fsSetup.isUp = true;
			const domain = allowedAppFS[0];
			fsSetup.localTestFS = await w3n.storage!.getAppLocalFS(domain);
			fsSetup.syncedTestFS = await w3n.storage!.getAppSyncedFS(domain);
		});

		afterEachAsync(async () => {
			if (!s.isUp) { return; }
			await clearFS(fsSetup.localTestFS);
			await clearFS(fsSetup.syncedTestFS);
		});

		loadSpecs(
			fsSetup,
			resolve(__dirname, 'fs-checks/local-to-synced-linking'));

	});

});
