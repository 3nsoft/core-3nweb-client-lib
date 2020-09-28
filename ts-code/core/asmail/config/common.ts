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

import { deepEqual } from '../../../lib-common/json-utils';
import { MailConfigurator } from '../../../lib-client/asmail/service-config';
import { ConnectException } from '../../../lib-common/exceptions/http';
import { JsonFileProc }
	from '../../../lib-client/3nstorage/util/file-based-json';
import { SingleProc } from '../../../lib-common/processes';

type WritableFile = web3n.files.WritableFile;
type FileEvent = web3n.files.FileEvent;

export abstract class ParamOnFileAndServer<TF, TS> extends JsonFileProc<TF> {

	// XXX This should be done in a transactional style, with set on server
	// first. FolderNode with its base class is an example of transactional
	// mechanism implementation.
	
	private changesProc = new SingleProc();

	constructor(
		private paramPath: string,
		private serviceConf: MailConfigurator
	) {
		super();
	}

	async start(file: WritableFile): Promise<void> {
		await super.start(file, async () => {
			await this.initStruct();
			return this.toFileJSON();
		});
		await this.absorbChangesFromFile();
		await this.syncServiceSetting();
	}

	private async absorbChangesFromFile(): Promise<void> {
		const { json } = await this.get();
		this.setFromJSON(json);
	}
	
	private async syncServiceSetting(): Promise<void> {
		// XXX we may have the following bug here:
		// Device with older version of param gets to this point, and sets older
		// value.
		// To protect aginst this case, absorbing from file must ensure highest
		// synced version is read.
		const infoOnServer = await this.serviceConf.getParam<TS>(this.paramPath)
		.catch((exc: ConnectException) => {
			if ((<ConnectException> exc).type === 'http-connect') { return; }
			throw exc;
		});
		const currentVal = this.toServiceJSON();
		if (!deepEqual(infoOnServer, currentVal)) {
			await this.serviceConf.setParam(this.paramPath, currentVal);
		}
	}

	protected async onFileEvent(ev: FileEvent): Promise<void> {
		if (!ev.isRemote) { return; }
		if (ev.type === 'removed') { throw new Error(
			`Unexpected removal of file with parameter ${this.paramPath}`); }
		if (ev.type !== 'file-change') { return; }
		await this.changesProc.startOrChain(() => this.absorbChangesFromFile());
	}
	
	/**
	 * This function updates values on ASMail configuration server.
	 * It also saves data to file, returning file's new version.
	 */
	protected save(): Promise<number> {
		return this.changesProc.startOrChain(async () => {
			await this.serviceConf.setParam(this.paramPath, this.toServiceJSON());
			const version = await super.save(this.toFileJSON());
			return version;
		});
	}
	
	protected abstract setFromJSON(json: TF): void;
	
	protected abstract toFileJSON(): TF;
	
	protected abstract toServiceJSON(): TS;
	
	protected abstract initStruct(): Promise<void>;
	
}

Object.freeze(exports);