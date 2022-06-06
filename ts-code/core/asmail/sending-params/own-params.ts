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

import { JsonFileProc }
	from '../../../lib-client/3nstorage/util/file-based-json';
import { SingleProc } from '../../../lib-common/processes/synced';
import { SendingParams } from '../msg/common';
import { copy as jsonCopy } from '../../../lib-common/json-utils';
import { ConfigOfASMailServer } from '../config/index';
import { SendingParamsHolder } from '../sending-params';

type ExposedFuncs = SendingParamsHolder['thisSide'];

type WritableFile = web3n.files.WritableFile;
type FileEvent = web3n.files.FileEvent;

interface ParamsForAcceptingMsgs {
	address: string;
	suggested?: SendingParams;
	inUse?: SendingParams;
}

interface PersistedJSON {
	default?: SendingParams;
	senderSpecific: ParamsForAcceptingMsgs[];
}

const DEFAULT_INVITE_LABEL = 'Default';
const DEFAULT_INVITE_MAX_MSG_SIZE = 1024*1024*1024;

/**
 * Instance of this class keeps track of sending parameters, which user gives to
 * other correspondents for sending messages back. These parameters may have
 * invitation tokens, and this class uses config service to register tokens on
 * a server.
 */
export class OwnSendingParams extends JsonFileProc<PersistedJSON> {

	private params = new Map<string, ParamsForAcceptingMsgs>();
	private defaultParams: SendingParams|undefined = undefined;
	private changesProc = new SingleProc();

	constructor(
		private anonInvites: ConfigOfASMailServer['anonSenderInvites']
	) {
		super();
		Object.seal(this);
	}

	async start(file: WritableFile): Promise<void> {
		await super.start(file, () => ({ senderSpecific: [] }));
		await this.absorbChangesFromFile();
		if (!this.defaultParams) {
			await this.setDefaultParams();
		}
	}

	private async setDefaultParams(): Promise<void> {
		await this.changesProc.startOrChain(async () => {
			const invites = this.anonInvites.getAll();
			const defaultInvite = invites.get(DEFAULT_INVITE_LABEL);
			if (defaultInvite) {
				this.defaultParams = {
					timestamp: 0,
					invitation: defaultInvite.invite
				};
			} else {
				const invitation = await this.anonInvites.create(
					DEFAULT_INVITE_LABEL, DEFAULT_INVITE_MAX_MSG_SIZE);
				this.defaultParams = {
					timestamp: 0,
					invitation
				};
			}
			await this.persist();
		});
	}

	private async persist(): Promise<void> {
		const json: PersistedJSON = {
			default: this.defaultParams,
			senderSpecific: Array.from(this.params.values())
		};
		await this.save(json);
	}

	private async absorbChangesFromFile(): Promise<void> {
		const { json } = await this.get();
		// we may add checks to json data
		this.params.clear();
		json.senderSpecific.forEach(p => this.params.set(p.address, p));
		this.defaultParams = json.default;
	}

	protected async onFileEvent(ev: FileEvent): Promise<void> {
		if (!ev.isRemote) { return; }
		if (ev.type === 'removed') { throw new Error(
			`Unexpected removal of file with invites info`); }
		if (ev.type !== 'file-change') { return; }
		await this.changesProc.startOrChain(() => this.absorbChangesFromFile());
	}

	getFor: ExposedFuncs['getUpdated'] = async (address) => {
		let p = this.params.get(address);
		if (p) {
			if (p.suggested) {
				return p.suggested;
			} else if (p.inUse) {
				return;	// undefined, cause params are known to correspondent,
							// and there are no params to suggest for future use.
			}
		}

		// XXX Or, instead, should we set defaultParams?
		if (!this.defaultParams) { return; }

		p = {
			address,
			suggested: jsonCopy(this.defaultParams)
		};
		p.suggested!.timestamp = Date.now();
		this.params.set(p.address, p);
		await this.persist();

		return p.suggested;
	};

	setAsInUse: ExposedFuncs['setAsUsed'] = async (address, invite) => {
		await this.changesProc.startOrChain(async () => {
			const p = this.params.get(address);
			if (!p || !p.suggested) { return; }
			if (p.suggested.invitation !== invite) { return; }
			p.inUse = p.suggested;
			p.suggested = undefined;
			await this.persist();
		});
	}

}
Object.freeze(OwnSendingParams.prototype);
Object.freeze(OwnSendingParams);

Object.freeze(exports);