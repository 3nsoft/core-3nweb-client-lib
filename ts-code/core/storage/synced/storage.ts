/*
 Copyright (C) 2015 - 2020, 2022, 2025 3NSoft Inc.
 
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
import { SyncedStorage as ISyncedStorage, wrapSyncStorageImplementation,  NodesContainer, wrapStorageImplementation, Storage as IStorage, StorageGetter, ObjId, NodeEvent, SyncedObjStatus } from '../../../lib-client/xsp-fs/common';
import { makeObjNotFoundExc, makeObjExistsExc, StorageException } from '../../../lib-client/xsp-fs/exceptions';
import { StorageOwner as RemoteStorage } from '../../../lib-client/3nstorage/storage-owner';
import { ScryptGenParams } from '../../../lib-client/key-derivation';
import { ObjFiles, SyncedObj } from './obj-files';
import { bytes as randomBytes } from '../../../lib-common/random-node';
import { base64urlSafe } from '../../../lib-common/buffer-utils';
import { LogError } from '../../../lib-client/logging/log-to-file';
import { AsyncSBoxCryptor, NONCE_LENGTH, Subscribe, ObjSource } from 'xsp-files';
import { RemoteEvents } from './remote-events';
import { UpSyncer } from './upsyncer';
import { NetClient } from '../../../lib-client/request-utils';
import { lastValueFrom, Observable } from 'rxjs';
import { Broadcast } from '../../../lib-common/utils-for-observables';
import { UploadHeaderChange } from '../../../lib-client/xsp-fs/common';

type FolderEvent = web3n.files.FolderEvent;
type FileEvent = web3n.files.FileEvent;
type SyncStatus = web3n.files.SyncStatus;
type OptionsToAdopteRemote = web3n.files.OptionsToAdopteRemote;


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
		public readonly logError: LogError
	) {
		this.remoteEvents = new RemoteEvents(
			this.remoteStorage, this.files,
			this.broadcastNodeEvent.bind(this), this.logError
		);
		this.uploader = new UpSyncer(this.remoteStorage, this.logError);
		Object.seal(this);
	}

	static async makeAndStart(
		path: string, user: string, getSigner: IGetMailerIdSigner,
		getStorages: StorageGetter, cryptor: AsyncSBoxCryptor,
		remoteServiceUrl: () => Promise<string>,
		net: NetClient, logError: LogError
	): Promise<{ syncedStore: ISyncedStorage; startObjProcs: () => void; }> {
		const remote = RemoteStorage.make(user, getSigner, remoteServiceUrl, net);
		const objFiles = await ObjFiles.makeFor(path, remote, logError);
		const s = new SyncedStore(
			objFiles, remote, getStorages, cryptor, logError
		);
		s.uploader.start();
		return {
			syncedStore: wrapSyncStorageImplementation(s),
			startObjProcs: () => {
				s.remoteEvents.startListening();
			}
		};
	}

	static async makeAndStartWithoutRemote(
		path: string, user: string,
		getStorages: StorageGetter, cryptor: AsyncSBoxCryptor,
		remoteServiceUrl: () => Promise<string>,
		net: NetClient, logError: LogError
	): Promise<{
		syncedStore: ISyncedStorage;
		setupRemoteAndStartObjProcs: (getSigner: IGetMailerIdSigner) => void;
	}> {
		const {
			remote, setMid
		} = RemoteStorage.makeBeforeMidSetup(user, remoteServiceUrl, net);
		const objFiles = await ObjFiles.makeFor(path, remote, logError);
		const s = new SyncedStore(
			objFiles, remote, getStorages, cryptor, logError
		);
		return {
			syncedStore: wrapSyncStorageImplementation(s),
			setupRemoteAndStartObjProcs: getSigner => {
				setMid(getSigner);
				s.uploader.start();
				s.remoteEvents.startListening();
			}
		};
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

	storageForLinking(type: web3n.files.FSType, location?: string): IStorage {
		if (type === 'synced') {
			return wrapStorageImplementation(this);
		} else if (type === 'share') {
			return this.getStorages('share', location);
		} else {
			throw new Error(`Getting ${type} storage is not implemented in local storage.`);
		}
	}

	async status(objId: ObjId): Promise<SyncedObjStatus> {
		const obj = await this.getObjOrThrow(objId, true);
		return obj.syncStatus();
	}

	async adoptRemote(
		objId: ObjId, opts: OptionsToAdopteRemote|undefined
	): Promise<number|undefined> {
		const obj = await this.getObjOrThrow(objId);
		const objStatus = obj.statusObj();
		await objStatus.adoptRemoteVersion(opts?.remoteVersion);
		this.files.scheduleGC(obj);
		return objStatus.syncStatus().synced!.latest!;
	}

	async updateStatusInfo(objId: ObjId): Promise<SyncStatus> {
		const obj = await this.getObjOrThrow(objId, true);
		try {
			const statusOnServer = await this.remoteStorage.getObjStatus(objId);
			const objStatus = obj.statusObj();
			await objStatus.recordStatusFromServer(statusOnServer);
			return objStatus.syncStatus();
		} catch (exc) {
			if (((exc as StorageException).type === 'storage')
			&& (exc as StorageException).objNotFound) {
				const objStatus = obj.statusObj();
				await objStatus.recordStatusFromServer({});
				return objStatus.syncStatus();	
			}
			throw exc;
		}
	}

	async isObjOnDisk(objId: ObjId): Promise<boolean> {
		const obj = await this.files.findObj(objId);
		return !!obj;
	}

	async isRemoteVersionOnDisk(
		objId: ObjId, version: number
	): Promise<'complete'|'partial'|'none'> {
		const obj = await this.getObjOrThrow(objId, true);
		return obj.isRemoteVersionOnDisk(version);
	}

	async download(objId: ObjId, version: number): Promise<void> {
		const obj = await this.getObjOrThrow(objId, true);
		return obj.downloadRemoteVersion(version);
	}

	async upload(
		objId: ObjId, localVersion: number, uploadVersion: number,
		uploadHeader: UploadHeaderChange|undefined, createOnRemote: boolean
	): Promise<void> {
		const obj = await this.getObjOrThrow(objId, true);
		const syncedBase = await obj.combineLocalBaseIfPresent(localVersion);
		if (uploadHeader) {
			await obj.saveUploadHeaderFile(uploadHeader);
		}
		await this.uploader.uploadFromDisk(
			obj, localVersion, uploadVersion, uploadHeader?.uploadHeader,
			syncedBase, createOnRemote
		);
		await obj.recordUploadCompletion(
			localVersion, uploadVersion,
			(uploadHeader ? {
				newHeader: uploadHeader.uploadHeader,
				originalHeader: uploadHeader.localHeader
			} : undefined)
		);
		if (localVersion > uploadVersion) {
			await obj.removeLocalVersionFilesLessThan(localVersion);
		}
	}

	async uploadObjRemoval(objId: ObjId): Promise<void> {
		if (!objId) { return; }
		const obj = await this.getObjOrThrow(objId, true);
		const status = obj.statusObj();
		if (status.neverUploaded()) { return; }
		if (await status.clearPostponeFlagInRemovalOnRemote()) {
			await this.uploader.removeCurrentVersionOf(obj);
		}
	}

	dropCachedLocalObjVersionsLessOrEqual(objId: ObjId, version: number): void {
		const obj = this.files.getObjInCache(objId);
		if (!obj) { return; }
		obj.dropCachedLocalObjVersionsLessOrEqual(version);
	}

	async archiveVersionOnServer(objId: ObjId, version: number): Promise<void> {
		await this.remoteStorage.archiveObjVersion(objId, version);
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

		// XXX
		//  - can we create object by getting obj status

		return await this.files.makeByDownloadingCurrentVersion(objId);
	}

	private async getObjOrThrow(
		objId: ObjId, allowArchived = false
	): Promise<SyncedObj> {
		const obj = await this.objFromDiskOrDownload(objId);
		if (!allowArchived && obj.statusObj().isArchived()) {
			throw makeObjNotFoundExc(objId);
		} else {
			return obj;
		}
	}

	async getObjSrc(
		objId: ObjId, version?: number, allowArchived = false
	): Promise<ObjSource> {
		const obj = await this.getObjOrThrow(objId, allowArchived);
		if (!version) {
			version = obj.statusObj().getCurrentLocalOrSynced();
		}
		return obj.getObjSrcFromLocalAndSyncedBranch(version);
	}

	async getObjSrcOfRemoteVersion(
		objId: ObjId, version: number
	): Promise<ObjSource> {
		const obj = await this.getObjOrThrow(objId);
		return obj.getObjSrcFromRemoteAndSyncedBranch(version);
	}

	async saveObj(
		objId: ObjId, version: number, encSub: Subscribe
	): Promise<void> {
		if (version === 1) {
			const obj = await this.files.findObj(objId);
			if (obj) { throw makeObjExistsExc(objId); }
			const { fileWrite$ } = await this.files.saveFirstVersion(
				objId, encSub
			);
			await lastValueFrom(fileWrite$);
		} else {
			const obj = await this.getObjOrThrow(objId);
			const { fileWrite$ } = await obj.saveNewVersion(version, encSub);
			await lastValueFrom(fileWrite$);
		}
	}

	async removeObj(objId: string): Promise<void> {
		const obj = await this.getObjOrThrow(objId)
		.catch((exc: StorageException) => {
			if (!exc.objNotFound) { throw exc; }
		});
		if (!obj) { return; }
		await obj.removeCurrentVersion();
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

	suspendNetworkActivity(): void {
		this.remoteEvents.suspendNetworkActivity();
	}

	resumeNetworkActivity(): void {
		this.remoteEvents.resumeNetworkActivity();
	}

}
Object.freeze(SyncedStore.prototype);
Object.freeze(SyncedStore);


Object.freeze(exports);