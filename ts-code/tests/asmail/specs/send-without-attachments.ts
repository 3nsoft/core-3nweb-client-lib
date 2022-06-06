/*
 Copyright (C) 2016 - 2018, 2020 3NSoft Inc.
 
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

import { SpecDescribe } from '../../libs-for-tests/spec-module';
import { SpecIt, throwDeliveryErrorFrom } from '../test-utils';
import { sleep } from '../../../lib-common/processes/sleep';

export const specs: SpecDescribe = {
	description: '.sendMsg',
	its: []
};

type DeliveryProgress = web3n.asmail.DeliveryProgress;
type OutgoingMessage = web3n.asmail.OutgoingMessage;

const it: SpecIt = {
	expectation: 'send message to existing address and get it'
};
it.func = async function(s) {
	const u1_w3n = s.testAppCapsByUserIndex(0);
	const u2 = s.users[1];

	const txtBody = 'Some text\nBlah-blah-blah';
	const jsonBody = {
		field1: 123,
		field2: 'blah-blah'
	};

	// user 1 sends message to user 2
	const recipient = u2.userId;
	const outMsg: OutgoingMessage = {
		msgType: 'mail',
		plainTxtBody: txtBody,
		jsonBody
	};
	const idForSending = 'a4b5';
	await u1_w3n.mail!.delivery.addMsg([ recipient ], outMsg, idForSending);
	expect(await u1_w3n.mail!.delivery.currentState(idForSending)).toBeTruthy();
	const notifs: DeliveryProgress[] = [];
	await new Promise((resolve, reject) => {
		const observer: web3n.Observer<DeliveryProgress> = {
			next: (p: DeliveryProgress) => { notifs.push(p); },
			complete: resolve as () => void, error: reject
		};
		const cbDetach = u1_w3n.mail!.delivery.observeDelivery(
			idForSending, observer);
		expect(typeof cbDetach).toBe('function');
	});
	expect(notifs.length).toBeGreaterThan(0);
	const lastInfo = notifs[notifs.length-1];
	expect(typeof lastInfo).toBe('object');
	expect(lastInfo.allDone).toBe(true);
	throwDeliveryErrorFrom(lastInfo);
	await u1_w3n.mail!.delivery.rmMsg(idForSending);
	expect(await u1_w3n.mail!.delivery.currentState(idForSending)).toBeFalsy();
	const recInfo = lastInfo!.recipients[recipient];
	expect(typeof recInfo.bytesSent).toBe('number');
	expect(typeof recInfo.idOnDelivery).toBe('string');
	const msgId = recInfo.idOnDelivery!;

	expect(msgId).toBeTruthy();

	// user 2 checks messages after some delay
	await sleep(500);
	const u2_w3n = s.testAppCapsByUser(u2);
	const msgs = await u2_w3n.mail!.inbox.listMsgs();
	const msgInfo = msgs.find(m => (m.msgId === msgId))!;
	expect(msgInfo).withContext(`message ${msgId} should be present in a list of all messages`).not.toBeUndefined();
	expect(msgInfo.msgType).toBe('mail');
	const inMsg = await u2_w3n.mail!.inbox.getMsg(msgId);
	expect(inMsg).toBeTruthy();
	expect(inMsg.msgId).toBe(msgId);
	expect(inMsg.msgType).toBe('mail');
	expect(inMsg.plainTxtBody).toBe(txtBody);
	expect(inMsg.jsonBody).toBeTruthy();
	expect((inMsg.jsonBody as typeof jsonBody).field1).toBe(jsonBody.field1);
	expect((inMsg.jsonBody as typeof jsonBody).field2).toBe(jsonBody.field2);

};
specs.its.push(it);

Object.freeze(exports);