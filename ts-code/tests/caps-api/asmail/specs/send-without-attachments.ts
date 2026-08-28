/*
 Copyright (C) 2016 - 2018, 2020, 2026 3NSoft Inc.
 
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

import { SpecDescribe } from '../../../libs-for-tests/spec-module';
import { getMsgsFrom, SpecIt, throwDeliveryErrorFrom } from '../test-utils';
import { sleep } from '../../../../lib-common/processes/sleep';
import { deepEqual } from '../../../libs-for-tests/json-equal';

export const specs: SpecDescribe = {
	description: '.sendMsg',
	its: []
};

type DeliveryProgress = web3n.asmail.DeliveryProgress;
type OutgoingMessage = web3n.asmail.OutgoingMessage;
type IncomingMessage = web3n.asmail.IncomingMessage;

let it: SpecIt = {
	expectation: 'send message to existing address and get it'
};
it.func = async function(s) {
	const u1_w3n = s.testAppCapsByUserIndex(0);
	const u2 = s.users[1];

	const txtBody = 'Some text\nBlah-blah-blah';
	const htmlBody = `Some html. Note that core isn't looking/checking this`;
	const jsonBody = {
		field1: 123,
		field2: 'blah-blah'
	};

	// user 1 sends message to user 2
	const recipient = u2.userId;
	const outMsg: OutgoingMessage = {
		msgType: 'mail',
		plainTxtBody: txtBody,
		htmlTxtBody: htmlBody,
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
		const cbDetach = u1_w3n.mail!.delivery.observeDelivery(idForSending, observer);
		expect(typeof cbDetach).toBe('function');
	});
	expect(notifs.length).toBeGreaterThan(0);
	const lastInfo = notifs[notifs.length-1];
	expect(typeof lastInfo).toBe('object');
	expect(lastInfo.allDone).toBe('all-ok');
	throwDeliveryErrorFrom(lastInfo);
	await u1_w3n.mail!.delivery.rmMsg(idForSending);
	await u1_w3n.mail!.delivery.rmMsg(idForSending);	// noop after first rm
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
	expect(inMsg.htmlTxtBody).toBe(htmlBody);
	expect(deepEqual(inMsg.jsonBody, jsonBody)).toBeTrue();
	await u2_w3n.mail!.inbox.removeMsg(msgId);
	await u2_w3n.mail!.inbox.removeMsg(msgId);	// second call is a noop

};
specs.its.push(it);

it = {
	expectation: 'send lots of messages with sendImmediately flag set true',
	timeout: 20000
};
it.func = async function(s) {
	const u1_w3n = s.testAppCapsByUserIndex(0);
	const u2 = s.users[1];
	const u2_w3n = s.testAppCapsByUserIndex(1);

	const totalNumOfTestMsgs = 30;

	const recipient = u2.userId;
	const msgsFromRecipient = getMsgsFrom(u2_w3n.mail!.inbox!, totalNumOfTestMsgs);
	const receivedMsgs: (IncomingMessage|undefined)[] = new Array(totalNumOfTestMsgs);
	const watchingInboxOfU2 = (async function() {
		for await (const msg of msgsFromRecipient) {
			const i = msg.jsonBody!.testMsgNum;
			receivedMsgs[i] = msg;
		}
	})();

	const idForSendingPrefix = `${Date.now()}`;
	const notifs: DeliveryProgress[][] = [];
	const deliveryProcesses: Promise<void>[] = [];
	for (let i=0; i<totalNumOfTestMsgs; i+=1) {
		const idForSending = `${idForSendingPrefix}-${i}`;
		const msgNotifs: DeliveryProgress[] = [];
		notifs.push(msgNotifs);
		const outMsg: OutgoingMessage = {
			msgType: 'mail',
			jsonBody: {
				testMsgNum: i
			}
		};
		await u1_w3n.mail!.delivery.addMsg([ recipient ], outMsg, idForSending, {
			sendImmediately: true,
			retryRecipient: { numOfAttempts: 2, timeBetweenAttempts: 1000 }
		});
		const msgDeliveryProc = new Promise<void>((resolve, reject) => {
			u1_w3n.mail!.delivery.observeDelivery(idForSending, {
				next: p => msgNotifs.push(p),
				complete: resolve as () => void,
				error: reject
			});
		});
		deliveryProcesses.push(msgDeliveryProc);

	}

	await Promise.allSettled(deliveryProcesses);
	await watchingInboxOfU2;

	for (let i=0; i<totalNumOfTestMsgs; i+=1) {
		const msgDeliveryNotifs = notifs[i];
		expect(msgDeliveryNotifs.length).toBeGreaterThan(0);
		const last = msgDeliveryNotifs[msgDeliveryNotifs.length - 1];
		expect(last.allDone).withContext(`message ${i} should've been sent without errors`).toBe('all-ok');

		const msg = receivedMsgs[i];
		expect(msg!.jsonBody!.testMsgNum).withContext(`message ${i} should've been received`).toBe(i);
	}

};
specs.its.push(it);

Object.freeze(exports);