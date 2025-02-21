/*
 Copyright (C) 2017 - 2018, 2025 3NSoft Inc.
 
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

import { ParamsFromOthers } from './params-from-others';
import { OwnSendingParams } from './own-params';
import { ResourcesForSending } from '../delivery/common';
import { ResourcesForReceiving } from '../inbox';
import { ParamOnServer } from '../../../lib-client/asmail/service-config';
import { AnonymousInvites } from './invitations-anon';

export { SendingParams } from './params-from-others';

type WritableFS = web3n.files.WritableFS;

type SendingResources = ResourcesForSending['correspondents'];
type ReceptionResources = ResourcesForReceiving['correspondents'];

const PARAMS_FROM_OTHERS_FILE = 'params-from-others.json';
const OWN_PARAMS_FILE = 'own-params.json';
const ANONYM_INVITES_FILE = 'anonymous-invites.json';


export class SendingParamsHolder {

	readonly thisSide: {
		getUpdated: SendingResources['newParamsForSendingReplies'];
		setAsUsed: ReceptionResources['markOwnSendingParamsAsUsed'];
	};
	readonly otherSides: {
		get: SendingResources['paramsForSendingTo'];
		set: ReceptionResources['saveParamsForSendingTo'];
	};

	private constructor(
		private readonly paramsFromOthers: ParamsFromOthers,
		private readonly ownParams: OwnSendingParams
	) {
		this.otherSides = {
			get: this.paramsFromOthers.getFor,
			set: this.paramsFromOthers.setFor
		};
		this.thisSide = {
			getUpdated: this.ownParams.getFor,
			setAsUsed: this.ownParams.setAsInUse
		};
		Object.freeze(this);
	}

	static async makeAndInit(
		fs: WritableFS,
		anonInvitesOnServer: ParamOnServer<'anon-sender/invites'>
	): Promise<SendingParamsHolder> {
		const [ paramsFromOthers, ownParams ] = await Promise.all([
			fs.writableFile(PARAMS_FROM_OTHERS_FILE)
			.then(f => ParamsFromOthers.makeAndInit(f)),

			fs.writableFile(ANONYM_INVITES_FILE)
			.then(async anonInvitesFile => {
				const anonInvites = await AnonymousInvites.makeAndInit(
					anonInvitesFile, anonInvitesOnServer
				);
				return await OwnSendingParams.makeAndInit(
					await fs.writableFile(OWN_PARAMS_FILE),
					anonInvites
				);
			})
		]);
		await fs.close();
		return new SendingParamsHolder(paramsFromOthers, ownParams);
	}

	async close(): Promise<void> {
		await this.ownParams.close();
		await this.paramsFromOthers.close();
	}

}
Object.freeze(SendingParamsHolder.prototype);
Object.freeze(SendingParamsHolder);


Object.freeze(exports);