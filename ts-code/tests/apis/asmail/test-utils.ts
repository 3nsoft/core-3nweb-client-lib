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

import { SpecIt as GenericSpecIt } from "../../libs-for-tests/spec-module";
import { MultiUserSetup } from "../../libs-for-tests/setups";
import { assert } from "../../../lib-common/assert";
import { errWithCause, stringifyErr } from "../../../lib-common/exceptions/error";

type DeliveryProgress = web3n.asmail.DeliveryProgress;
type OutgoingMessage = web3n.asmail.OutgoingMessage;
type commonW3N = web3n.caps.common.W3N;

/**
 * This function to be run in renderer's context via execExpects
 * @param recipient 
 * @param txtBody 
 */
export async function sendTxtMsg(
	w3n: commonW3N, recipient: string, txtBody: string
): Promise<string> {
	const msg: OutgoingMessage = {
		msgType: 'mail',
		plainTxtBody: txtBody
	};
	const idForSending = 'd5b6';
	await w3n.mail!.delivery.addMsg([ recipient ], msg, idForSending);
	expect(await w3n.mail!.delivery.currentState(idForSending)).toBeTruthy();
	const lastInfo = await new Promise<DeliveryProgress>((resolve, reject) => {
		let lastInfo: DeliveryProgress;
		w3n.mail!.delivery.observeDelivery(idForSending, {
			next: info => (lastInfo = info),
			complete: () => resolve(lastInfo),
			error: reject
		});
	});
	expect(typeof lastInfo).toBe('object');
	expect(lastInfo!.allDone).toBe(true);
	throwDeliveryErrorFrom(lastInfo);
	await w3n.mail!.delivery.rmMsg(idForSending);
	expect(await w3n.mail!.delivery.currentState(idForSending)).toBeFalsy();
	const recInfo = lastInfo!.recipients[recipient];
	expect(typeof recInfo.idOnDelivery).toBe('string');
	return recInfo.idOnDelivery!;
}

export type SpecIt = GenericSpecIt<MultiUserSetup>;

export function throwDeliveryErrorFrom(
	lastNotif: web3n.asmail.DeliveryProgress
): void {
	assert(lastNotif.allDone, `Given delivery notification is not last`);
	for (const info of Object.values(lastNotif.recipients)) {
		if (info.err) {
			throw errWithCause(
				info.err,
				`Error occured in message delivery:\n${stringifyErr(info.err)}`);
		}
	}
}
