/*
 Copyright (C) 2020, 2025 3NSoft Inc.
 
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
import { setupWithUsers, serviceWithMailerIdLogin } from '../libs-for-tests/setups';
import { assert } from '../../lib-common/assert';
import { User } from '../libs-for-tests/core-runner';
import { base64, utf8 } from '../../lib-common/buffer-utils';

type CommonW3N = web3n.caps.common.W3N;


describe('MailerId', () => {

	const s = setupWithUsers(true, [ 'Bob Perkins @company.inc' ]);
	const srv = serviceWithMailerIdLogin();
	let user: User;
	let w3n: CommonW3N;

	beforeAll(() => {
		assert(s.users.length >= 1, `at least one user should be set up`);
		user = s.users[0];
		w3n = s.testAppCapsByUser(user);
	});

	itCond('gets current user id', async () => {
		const userId = await w3n.mailerid!.getUserId();
		expect(userId).toBe(user.userId);
	}, undefined, s);

	itCond('performs MailerId login', async () => {
		const sessionId = await w3n.mailerid!.login(srv.serviceUrl);
		expect(await srv.isSessionValid(sessionId)).toBe(true);
	}, undefined, s);

	itCond('signs and checks MailerId signatures', async () => {
		const payloadAsObj = {
			some: '1234324',
			fields: 123
		};
		const payloadBytes = utf8.pack(JSON.stringify(payloadAsObj));
		const sig = await w3n.mailerid!.sign(payloadBytes);
		expect(sig.signature.load).toBe(base64.pack(payloadBytes));

		// check good signature
		const check1 = await w3n.mailerid!.verifySignature(sig);
		expect(check1.cryptoCheck).toBeTrue();
		expect(check1.midProviderCheck).toBe('all-ok');

		// and messed up signature
		sig.signature.load = sig.signature.load.substring(4);
		const check2 = await w3n.mailerid!.verifySignature(sig);
		expect(check2.cryptoCheck).toBeFalse();
		expect(check2.midProviderCheck).toBeUndefined();
	});

});