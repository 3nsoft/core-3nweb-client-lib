/*
 Copyright (C) 2025 3NSoft Inc.
 
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

import { ServiceLocator } from '../../lib-client/service-locator';
import { MailConfigurator, ParamOnServer } from '../../lib-client/asmail/service-config';
import { GetSigner } from '../id-manager';
import { NetClient } from '../../lib-client/request-utils';

type Service = web3n.asmail.ASMailConfigService;
type ASMailConfigParams = web3n.asmail.ASMailConfigParams;

/**
 * Instance of this class updates and checks setting of ASMail server.
 */
export class ConfigOfASMailServer {
	
	private readonly serverConfig: MailConfigurator;

	constructor(
		address: string, getSigner: GetSigner,
		resolver: ServiceLocator, net: NetClient
	) {
		this.serverConfig = new MailConfigurator(
			address, getSigner, () => resolver(this.serverConfig.userId), net
		);
		Object.freeze(this);
	}

	makeParamSetterAndGetter<P extends keyof ASMailConfigParams>(
		param: P
	): ParamOnServer<P> {
		return this.serverConfig.makeParamSetterAndGetter(param);
	}

	makeCAP(): Service {
		const w: Service = {
			getOnServer: this.serverConfig.getParam.bind(this.serverConfig),
			setOnServer: this.serverConfig.setParam.bind(this.serverConfig)
		};
		return Object.freeze(w);
	}

}
Object.freeze(ConfigOfASMailServer.prototype);
Object.freeze(ConfigOfASMailServer);


Object.freeze(exports);