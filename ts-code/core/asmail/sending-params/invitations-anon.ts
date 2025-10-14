/*
 Copyright (C) 2015 - 2018, 2025 3NSoft Inc.
 
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

import * as random from '../../../lib-common/random-node';
import { ParamOnServer } from '../../../lib-client/asmail/service-config';
import { JsonFileProc } from '../../../lib-client/xsp-fs/util/file-based-json';
import * as api from '../../../lib-common/service-api/asmail/config';
import { ConnectException } from '../../../lib-common/exceptions/http';
import { deepEqual } from '../../../lib-common/json-utils';

type WritableFile = web3n.files.WritableFile;
type FileEvent = web3n.files.FileEvent;
type AnonInvites = web3n.asmail.ASMailConfigParams['anon-sender/invites'];

interface InvitesJSON {
	invites: {
		[invite: string]: {
			label: string;
			msgMaxSize: number;
		};
	};
}

const INVITE_TOKEN_LEN = 40;

export class AnonymousInvites {

	private invites: InvitesJSON['invites'] = {};
	private readonly fileProc: JsonFileProc<InvitesJSON>;

	private constructor(
		private readonly anonInvitesOnServer: ParamOnServer<'anon-sender/invites'>
	) {
		this.fileProc = new JsonFileProc(this.onFileEvent.bind(this));
		Object.seal(this);
	}

	static async makeAndInit(
		file: WritableFile,
		anonInvitesOnServer: ParamOnServer<'anon-sender/invites'>
	): Promise<AnonymousInvites> {
		const anonInvites = new AnonymousInvites(anonInvitesOnServer);
		await anonInvites.fileProc.start(file, () => anonInvites.toFileJSON());

		// XXX these are part of proper syncing logic
		// await anonInvites.absorbRemoteChanges();
		// await anonInvites.syncServiceSetting();

		return anonInvites;
	}

	private async onFileEvent(ev: FileEvent): Promise<void> {
		if (ev.src === 'local') { return; }
		switch (ev.type) {
			case 'file-change':
				await this.fileProc.order.startOrChain(
					() => this.absorbRemoteChanges()
				);
				break;
			case 'removed':
				throw new Error(
					`Unexpected removal of file with parameter "anon-sender/invites"`
				);
			default:
				return;
		}
	}

	protected setFromJSON(json: InvitesJSON): void {
		this.invites = json.invites;
	}

	private toFileJSON(): InvitesJSON {
		return {
			invites: this.invites
		};
	}

	private async persist(): Promise<void> {
		await this.fileProc.order.startOrChain(async () => {
			await this.anonInvitesOnServer.setOnServer(this.toServerParam());
			await this.fileProc.save(this.toFileJSON(), false);
		});
	}

	private async absorbRemoteChanges(): Promise<void> {
		// XXX
		//  - check for changes: what is needed here from fileProc, and what is
		//    generic in absorbing remote changes to refactor it into JsonFileProc
		//  - absorb and sync, if needed: what can be in JsonFileProc
		// Code from pre-v.sync:
		// const { json } = await this.fileProc.get();
		// this.setFromJSON(json);
	}

	private toServerParam(): AnonInvites {
		const serverParam: AnonInvites = {};
		for (const [ invite, { msgMaxSize } ] of Object.entries(this.invites)) {
			serverParam[invite] = msgMaxSize;
		}
		return serverParam;
	}

	private toServiceJSON(): api.InvitesList {
		const serverJSON: api.InvitesList = {};
		Object.entries(this.invites)
		.forEach(([ invite, params ]) => {
			serverJSON[invite] = params.msgMaxSize;
		});
		return serverJSON;
	}

	private async syncServiceSetting(rethrowConnectExc = false): Promise<void> {
		// XXX we may have the following bug here:
		// Device with older version of param gets to this point, and sets older
		// value.
		// To protect aginst this case, absorbing from file must ensure highest
		// synced version is read.
		try {
			const infoOnServer = await this.anonInvitesOnServer.getFromServer()
			.catch((exc: ConnectException) => {
				if (exc.type === 'connect') {
					return;
				} else {
					throw exc;
				}
			});
			const currentVal = this.toServiceJSON();
			if (!deepEqual(infoOnServer, currentVal)) {
				await this.anonInvitesOnServer.setOnServer(currentVal);
			}
		} catch (exc) {
			if (!rethrowConnectExc
			&& ((exc as ConnectException).type === 'connect')) {
				return;
			}
			throw exc;
		}
	}

	getAll(): Map<string, { invite: string; msgMaxSize: number; }> {
		const byLabel = new Map<string, { invite: string; msgMaxSize: number; }>();
		Object.entries(this.invites)
		.forEach(([ invite, params ]) => {
			byLabel.set(params.label, { invite, msgMaxSize: params.msgMaxSize });
		});
		return byLabel;
	};

	async create(label: string, msgMaxSize: number): Promise<string> {
		const existingInvite = this.findByLabel(label);
		if (existingInvite) {
			throw new Error(
				`Anonymous sender invite already exists with label ${label}`
			);
		}
		const invite = await this.generateNewRandomInvite();
		this.invites[invite] = { label, msgMaxSize };
		try {
			await this.persist();
			return invite;
		} catch (exc) {
			delete this.invites[invite];
			throw exc;
		}
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

	async setMsgMaxSize(label: string, msgMaxSize: number): Promise<void> {
		const invite = this.findByLabel(label);
		if (!invite) {
			throw new Error(
				`There is no anonymous sender invite with label ${label}`
			);
		}
		this.invites[invite].msgMaxSize = msgMaxSize;
		await this.persist();
	};

	async close(): Promise<void> {
		await this.fileProc.close();
	}

}
Object.freeze(AnonymousInvites.prototype);
Object.freeze(AnonymousInvites);


Object.freeze(exports);