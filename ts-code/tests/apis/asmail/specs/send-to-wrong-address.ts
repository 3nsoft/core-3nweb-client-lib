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

import { SpecDescribe } from '../../../libs-for-tests/spec-module';
import { SpecIt } from '../test-utils';

export const specs: SpecDescribe = {
	description: '.sendMsg',
	its: []
};

type DeliveryProgress = web3n.asmail.DeliveryProgress;
type OutgoingMessage = web3n.asmail.OutgoingMessage;
type ASMailSendException = web3n.asmail.ASMailSendException;

const it: SpecIt = {
	expectation: 'send message to unknown user'
};
it.func = async function(s) {
	const u = s.users[0];
	const w3n = s.testAppCapsByUser(u);
	const txtBody = 'Some text\nBlah-blah-blah';
	const recipient = `Unknown ${u.userId}`;

	// user 1 sends message to user 2
	const msg: OutgoingMessage = {
		msgType: 'mail',
		plainTxtBody: txtBody
	};

	// start sending
	const idForSending = 'q2w3e';
	await w3n.mail!.delivery.addMsg([ recipient ], msg, idForSending);
	expect(await w3n.mail!.delivery.currentState(idForSending)).toBeTruthy();

	// register delivery progress callback
	const notifs: DeliveryProgress[] = [];

	// observe, while waiting for delivery completion
	await new Promise((resolve, reject) => {
		const observer: web3n.Observer<DeliveryProgress> = {
			next: (p: DeliveryProgress) => { notifs.push(p); },
			complete: resolve as () => void, error: reject
		};
		const cbDetach = w3n.mail!.delivery.observeDelivery(
			idForSending, observer);
		expect(typeof cbDetach).toBe('function');
	});

	// notifications should have something
	expect(notifs.length).toBeGreaterThan(0);
	const lastInfo = notifs[notifs.length-1];
	expect(lastInfo).toBeTruthy('There has to be at least one event fired');

	// it has to be an error
	expect(typeof lastInfo!.recipients[recipient].err).toBe('object');
	const exc = lastInfo!.recipients[recipient].err! as ASMailSendException;
	expect(exc.unknownRecipient).toBe(true);
	expect(typeof lastInfo!.recipients[recipient].idOnDelivery).toBe('undefined');

	await w3n.mail!.delivery.rmMsg(idForSending);
	expect(await w3n.mail!.delivery.currentState(idForSending)).toBeFalsy();

};
specs.its.push(it);

Object.freeze(exports);