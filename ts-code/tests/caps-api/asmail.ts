/*
 Copyright (C) 2016, 2018, 2020, 2026 3NSoft Inc.
 
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
import { join } from 'path';
import { assert } from '../../lib-common/assert';
import { checkAndTransformAddress } from '../../lib-common/canonical-address';
import { deepEqual } from '../libs-for-tests/json-equal';


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
			expect(typeof w3n.mail!.getReportAddressForDomain).toBe('function');
			expect(typeof w3n.mail!.filter).toBe('object');
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
			const newDefaultMsgSize = anonSenderPolicy!.defaultMsgSize + 42;
			anonSenderPolicy!.defaultMsgSize = newDefaultMsgSize;
			await config.setOnServer('anon-sender/policy', anonSenderPolicy!);
			anonSenderPolicy = await config.getOnServer('anon-sender/policy');
			expect(anonSenderPolicy!.defaultMsgSize).toBe(newDefaultMsgSize);

			// but public key should be set via keyring cap, and not here
			await config.setOnServer('init-pub-key', null).then(
				() => fail(`public key shouldn't be set directly`),
				err => expect(err).toBeTruthy()
			);
		}, undefined, s);

	});

	describe(`filter`, () => {

		let filter: NonNullable<web3n.caps.common.W3N['mail']>['filter'];

		beforeAll(() => {
			filter = s.testAppCapsByUserIndex(0).mail!.filter;
		});

		itCond(`manages filtering rules, applied to incoming and outgoing messages`, async () => {
			let rules = await filter.listRules();
			expect(Array.isArray(rules)).toBeTrue();

			let oneAddrBlock = await filter.addRule({
				ruleType: 'block-address',
				domain: 'some.do.ma.in',
				username: 'blocked user'
			});
			expect(oneAddrBlock.ruleIndex).toBe(rules.length);
			await filter.addRule({
				ruleType: 'block-domain',
				domain: 'bad.do.ma.in'
			});

			rules = await filter.listRules();
			expect(deepEqual(rules[oneAddrBlock.ruleIndex], oneAddrBlock.rule)).toBeTrue();

			let foundAndRemoved = await filter.removeRule(oneAddrBlock.ruleIndex, oneAddrBlock.rule);
			expect(foundAndRemoved).toBeTrue();
			foundAndRemoved = await filter.removeRule(oneAddrBlock.ruleIndex, oneAddrBlock.rule);
			expect(foundAndRemoved).toBeFalse();
		});

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

	itCond('hosts report address getting', async () => {
		assert(s.users.length > 0);
		for (const u of s.users) {
			const w3n = s.testAppCapsByUser(u);
			const someAddr = await w3n.mail!.getUserId();
			const domain = someAddr.substring(someAddr.indexOf('@'));
			const domainReportAddr = await w3n.mail!.getReportAddressForDomain(domain);
			expect(typeof domainReportAddr).toBe('string');
			expect(checkAndTransformAddress(domainReportAddr)).toBeTruthy();
		}
	}, undefined, s);

	loadSpecs(
		s,
		join(__dirname, 'asmail', 'specs')
	);

});