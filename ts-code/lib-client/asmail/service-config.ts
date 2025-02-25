/*
 Copyright (C) 2015, 2020, 2025 3NSoft Inc.
 
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
import { ServiceUser, IGetMailerIdSigner, ServiceAccessParams } from '../user-with-mid-session';
import { asmailInfoAt } from '../service-locator';

type ASMailConfigParams = web3n.asmail.ASMailConfigParams;

const configAccessParams: ServiceAccessParams = {
	login: api.midLogin.MID_URL_PART,
	logout: api.closeSession.URL_END,
	canBeRedirected: true
};

export interface ParamOnServer<P extends keyof ASMailConfigParams> {
	setOnServer: (value: ASMailConfigParams[P]|null) => Promise<void>;
	getFromServer: () => Promise<ASMailConfigParams[P]|null>;
}


export class MailConfigurator extends ServiceUser {

	constructor(
		userId: string, getSigner: IGetMailerIdSigner,
		mainUrlGetter: () => Promise<string>,
		net: NetClient
	) {
		super(
			userId, configAccessParams, getSigner,
			serviceUriGetter(net, mainUrlGetter), net
		);
		Object.seal(this);
	}

	async getParam<P extends keyof ASMailConfigParams>(
		param: P
	): Promise<ASMailConfigParams[P]|null> {
		const urlEnd = urlEndForParam(param);
		const rep = await this.doBodylessSessionRequest<ASMailConfigParams[P]>({
			appPath: urlEnd,
			method: 'GET',
			responseType: 'json'
		});
		if (rep.status !== api.PARAM_SC.ok) {
			throw makeException(rep, 'Unexpected status');
		}
		return rep.data;
	}

	async setParam<P extends keyof ASMailConfigParams>(
		param: P,
		value: ASMailConfigParams[P]|null
	): Promise<void> {
		const urlEnd = urlEndForParam(param);
		const rep = await this.doJsonSessionRequest<void>({
			appPath: urlEnd,
			method: 'PUT',
		}, value);
		if (rep.status !== api.PARAM_SC.ok) {
			throw makeException(rep, 'Unexpected status');
		}
	}

	makeParamSetterAndGetter<P extends keyof ASMailConfigParams>(
		param: P
	): ParamOnServer<P> {
		return {
			getFromServer: () => this.getParam(param),
			setOnServer: value => this.setParam(param, value)
		};
	}

}
Object.freeze(MailConfigurator.prototype);
Object.freeze(MailConfigurator);


function serviceUriGetter(
	net: NetClient, mainUrlGetter: () => Promise<string>
): () => Promise<string> {
	return async (): Promise<string> => {
		const serviceUrl = await mainUrlGetter();
		const info = await asmailInfoAt(net, serviceUrl);
		if (!info.config) {
			throw new Error(
				`Missing configuration service url in ASMail information at ${serviceUrl}`
			);
		}
		return info.config;
	}
}

function urlEndForParam(param: keyof ASMailConfigParams): string {
	switch (param) {
		case 'anon-sender/invites':
		case 'anon-sender/policy':
		case 'auth-sender/blacklist':
		case 'auth-sender/invites':
		case 'auth-sender/policy':
		case 'auth-sender/whitelist':
		case 'init-pub-key':
			return `param/${param}`;
		default:
			throw new Error(
				`Invalid ASMail server configuration parameter: ${param}`
			);
	}
}


Object.freeze(exports);