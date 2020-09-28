/*
 Copyright (C) 2015 - 2018 3NSoft Inc.
 
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

import * as random from '../../../lib-common/random-node';
import { MailConfigurator } from '../../../lib-client/asmail/service-config';
import * as api from '../../../lib-common/service-api/asmail/config';
import { ParamOnFileAndServer } from './common';
import { ConfigOfASMailServer } from '../config';

interface InvitesJSON {
	invites: {
		[invite: string]: {
			label: string;
			msgMaxSize: number;
		};
	};
}

const INVITE_TOKEN_LEN = 40;

type ExposedFuncs = ConfigOfASMailServer['anonSenderInvites'];

export class Invites extends
		ParamOnFileAndServer<InvitesJSON, api.InvitesList> {
	
	private invites: {
		[invite: string]: {
			label: string;
			msgMaxSize: number;
		};
	} = {};
	
	constructor(serviceConf: MailConfigurator) {
		super(api.p.anonSenderInvites.URL_END, serviceConf);
		Object.seal(this);
	}
	
	protected async initStruct(): Promise<void> {}
	
	protected setFromJSON(json: InvitesJSON): void {
		this.invites = json.invites;
	}
	
	protected toFileJSON(): InvitesJSON {
		return {
			invites: this.invites
		};
	}
	
	protected toServiceJSON(): api.InvitesList {
		const serverJSON: api.InvitesList = {};
		Object.entries(this.invites)
		.forEach(([ invite, params ]) => {
			serverJSON[invite] = params.msgMaxSize;
		});
		return serverJSON;
	}

	getAll: ExposedFuncs['getAll'] = () => {
		const byLabel = new Map<string, { invite: string; msgMaxSize: number; }>();
		Object.entries(this.invites)
		.forEach(([ invite, params ]) => {
			byLabel.set(params.label, { invite, msgMaxSize: params.msgMaxSize });
		});
		return byLabel;
	};

	create: ExposedFuncs['create'] = async (label, msgMaxSize) => {
		const existingInvite = this.findByLabel(label);
		if (existingInvite) { throw new Error(
			`Anonymous sender invite already exists with label ${label}`); }
		const invite = await this.generateNewRandomInvite();
		this.invites[invite] = { label, msgMaxSize };
		await this.save();
		return invite;
	};

	private async generateNewRandomInvite(): Promise<string> {
		let invite: string;
		do {
			invite = await random.stringOfB64Chars(INVITE_TOKEN_LEN);
		} while (this.invites[invite]);
		return invite;
	}

	private findByLabel(label: string): string|undefined {
		const found = Object.entries(this.invites)
		.find(([_, params]) => (params.label === label));
		return (found ? found[0] : undefined);
	}

	setMsgMaxSize: ExposedFuncs['setMsgMaxSize'] = async (label, msgMaxSize) => {
		const invite = this.findByLabel(label);
		if (!invite) { throw new Error(
			`There is no anonymous sender invite with label ${label}`); }
		this.invites[invite].msgMaxSize = msgMaxSize;
		await this.save();
	};
	
}
Object.freeze(Invites.prototype);
Object.freeze(Invites);

Object.freeze(exports);