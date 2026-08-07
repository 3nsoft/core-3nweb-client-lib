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

// import { JsonFileProc } from '../../../lib-client/xsp-fs/util/file-based-json';
import { SendingParams } from '../msg/common';
import { copy as jsonCopy, deepEqual } from '../../../lib-common/json-utils';
import { SendingParamsHolder } from './index';
// import { ParamOnServer } from '../../../lib-client/asmail/service-config';
import { AnonymousInvites } from './invitations-anon';
import { initSyncedFile, watchAndApplyChangesFromOtherDevices } from '../../../lib-common/dataset-sync/single-file';

type WritableFS = web3n.files.WritableFS;

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

export type OwnSendingParams = Awaited<ReturnType<typeof makeOwnSendingParams>>;

export async function makeOwnSendingParams(
	fs: WritableFS, fileName: string, anonInvites: AnonymousInvites
): Promise<SendingParamsHolder['thisSide'] & { close: () => Promise<void>; }> {

	let params: Record<string, ParamsForAcceptingMsgs> = {};
	let defaultParams: SendingParams|undefined = undefined;

	const {
		file: paramsFile, changeProc
	} = await initSyncedFile(
		fs, fileName,
		newFile => newFile.writeJSON(currentToFileJSON())
	);

	if (!paramsFile.isNew) {
		({ defaultParams, params } = parseFromJSON(await paramsFile.readJSON()));
	}

	const {
		stopFileWatching, triggerUpload
	} = watchAndApplyChangesFromOtherDevices(
		paramsFile, changeProc, onChangeFromOtherDevices, doOnConflict
	);

	if (paramsFile.isNew) {
		await setDefaultParams();
	}

	async function setDefaultParams(): Promise<void> {
		await changeProc.startOrChain(async () => {
			const invites = anonInvites.getAll();
			const defaultInvite = invites.get(DEFAULT_INVITE_LABEL);
			if (defaultInvite) {
				defaultParams = {
					timestamp: 0,
					invitation: defaultInvite.invite
				};
			} else {
				const invitation = await anonInvites.create(
					DEFAULT_INVITE_LABEL, DEFAULT_INVITE_MAX_MSG_SIZE
				);
				defaultParams = {
					timestamp: 0,
					invitation
				};
			}
			await persist();
		});
	}

	function currentToFileJSON(): PersistedJSON {
		return {
			default: defaultParams,
			senderSpecific: Object.values(params)
		};
	}

	async function persist(): Promise<void> {
		await paramsFile.writeJSON(currentToFileJSON());
		triggerUpload();
	}

	function parseFromJSON(json: PersistedJSON) {
		const params = {} as Record<string, ParamsForAcceptingMsgs>;
		for (const p of json.senderSpecific) {
			params[p.address] = p;
		}
		return {
			defaultParams: json.default,
			params
		};
	}

	function onChangeFromOtherDevices(newVersion: number): Promise<void> {
		return changeProc.startOrChain(async () => {
			const { version, json } = await paramsFile.v!.readJSON<PersistedJSON>();
			if (version === newVersion) {
				({ defaultParams, params } = parseFromJSON(json));
			}
		});
	}

	function doOnConflict() {
		return changeProc.startOrChain(async () => {
			const { remote, state } = await paramsFile.v!.sync!.status(false);
			if ((state !== 'conflicting') || !remote?.latest) {
				return;
			}
			const onRemote = parseFromJSON(
				(await paramsFile.v!.readJSON<PersistedJSON>({ remoteVersion: remote.latest })).json
			);

			let uploadLocal = false;
			if (!onRemote.defaultParams && defaultParams) {
				uploadLocal = true;
			} else if (onRemote.defaultParams && !defaultParams) {
				defaultParams = onRemote.defaultParams;
			} else if (onRemote.defaultParams && defaultParams) {
				if (onRemote.defaultParams.timestamp >= defaultParams.timestamp) {
					defaultParams = onRemote.defaultParams;
				} else {
					uploadLocal = true;
				}
			}

			for (const [addr, p] of Object.entries(params)) {
				const remP = onRemote.params[addr];
				if (!remP) {
					uploadLocal = true;
					continue;
				}
				if (deepEqual(p, remP)) {
					continue;
				}
				const tsP = Math.max(p?.inUse?.timestamp ?? 0, p?.suggested?.timestamp ?? 0);
				const tsRem = Math.max(remP?.inUse?.timestamp ?? 0, remP?.suggested?.timestamp ?? 0);
				if (tsP > tsRem) {
					uploadLocal = true;
				} else if (tsP < tsRem) {
					params[addr] = remP;
				} else if (tsP !== 0) {
					if (remP.inUse?.timestamp === tsP) {
						params[addr] = remP;
					} else if (p.inUse?.timestamp === tsP) {
						uploadLocal = true;
					}
				}
			}

			if (uploadLocal) {
				await paramsFile.writeJSON(currentToFileJSON());
				await paramsFile.v!.sync!.upload({ uploadVersion: remote.latest + 1 });
			} else {
				await paramsFile.v!.sync!.adoptRemote({ remoteVersion: remote.latest })
			}
		});
	}

	async function getUpdated(address: string) {
		return changeProc.startOrChain(async () => {
			let p = params[address];
			if (p) {
				if (p.suggested) {
					return p.suggested;
				} else if (p.inUse) {
					return;	// undefined, cause params are known to correspondent,
								// and there are no params to suggest for future use.
				}
			}

			// XXX Or, instead, should we set defaultParams?
			if (!defaultParams) { return; }

			p = {
				address,
				suggested: jsonCopy(defaultParams)
			};
			p.suggested!.timestamp = Date.now();
			params[p.address] = p;
			await persist();
			return p.suggested;
		});
	}

	function setAsUsed(address: string, invite: string) {
		return changeProc.startOrChain(async () => {
			const p = params[address];
			if (!p?.suggested || (p.suggested.invitation !== invite)) {
				return;
			}
			p.inUse = p.suggested;
			p.suggested = undefined;
			await persist();
		});
	}

	async function close(): Promise<void> {
		anonInvites.close();
		stopFileWatching();
	}

	return {
		close,
		getUpdated,
		setAsUsed
	};
}

Object.freeze(exports);