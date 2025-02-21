/*
 Copyright (C) 2017 - 2018, 2025 3NSoft Inc.
 
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

import { JsonFileProc } from '../../../lib-client/xsp-fs/util/file-based-json';
import { SendingParams } from '../msg/common';
import { SendingParamsHolder } from '../sending-params';

export { SendingParams } from '../msg/common';

type ExposedFuncs = SendingParamsHolder['otherSides'];

type WritableFile = web3n.files.WritableFile;
type FileEvent = web3n.files.FileEvent;

interface ParamsForSending extends SendingParams {
	address: string;
}

export class ParamsFromOthers {

	private readonly params = new Map<string, ParamsForSending>();
	private readonly fileProc: JsonFileProc<ParamsForSending[]>;

	private constructor() {
		this.fileProc = new JsonFileProc(this.onFileEvent.bind(this));
		Object.seal(this);
	}

	static async makeAndInit(file: WritableFile): Promise<ParamsFromOthers> {
		const paramsFromOthers = new ParamsFromOthers();
		await paramsFromOthers.fileProc.start(file, []);
		await paramsFromOthers.absorbRemoteChanges();
		return paramsFromOthers;
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

	protected async onFileEvent(ev: FileEvent): Promise<void> {
		if (ev.src === 'local') { return; }
		switch (ev.type) {
			case 'file-change':
				await this.fileProc.order.startOrChain(
					() => this.absorbRemoteChanges()
				);
				break;
			case 'removed':
				throw new Error(`Unexpected removal of file with invites info`);
			default:
				return;
		}
	}

	getFor: ExposedFuncs['get'] = (address) => {
		const p = this.params.get(address);
		if (!p) { return; }
		return copyParams(p);
	};

	setFor: ExposedFuncs['set'] = (address, params) => {
		return this.fileProc.order.startOrChain(async () => {
			const existing = this.params.get(address);
			if (existing && (existing.timestamp >= params.timestamp)) { return; }

			const p = { address } as ParamsForSending;
			copyParams(params, p);

			this.params.set(p.address, p);
			await this.persist();
		});
	}

	private async persist(): Promise<void> {
		const json = Array.from(this.params.values());
		await this.fileProc.save(json, false);
	}

	async close(): Promise<void> {
		await this.fileProc.close();
	}

}
Object.freeze(ParamsFromOthers.prototype);
Object.freeze(ParamsFromOthers);

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