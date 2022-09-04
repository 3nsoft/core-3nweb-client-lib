/*
 Copyright (C) 2016 - 2020, 2022 3NSoft Inc.
 
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

import { Storage, wrapStorageImplementation, NodesContainer, StorageGetter, ObjId, NodeEvent, LocalObjStatus } from '../../../lib-client/3nstorage/xsp-fs/common';
import { makeObjExistsExc, makeObjNotFoundExc } from '../../../lib-client/3nstorage/exceptions';
import { bytes as randomBytes } from '../../../lib-common/random-node';
import { secret_box as sbox } from 'ecma-nacl';
import { base64urlSafe } from '../../../lib-common/buffer-utils';
import { LogError } from '../../../lib-client/logging/log-to-file';
import { AsyncSBoxCryptor, Subscribe, ObjSource } from 'xsp-files';
import { ObjFiles, LocalObj } from './obj-files';
import { Broadcast } from '../../../lib-common/utils-for-observables';
import { Observable } from 'rxjs';

type FolderEvent = web3n.files.FolderEvent;
type FileEvent = web3n.files.FileEvent;
type FSType = web3n.files.FSType;


export class LocalStorage implements Storage {

	public readonly type = 'local';
	public readonly versioned = true;
	public readonly nodes = new NodesContainer();
	public readonly connect = undefined;
	private readonly events = new Broadcast<NodeEvent>();

	private constructor(
		private readonly files: ObjFiles,
		private readonly getStorages: StorageGetter,
		public readonly cryptor: AsyncSBoxCryptor,
		public readonly logError: LogError
	) {
		Object.seal(this);
	}

	static async makeAndStart(
		path: string, getStorages: StorageGetter, cryptor: AsyncSBoxCryptor,
		logError: LogError
	): Promise<Storage> {
		const files = await ObjFiles.makeFor(path, logError);
		const s = new LocalStorage(files, getStorages, cryptor, logError);
		return wrapStorageImplementation(s);
	}

	getNodeEvents(): Observable<NodeEvent> {
		return this.events.event$;
	}

	broadcastNodeEvent(
		objId: ObjId, parentObjId: ObjId|undefined, childObjId: ObjId|undefined,
		event: FolderEvent|FileEvent
	): void {
		this.events.next({ objId, parentObjId, childObjId, event });
	}

	storageForLinking(type: FSType, location?: string): Storage {
		if ((type === 'local') || (type === 'synced')) {
			return this.getStorages(type);
		} else if (type === 'share') {
			return this.getStorages('share', location);
		} else {
			throw new Error(`Getting ${type} storage is not implemented in local storage.`);
		}
	}

	private async getObjOrThrow(
		objId: ObjId, allowArchived = false
	): Promise<LocalObj> {
		const obj = await this.files.findObj(objId);
		if (!obj
		|| (!allowArchived && obj.statusObj().isArchived())) {
			throw makeObjNotFoundExc(objId);
		} else {
			return obj;
		}
	}

	async status(objId: ObjId): Promise<LocalObjStatus> {
		const obj = await this.getObjOrThrow(objId);
		return obj.localStatus();
	}

	async generateNewObjId(): Promise<string> {
		const nonce = await randomBytes(sbox.NONCE_LENGTH);
		const id = base64urlSafe.pack(nonce);
		if (this.nodes.reserveId(id)) {
			return id;
		} else {
			return this.generateNewObjId();
		}
	}

	async getObjSrc(objId: ObjId, version?: number): Promise<ObjSource> {
		const obj = await this.getObjOrThrow(objId);
		if (!version) {
			version = obj.statusObj().getCurrentVersionOrThrow();
		}
		return obj.getObjSrc(version);
	}

	async saveObj(
		objId: string, version: number, encSub: Subscribe
	): Promise<void> {
		const obj = await this.files.findObj(objId);
		if (version === 1) {
			if (obj) { throw makeObjExistsExc(objId); }
			await this.files.saveFirstVersion(objId, encSub);
		} else {
			if (!obj) { throw makeObjNotFoundExc(objId); }
			await obj.saveNewVersion(version, encSub);
		}
	}

	async removeObj(objId: string): Promise<void> {
		const obj = await this.getObjOrThrow(objId);
		await obj.removeCurrentVersion();
	}

	async close(): Promise<void> {
		try {
			this.events.done();
		} catch (err) {
			await this.logError(err);
		}
	}

}
Object.freeze(LocalStorage.prototype);
Object.freeze(LocalStorage);


Object.freeze(exports);