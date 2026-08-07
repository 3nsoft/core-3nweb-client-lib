/*
 Copyright (C) 2015 - 2018, 2025 - 2026 3NSoft Inc.
 
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

import { ParamOnServer } from '../../../lib-client/asmail/service-config';
import { AsyncRNG, stringOfB64Chars } from '../../../lib-common/rng-def';
import { initSyncedFile, watchAndApplyChangesFromOtherDevices } from '../../../lib-common/dataset-sync/single-file';

type WritableFS = web3n.files.WritableFS;
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

export type AnonymousInvites = Awaited<ReturnType<typeof makeAnonymousInvites>>;

export async function makeAnonymousInvites(
	fs: WritableFS, fileName: string, anonInvitesOnServer: ParamOnServer<'anon-sender/invites'>, random: AsyncRNG
) {

	const {
		file: invitesFile, changeProc
	} = await initSyncedFile(
		fs, fileName,
		newFile => newFile.writeJSON({ invites: {} } as InvitesJSON)
	);

	function parseInvitesFromJSON(json: InvitesJSON): InvitesJSON['invites'] {
		const invites = json.invites;
		if (invites || (typeof invites === 'object')) {
			return invites;
		} else {
			return {};
		}
	}

	let invites = parseInvitesFromJSON(await invitesFile.readJSON());

	async function onChangeFromOtherDevices(newVersion: number) {
		changeProc.startOrChain(async () => {
			const { version, json } = await invitesFile.v!.readJSON<InvitesJSON>();
			if (version === newVersion) {
				invites = parseInvitesFromJSON(json);
			}
		});
	}

	function doOnConflict() {
		return changeProc.startOrChain(async () => {
			const { remote, state } = await invitesFile.v!.sync!.status(false);
			if ((state !== 'conflicting') || !remote?.latest) {
				return;
			}
			const onRemote = (await invitesFile.v!.readJSON<InvitesJSON>({ remoteVersion: remote.latest })).json;
			const numOfInvitesOnRemote = Object.keys(onRemote.invites).length;
			const numOfCurrentInvites = Object.keys(invites).length;
			const joined = { ...onRemote.invites, ...invites };
			const numOfJoined = Object.keys(joined).length;
			if ((numOfCurrentInvites === numOfInvitesOnRemote) && (numOfCurrentInvites === numOfJoined)) {
				await invitesFile.v!.sync!.adoptRemote({ remoteVersion: remote.latest });
			} else {
				invites = joined;
				await invitesFile.writeJSON({ invites } as InvitesJSON);
				await invitesFile.v!.sync!.upload({ uploadVersion: remote.latest + 1 });
				await anonInvitesOnServer.setOnServer(invitesToServerParamForm(invites));
			}
		});
	}

	const {
		stopFileWatching, triggerUpload
	} = watchAndApplyChangesFromOtherDevices(
		invitesFile, changeProc, onChangeFromOtherDevices, doOnConflict
	);

	async function persist(): Promise<void> {
		await anonInvitesOnServer.setOnServer(invitesToServerParamForm(invites));
		await invitesFile.writeJSON({ invites } as InvitesJSON);
		triggerUpload();
	}

	function invitesToServerParamForm(invites: InvitesJSON['invites']): AnonInvites {
		const serverParam: AnonInvites = {};
		for (const [ invite, { msgMaxSize } ] of Object.entries(invites)) {
			serverParam[invite] = msgMaxSize;
		}
		return serverParam;
	}

	function getAll(): Map<string, { invite: string; msgMaxSize: number; }> {
		const byLabel = new Map<string, { invite: string; msgMaxSize: number; }>();
		Object.entries(invites)
		.forEach(([ invite, params ]) => {
			byLabel.set(params.label, { invite, msgMaxSize: params.msgMaxSize });
		});
		return byLabel;
	}

	function create(label: string, msgMaxSize: number): Promise<string> {
		return changeProc.startOrChain(async () => {
			const existingInvite = findByLabel(label);
			if (existingInvite) {
				throw new Error(`Anonymous sender invite already exists with label ${label}`);
			}
			const invite = await generateNewRandomInvite();
			invites[invite] = { label, msgMaxSize };
			try {
				await persist();
				return invite;
			} catch (exc) {
				delete invites[invite];
				throw exc;
			}
		});
	}

	async function generateNewRandomInvite(): Promise<string> {
		let invite: string;
		do {
			invite = await stringOfB64Chars(INVITE_TOKEN_LEN, random);
		} while (invites[invite]);
		return invite;
	}

	function findByLabel(label: string): string|undefined {
		const found = Object.entries(invites)
		.find(([_, params]) => (params.label === label));
		return (found ? found[0] : undefined);
	}

	async function close(): Promise<void> {
		stopFileWatching();
	}

	return {
		create,
		getAll,
		close
	};
}


Object.freeze(exports);