/*
 Copyright (C) 2025 3NSoft Inc.
 
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

import { itCond } from '../libs-for-tests/jasmine-utils';
import { setupWithUsers } from '../libs-for-tests/setups';
import { assert } from '../../lib-common/assert';
import { getPrincipalAddress, getPubKey } from '../../lib-common/jwkeys';
import { areAddressesEqual } from '../../lib-common/canonical-address';
import { deepEqual } from '../../lib-common/json-utils';


describe('keyrings', () => {

	const userAddr = 'Bob Perkins @company.inc';
	const s = setupWithUsers(true, [ userAddr ]);
	let keyrings: web3n.keys.Keyrings;
	let asmailConfig: web3n.asmail.ASMailConfigService;

	beforeAll(() => {
		assert(s.users.length >= 1, `at least one user should be set up`);
		const w3n = s.testAppCapsByUserIndex(0);
		keyrings = w3n.keyrings!;
		asmailConfig = w3n.mail!.config;
	});

	itCond(`can view and update intro key on server`, async () => {
		// intro key CAP in this test
		const pkeyCAP = keyrings.introKeyOnASMailServer;

		// see key that should be currently on server
		const fstCert = await pkeyCAP.getCurrent();
		expect(fstCert).toBeTruthy();
		expect(areAddressesEqual(
			userAddr, getPrincipalAddress(fstCert!.pkeyCert))
		).toBeTrue();
		expect(deepEqual(
			fstCert, await asmailConfig.getOnServer('init-pub-key')
		)).toBeTrue();
		const fstKid = getPubKey(fstCert!.pkeyCert);

		// removing intro key from ASMail server
		await pkeyCAP.remove();
		expect(await pkeyCAP.getCurrent()).toBeNull();
		expect(await asmailConfig.getOnServer('init-pub-key')).toBeNull();
		// second removal is a noop
		await pkeyCAP.remove();
		expect(await pkeyCAP.getCurrent()).toBeNull();
		expect(await asmailConfig.getOnServer('init-pub-key')).toBeNull();

		// update makes and publishes new keys
		const sndKey = await pkeyCAP.makeAndPublishNew();
		expect(sndKey).toBeTruthy();
		const sndKid = getPubKey(sndKey.pkeyCert);
		expect(sndKid).not.toBe(fstKid);
		expect(deepEqual(
			sndKey, await asmailConfig.getOnServer('init-pub-key')
		)).toBeTrue();
		const thirdKey = await pkeyCAP.makeAndPublishNew();
		expect(thirdKey).toBeTruthy();
		const thirdKid = getPubKey(thirdKey.pkeyCert);
		expect(thirdKid).not.toBe(fstKid);
		expect(thirdKid).not.toBe(sndKid);
		expect(deepEqual(
			thirdKey, await asmailConfig.getOnServer('init-pub-key')
		)).toBeTrue();

	}, undefined, s);

});