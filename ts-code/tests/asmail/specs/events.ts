/*
 Copyright (C) 2017 - 2018, 2020 3NSoft Inc.
 
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
import { sendTxtMsg, SpecIt } from '../test-utils';

export const specs: SpecDescribe = {
	description: '.subscribe',
	its: []
};

type IncomingMessage = web3n.asmail.IncomingMessage;

const it: SpecIt = {
	expectation: `delivers new messages to listeners of event 'message'`
};
it.func = async function(s) {
	const u1_w3n = s.testAppCapsByUserIndex(0);
	const u2 = s.users[1];
	const u2_w3n = s.testAppCapsByUser(u2);

	// user 2 starts listening for events, collecting 'em into an array
	const incomingMsgs: IncomingMessage[] = [];
	const receptionPromise = new Promise((resolve, reject) => {
		u2_w3n.mail!.inbox.subscribe('message', {
			next: (msg) => {
				incomingMsgs.push(msg);
				// promise will resolve when at least two messages come
				if (incomingMsgs.length >= 2) { resolve(incomingMsgs); }
			},
			error: reject
		});
	});

	const txtBody1 = 'Some text\nBlah-blah-blah';
	const txtBody2 = 'Another text message';

	// user 1 sends messages to user 2
	const msgId1 = await sendTxtMsg(u1_w3n, u2.userId, txtBody1);
	expect(msgId1).toBeTruthy();
	const msgId2 = await sendTxtMsg(u1_w3n, u2.userId, txtBody2);
	expect(msgId2).toBeTruthy();
	
	// user 2 gets incoming message
	await receptionPromise;
	[[ msgId1, txtBody1 ], [ msgId2, txtBody2 ]]
	.forEach(([ msgId, txtBody ]) => {
		const msg = incomingMsgs.find(m => (m.msgId === msgId));
		expect(msg).toBeTruthy(`message ${msgId} should be present in a list of all messages`);
		expect(msg!.plainTxtBody).toBe(txtBody);
	});
	
};
specs.its.push(it);

Object.freeze(exports);