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

import { initSyncedFile, watchAndApplyChangesFromOtherDevices } from '../../../lib-common/dataset-sync/single-file';
import { SendingParams } from '../msg/common';
import { SendingParamsHolder } from '../sending-params';

export type { SendingParams } from '../msg/common';

type WritableFS = web3n.files.WritableFS;

interface ParamsForSending extends SendingParams {
	address: string;
}

export type ParamsFromOthers = Awaited<ReturnType<typeof makeParamsFromOthers>>;

export async function makeParamsFromOthers(
	fs: WritableFS, fileName: string
): Promise<SendingParamsHolder['otherSides'] & { close: () => Promise<void>; }> {

	const {
		file: paramsFile, changeProc
	} = await initSyncedFile(
		fs, fileName,
		newFile => newFile.writeJSON([])
	);

	function parseParamsFromJSON(json: any): Record<string, SendingParams> {
		if (Array.isArray(json)) {
			// older serialization form
			const p: Record<string, SendingParams> = {};
			for (const paramsForSending of json) {
				const { address, timestamp, auth, invitation } = paramsForSending as ParamsForSending;
				p[address] = { timestamp, auth, invitation };
			}
			return p;
		} else if (json && (typeof json === 'object')) {
			return json as any;
		} else {
			return {};
		}
	}

	let params = parseParamsFromJSON(await paramsFile.readJSON());

	async function onChangeFromOtherDevices(newVersion: number) {
		changeProc.startOrChain(async () => {
			const { version, json } = await paramsFile.v!.readJSON<Record<string, SendingParams>>();
			if (version === newVersion) {
				const incomingParams = parseParamsFromJSON(json);
				mergeIncomingParams(incomingParams);
			}
		});
	}

	function mergeIncomingParams(incomingParams: Record<string, SendingParams>) {
		for (const [address, inP] of Object.entries(incomingParams)) {
			const existing = params[address];
			if (existing && (existing.timestamp >= inP.timestamp)) {
				return;
			}
			params[address] = inP;
		}
	}

	function doOnConflict() {
		return changeProc.startOrChain(async () => {
			const { remote, state } = await paramsFile.v!.sync!.status(false);
			if ((state !== 'conflicting') || !remote?.latest) {
				return;
			}
			const onRemote = parseParamsFromJSON(
				(await paramsFile.v!.readJSON<Record<string, SendingParams>>({ remoteVersion: remote.latest })).json
			);
			const numRemRecs = Object.keys(onRemote).length;
			const numExistingRecs = Object.keys(params).length;
			let paramsWhereUpdated = (numExistingRecs > numRemRecs);
			for (const [address, inP] of Object.entries(onRemote)) {
				const existing = params[address];
				if (existing.timestamp < inP.timestamp) {
					params[address] = inP;
					paramsWhereUpdated = true;
				} else if (existing.timestamp > inP.timestamp) {
					paramsWhereUpdated = true;
				}
			}
			if (paramsWhereUpdated) {
				await paramsFile.v!.sync!.upload({ uploadVersion: remote.latest + 1 });
			} else {
				await paramsFile.v!.sync!.adoptRemote({ remoteVersion: remote.latest });
			}
		});
	}

	const {
		stopFileWatching, triggerUpload
	} = watchAndApplyChangesFromOtherDevices(
		paramsFile, changeProc, onChangeFromOtherDevices, doOnConflict
	);

	function get(address: string) {
		const p = params[address];
		if (!p) { return; }
		return copyParams(p);
	};

	async function set(address: string, params: SendingParams) {
		return changeProc.startOrChain(async () => {
			const existing = params[address];
			if (existing && (existing.timestamp >= params.timestamp)) {
				return;
			}
			params[address] = copyParams(params);
			await paramsFile.writeJSON(params);
			triggerUpload();
		});
	}

	async function close(): Promise<void> {
		stopFileWatching();
	}

	return {
		get,
		set,
		close
	};
}

/**
 * This copies SendingParams' fields, returning a copy, which was either
 * created, or given.
 * @param p is parameter's object, from which fields are copied.
 * @param copy is an optional object, which may be something that extends
 * SendingParams, i.e. has other fields.
 */
function copyParams(p: SendingParams, copy?: SendingParams): SendingParams {
	if (!copy) {
		copy = {} as SendingParams;
	}
	copy.timestamp = p.timestamp;
	if (p.auth === true) {
		copy.auth = true;
	}
	if ((typeof p.invitation === 'string') && p.invitation) {
		copy.invitation = p.invitation;
	}
	return copy;
}

Object.freeze(exports);