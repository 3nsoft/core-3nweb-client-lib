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

import { itCond, beforeAllWithTimeoutLog, afterAllCond } from '../../libs-for-tests/jasmine-utils';
import { minimalSetup } from '../../libs-for-tests/setups';
import { checkKeyDerivNotifications } from '../../libs-for-tests/startup';
import { testApp } from '../../libs-for-tests/core-runner';

// NOTE: it-specs inside signUp process expect to run in a given order -- they
//		change app's state, expected by following specs in this describe.
describe('signUp process', () => {

	const s = minimalSetup();
	let w3n: web3n.startup.W3N;
	let coreInit: Promise<string>;
	let closeIPC: () => void;

	beforeAllWithTimeoutLog(async () => {
		if (!s.isUp) { return; }
		({ closeIPC, coreInit, w3n } = s.runner.startCore());
	});

	afterAllCond(async () => {
		closeIPC();
	});

	const name = 'Mike Marlow ';
	const pass = 'some long passphrase';

	itCond('gets available addresses', async () => {
		const addresses = await w3n.signUp.getAvailableAddresses(name);
		expect(Array.isArray(addresses)).toBe(true);
		expect(addresses.length).toBe(s.signupDomains.length);
		for (let d of s.signupDomains) {
			expect(addresses).toContain(`${name}@${d}`);
		}
	});

	itCond('creates user parameters', async () => {
		const notifications: number[] = [];
		const notifier = (p: number) => { notifications.push(p); }
		await w3n.signUp.createUserParams(pass, notifier);
		checkKeyDerivNotifications(notifications);
	}, 60000);

	itCond('creates user account, allowing caps for apps', async () => {
		try {
			s.runner.core.makeCAPsForApp(testApp.appDomain, testApp.capsRequested);
			fail(`Attempt to make app CAPs before core initialization should throw up`);
		} catch (err) {}

		const userId = `${name}@${s.signupDomains[0]}`;
		const isCreated = await w3n.signUp.addUser(userId);
		expect(isCreated).toBe(true);

		const initAs = await coreInit;
		expect(initAs).toBe(userId);

		try {
			const { caps, close } = s.runner.core.makeCAPsForApp(
				testApp.appDomain, testApp.capsRequested);
			expect(typeof caps).toBe('object');
			expect(typeof close).toBe('function');
			close();
		} catch (err) {
			fail(err)
		}
	}, 10000);

});