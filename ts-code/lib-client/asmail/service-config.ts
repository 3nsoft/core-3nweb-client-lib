/*
 Copyright (C) 2015, 2020 3NSoft Inc.
 
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

/**
 * This defines functions that implement ASMail configuration protocol.
 */

import { makeException, NetClient } from '../request-utils';
import * as api from '../../lib-common/service-api/asmail/config';
import { ServiceUser, IGetMailerIdSigner } from '../user-with-mid-session';
import { asmailInfoAt } from '../service-locator';

export class MailConfigurator extends ServiceUser {

	paramsOnServer: {
		[name: string]: any;
	};

	constructor(
		userId: string, getSigner: IGetMailerIdSigner,
		mainUrlGetter: () => Promise<string>,
		net: NetClient
	) {
		super(userId,
			{
				login: api.midLogin.MID_URL_PART,
				logout: api.closeSession.URL_END,
				canBeRedirected: true
			},
			getSigner,
			async (): Promise<string> => {
				const serviceUrl = await mainUrlGetter();
				const info = await asmailInfoAt(this.net, serviceUrl);
				if (!info.config) { throw new Error(`Missing configuration service url in ASMail information at ${serviceUrl}`); }
				return info.config;
			},
			net);
		this.paramsOnServer = {};
		Object.seal(this);
	}

	async getParam<T>(urlEnd: string): Promise<T> {
		const rep = await this.doBodylessSessionRequest<T>({
			appPath: urlEnd,
			method: 'GET',
			responseType: 'json'
		});
		if (rep.status !== api.PARAM_SC.ok) {
			throw makeException(rep, 'Unexpected status');
		}
		return rep.data;
	}

	async setParam<T>(urlEnd: string, param: T): Promise<void> {
		const rep = await this.doJsonSessionRequest<void>({
			appPath: urlEnd,
			method: 'PUT',
		}, param);
		if (rep.status !== api.PARAM_SC.ok) {
			throw makeException(rep, 'Unexpected status');
		}
	}

}
Object.freeze(MailConfigurator.prototype);
Object.freeze(MailConfigurator);

Object.freeze(exports);