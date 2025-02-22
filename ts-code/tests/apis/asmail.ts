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

import { itCond } from '../libs-for-tests/jasmine-utils';
import { setupWithUsers } from '../libs-for-tests/setups';
import { loadSpecs } from '../libs-for-tests/spec-module';
import { resolve } from 'path';
import { assert } from '../../lib-common/assert';


describe('ASMail', () => {

	const s = setupWithUsers(
		true, [ 'Bob Perkins @company.inc', 'John Morrison @bank.com' ]
	);

	beforeAll(() => {
		assert(s.users.length >= 2, `at least two users should be set up`);
	});

	itCond('mail is present in common CAPs', async () => {
		assert(s.users.length > 0);
		for (const u of s.users) {
			const w3n = s.testAppCapsByUser(u);
			expect(typeof w3n.mail).toBe('object');
			expect(typeof w3n.mail!.delivery).toBe('object');
			expect(typeof w3n.mail!.inbox).toBe('object');
			expect(typeof w3n.mail!.config).toBe('object');
			expect(typeof w3n.mail!.getUserId).toBe('function');
		}
	}, undefined, s);

	itCond('gets current user id', async () => {
		assert(s.users.length > 0);
		for (const u of s.users) {
			const w3n = s.testAppCapsByUser(u);
			const userId = await w3n.mail!.getUserId();
			expect(userId).toBe(u.userId);
		}
	}, undefined, s);

	describe(`config`, () => {

		let config: NonNullable<web3n.caps.common.W3N['mail']>['config'];

		beforeAll(() => {
			config = s.testAppCapsByUserIndex(0).mail!.config;
		});

		itCond(`shows parameter' values on the server`, async () => {
			const initPubKey = await config.getOnServer('init-pub-key');
			expect(typeof initPubKey).toBe('object');

			const anonSenderPolicy = await config.getOnServer('anon-sender/policy');
			expect(anonSenderPolicy).toBeTruthy();
			expect(typeof anonSenderPolicy!.accept).toBe('boolean');
			expect(typeof anonSenderPolicy!.defaultMsgSize).toBe('number');

			const anonSenderInvites = await config.getOnServer('anon-sender/invites');
			expect(anonSenderInvites).toBeTruthy();
			expect(typeof anonSenderInvites).toBe('object');
		}, undefined, s);

		itCond(`sets parameter' values on the server`, async () => {
			// some paramaters can be set directly
			let anonSenderPolicy = await config.getOnServer('anon-sender/policy');
			const initDefaultMsgSize = anonSenderPolicy!.defaultMsgSize;
			anonSenderPolicy!.defaultMsgSize = initDefaultMsgSize + 2*1024*1024;
			await config.setOnServer('anon-sender/policy', anonSenderPolicy!);
			anonSenderPolicy = await config.getOnServer('anon-sender/policy');
			expect(anonSenderPolicy!.defaultMsgSize).toBe(initDefaultMsgSize + 2*1024*1024);

			// but public key should be set via keyring cap, and not here
			await config.setOnServer('init-pub-key', null).then(
				() => fail(`public key shouldn't be set directly`),
				err => expect(err).toBeTruthy()
			);
		}, undefined, s);

	});

	itCond('inbox lists incoming messages (no messages)', async () => {
		assert(s.users.length > 0);
		for (const u of s.users) {
			const w3n = s.testAppCapsByUser(u);
			const msgs = await w3n.mail!.inbox.listMsgs();
			expect(Array.isArray(msgs)).toBe(true);
			expect(msgs.length).toBe(0);
		}
	}, undefined, s);

	loadSpecs(
		s,
		resolve(__dirname, './asmail/specs')
	);

});