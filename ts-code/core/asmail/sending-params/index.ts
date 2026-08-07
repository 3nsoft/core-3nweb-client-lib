/*
 Copyright (C) 2017 - 2018, 2025 - 2026 3NSoft Inc.
 
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

import { makeParamsFromOthers } from './params-from-others';
import { makeOwnSendingParams } from './own-params';
import { ResourcesForSending } from '../delivery/common';
import { ResourcesForReceiving } from '../inbox';
import { ParamOnServer } from '../../../lib-client/asmail/service-config';
import { makeAnonymousInvites } from './invitations-anon';
import { AsyncRNG } from '../../../lib-common/rng-def';

export { SendingParams } from './params-from-others';

type WritableFS = web3n.files.WritableFS;

type SendingResources = ResourcesForSending['correspondents'];
type ReceptionResources = ResourcesForReceiving['correspondents'];

const PARAMS_FROM_OTHERS_FILE = 'params-from-others.json';
const OWN_PARAMS_FILE = 'own-params.json';
const ANONYM_INVITES_FILE = 'anonymous-invites.json';

export interface SendingParamsThisSide {
	getUpdated: SendingResources['newParamsForSendingReplies'];
	setAsUsed: ReceptionResources['markOwnSendingParamsAsUsed'];
}

export interface SendingParamsOtherSides {
	get: SendingResources['paramsForSendingTo'];
	set: ReceptionResources['saveParamsForSendingTo'];
}

export interface SendingParamsHolder {
	thisSide: SendingParamsThisSide;
	otherSides: SendingParamsOtherSides;
	close: () => Promise<void>;
}


export async function makeSendingParamsHolder(
	fs: WritableFS, anonInvitesOnServer: ParamOnServer<'anon-sender/invites'>, random: AsyncRNG
): Promise<SendingParamsHolder> {

	const [ otherSides, thisSide ] = await Promise.all([

		makeParamsFromOthers(fs, PARAMS_FROM_OTHERS_FILE),

		makeOwnSendingParams(
			fs, OWN_PARAMS_FILE,
			await makeAnonymousInvites(fs, ANONYM_INVITES_FILE, anonInvitesOnServer, random)
		)
	]);

	async function close(): Promise<void> {
		await thisSide.close();
		await otherSides.close();
	}

	return {
		thisSide,
		otherSides,
		close
	};
}


Object.freeze(exports);