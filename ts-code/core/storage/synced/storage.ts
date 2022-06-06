/*
 Copyright (C) 2015 - 2020, 2022 3NSoft Inc.
 
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

import { IGetMailerIdSigner } from '../../../lib-client/user-with-mid-session';
import { SyncedStorage as ISyncedStorage, wrapSyncStorageImplementation,  NodesContainer, wrapStorageImplementation, Storage as IStorage, StorageGetter, ObjId, NodeEvent } from '../../../lib-client/3nstorage/xsp-fs/common';
import { makeObjNotFoundExc, makeObjExistsExc } from '../../../lib-client/3nstorage/exceptions';
import { StorageOwner as RemoteStorage } from '../../../lib-client/3nstorage/service';
import { ScryptGenParams } from '../../../lib-client/key-derivation';
import { ObjFiles, SyncedObj } from './obj-files';
import { bytes as randomBytes } from '../../../lib-common/random-node';
import { base64urlSafe } from '../../../lib-common/buffer-utils';
import { LogError } from '../../../lib-client/logging/log-to-file';
import { AsyncSBoxCryptor, NONCE_LENGTH, Subscribe, ObjSource } from 'xsp-files';
import { Downloader } from './downloader';
import { RemoteEvents } from './remote-events';
import { UpSyncer } from './upsyncer';
import { NetClient } from '../../../lib-client/request-utils';
import { Observable } from 'rxjs';
import { Broadcast } from '../../../lib-common/utils-for-observables';
import { UpSyncTaskInfo } from './obj-status';

type FolderEvent = web3n.files.FolderEvent;
type FileEvent = web3n.files.FileEvent;
type Stats = web3n.files.Stats;


export class SyncedStore implements ISyncedStorage {
	
	public readonly type: web3n.files.FSType = 'synced';
	public readonly versioned = true;
	public readonly nodes = new NodesContainer();
	private readonly remoteEvents: RemoteEvents;
	private readonly uploader: UpSyncer;
	private readonly events = new Broadcast<NodeEvent>();

	private constructor(
		private readonly files: ObjFiles,
		private readonly remoteStorage: RemoteStorage,
		private readonly getStorages: StorageGetter,
		public readonly cryptor: AsyncSBoxCryptor,
		private readonly logError: LogError
	) {
		const getFSNodes = (objId: ObjId) => this.nodes.get(objId);
		this.remoteEvents = new RemoteEvents(
			this.remoteStorage, this.files, getFSNodes, this.logError);
		this.uploader = new UpSyncer(this.remoteStorage, this.logError,
			this.broadcastUpSyncEvent.bind(this));
		Object.seal(this);
	}

	static async makeAndStart(
		path: string, user: string, getSigner: IGetMailerIdSigner,
		getStorages: StorageGetter, cryptor: AsyncSBoxCryptor,
		remoteServiceUrl: () => Promise<string>,
		makeNet: () => NetClient, logError: LogError
	): Promise<{ syncedStore: ISyncedStorage; startObjProcs: () => void; }> {
		const remote = new RemoteStorage(
			user, getSigner, remoteServiceUrl, makeNet());
		const objFiles = await ObjFiles.makeFor(
			path, new Downloader(remote), logError);
		const s = new SyncedStore(
			objFiles, remote, getStorages, cryptor, logError);
		s.uploader.start();
		return {
			syncedStore: wrapSyncStorageImplementation(s),
			startObjProcs: () => {
				s.remoteEvents.startAbsorbingRemoteEvents();
			}
		};
	}

	getNodeEvents(): Observable<NodeEvent> {
		return this.events.event$;
	}

	broadcastNodeEvent(
		objId: ObjId, parentObjId: ObjId|undefined, event: FolderEvent|FileEvent
	): void {
		this.events.next({ objId, parentObjId, event });
	}

	private broadcastUpSyncEvent(objId: ObjId, task: UpSyncTaskInfo): void {
		const node = this.nodes.get(objId);
		if (!node) { return; }
		node.broadcastUpSyncEvent(task);
	}

	storageForLinking(type: web3n.files.FSType, location?: string): IStorage {
		if (type === 'synced') {
			return wrapStorageImplementation(this);
		} else if (type === 'share') {
			return this.getStorages('share', location);
		} else {
			throw new Error(`Getting ${type} storage is not implemented in local storage.`);
		}
	}

	async getObjSyncInfo(objId: ObjId): Promise<Stats['sync']> {
		const obj = await this.files.findObj(objId);
		if (!obj) { return; }
		return obj.sync().stat();
	}
	
	getRootKeyDerivParamsFromServer(): Promise<ScryptGenParams> {
		return this.remoteStorage.getKeyDerivParams();
	}
	
	async generateNewObjId(): Promise<string> {
		const nonce = await randomBytes(NONCE_LENGTH);
		const id = base64urlSafe.pack(nonce);
		if (this.nodes.reserveId(id)) {
			return id;
		} else {
			return this.generateNewObjId();
		}
	}

	private async objFromDiskOrDownload(objId: ObjId): Promise<SyncedObj> {
		const obj = await this.files.findObj(objId);
		if (obj) { return obj; }
		return await this.files.makeByDownloadingCurrentVersion(objId);
	}

	private async getObjNonArchOrThrow(objId: ObjId): Promise<SyncedObj> {
		const obj = await this.objFromDiskOrDownload(objId);
		if (obj.isArchived()) { throw makeObjNotFoundExc(objId); }
		return obj;
	}

	async getObj(objId: ObjId): Promise<ObjSource> {
		const obj = await this.getObjNonArchOrThrow(objId);
		const currentVer = obj.getCurrentVersionOrThrow();
		return obj.getObjSrc(currentVer);
	}

	async getRemoteConflictObjVersion(
		objId: ObjId, version: number
	): Promise<ObjSource> {
		const obj = await this.getObjNonArchOrThrow(objId);
		return obj.getRemoteConflictObjVersion(version);
	}

	async saveObj(
		objId: ObjId, version: number, encSub: Subscribe
	): Promise<void> {
		if (version === 1) {
			const obj = await this.files.findObj(objId);
			if (obj) { throw makeObjExistsExc(objId); }
			const { fileWrite$, newObj } = await this.files.saveFirstVersion(
				objId, encSub);
			await fileWrite$
			.pipe(
				this.uploader.tapFileWrite(newObj, true, version)
			)
			.toPromise();
		} else {
			const obj = await this.files.findObj(objId);
			if (!obj) { throw makeObjNotFoundExc(objId); }
			const { fileWrite$, baseVer } = await obj.saveNewVersion(
				version, encSub);
			await fileWrite$
			.pipe(
				this.uploader.tapFileWrite(obj, false, version, baseVer)
			)
			.toPromise();
		}
	}

	async removeObj(objId: string): Promise<void> {
		const obj = await this.files.findObj(objId);
		if (!obj) { return; }
		await obj.removeCurrentVersion();
		await this.uploader.removeCurrentVersionOf(obj);
	}

	async close(): Promise<void> {
		try {
			await this.uploader.stop();
			this.events.done();
			await this.remoteEvents.close();
			await this.remoteStorage.logout();
		} catch (err) {
			await this.logError(err);
		}
	}

}
Object.freeze(SyncedStore.prototype);
Object.freeze(SyncedStore);


Object.freeze(exports);