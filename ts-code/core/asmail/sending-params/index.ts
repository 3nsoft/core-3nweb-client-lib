/*
 Copyright (C) 2017 - 2018 3NSoft Inc.
 
 This program is free software: you can redistribute it and/or modify it under
 the terms of the GNU General Public License as published by the Free Software
 Foundation, either version 3 of the License, or (at your option) any later
 version.
 
 This program is distributed in the hope that it will be useful, but
 WITHOUT ANY WARRANTY; without even the implied warranty of
 MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 See the GNU General Public License for more details.
 
 You should have received a copy of the GNU General Public License along with
 this program. If not, see <http://www.gnu.org/licenses/>. */

import { ParamsFromOthers } from './params-from-others';
import { OwnSendingParams } from './own-params';
import { ResourcesForSending } from '../delivery/common';
import { ConfigOfASMailServer } from '../config/index';
import { ResourcesForReceiving } from '../inbox';

export { SendingParams } from './params-from-others';

type WritableFS = web3n.files.WritableFS;

type SendingResources = ResourcesForSending['correspondents'];
type ReceptionResources = ResourcesForReceiving['correspondents'];

const PARAMS_FROM_OTHERS_FILE = 'params-from-others.json';
const OWN_PARAMS_FILE = 'own-params.json';

export class SendingParamsHolder {

	private paramsFromOthers: ParamsFromOthers;
	private ownParams: OwnSendingParams;

	thisSide: {
		getUpdated: SendingResources['newParamsForSendingReplies'];
		setAsUsed: ReceptionResources['markOwnSendingParamsAsUsed'];
	};
	otherSides: {
		get: SendingResources['paramsForSendingTo'];
		set: ReceptionResources['saveParamsForSendingTo'];
	};

	private constructor(
		anonSenderInvites: ConfigOfASMailServer['anonSenderInvites']
	) {
		this.paramsFromOthers = new ParamsFromOthers();
		this.ownParams = new OwnSendingParams(anonSenderInvites);
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

	static async makeAndStart(fs: WritableFS,
			anonSenderInvites: ConfigOfASMailServer['anonSenderInvites']):
			Promise<SendingParamsHolder> {
		const h = new SendingParamsHolder(anonSenderInvites);
		await Promise.all([
			fs.writableFile(PARAMS_FROM_OTHERS_FILE)
			.then(f => h.paramsFromOthers.start(f)),

			fs.writableFile(OWN_PARAMS_FILE)
			.then(f => h.ownParams.start(f))
		]);
		await fs.close();
		return h;
	}

}
Object.freeze(SendingParamsHolder.prototype);
Object.freeze(SendingParamsHolder);

Object.freeze(exports);