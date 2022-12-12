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

/**
 * Everything in this module is assumed to be inside of a file system
 * reliance set.
 */

import { SingleProc } from '../../../lib-common/processes/synced';
import { FSChangeSrc, isSyncedStorage, Node, NodeType, setPathInExc, Storage, SyncedStorage, UploadHeaderChange } from './common';
import { makeFileException } from '../../../lib-common/exceptions/file';
import { errWithCause } from '../../../lib-common/exceptions/error';
import { makeFSSyncException, StorageException } from '../exceptions';
import { Observable, Subject, Subscription } from 'rxjs';
import { filter, map, share } from 'rxjs/operators';
import { CommonAttrs, XAttrs } from './attrs';
import { NodePersistance } from './node-persistence';
import { FolderNode } from './folder-node';
import { ObjSource } from 'xsp-files';
import { assert } from '../../../lib-common/assert';


export type FSEvent = web3n.files.FolderEvent | web3n.files.FileEvent;
type RemoteEvent = web3n.files.RemoteEvent;
type RemovedEvent = web3n.files.RemovedEvent;
type FileChangeEvent = web3n.files.FileChangeEvent;
type XAttrsChanges = web3n.files.XAttrsChanges;
type RuntimeException = web3n.RuntimeException;
type SyncStatus = web3n.files.SyncStatus;
type FSSyncException = web3n.files.FSSyncException;
type FileException = web3n.files.FileException;
type OptionsToAdopteRemote = web3n.files.OptionsToAdopteRemote;
type OptionsToUploadLocal = web3n.files.OptionsToUploadLocal;
type VersionedReadFlags = web3n.files.VersionedReadFlags;


export abstract class NodeInFS<P extends NodePersistance> implements Node {

	protected crypto: P = (undefined as any);

	protected attrs: CommonAttrs = (undefined as any);
	protected xattrs: XAttrs|undefined = undefined;
	
	private writeProc: SingleProc|undefined = undefined;

	get version(): number {
		return this.currentVersion;
	}
	protected setCurrentVersion(newVersion: number) {
		if (!Number.isInteger(newVersion)) { throw new TypeError(
			`Version parameter must be an integer, but ${newVersion} is given`); }
		this.currentVersion = newVersion;
	}

	readonly isInSyncedStorage: boolean;

	protected constructor(
		protected readonly storage: Storage,
		public readonly type: NodeType,
		public name: string,
		public readonly objId: string,
		private currentVersion: number,
		public parentId: string | undefined
	) {
		this.isInSyncedStorage = isSyncedStorage(this.storage);
	}

	protected getObjSrcOfVersion(
		flags: VersionedReadFlags|undefined
	): Promise<ObjSource> {
		if (flags) {
			const { remoteVersion, archivedVersion } = flags;
			if (remoteVersion) {
				const store = this.syncedStorage();
				return store.getObjSrcOfRemoteVersion(this.objId, remoteVersion);
			} else if (archivedVersion) {
				return this.storage.getObjSrc(this.objId, archivedVersion, true);
			}
		}
		return this.storage.getObjSrc(this.objId);
	}

	private updatedXAttrs(changes: XAttrsChanges|undefined): XAttrs|undefined {
		return (this.xattrs ?
			(changes ? this.xattrs.makeUpdated(changes) : this.xattrs) :
			(changes ? XAttrs.makeEmpty().makeUpdated(changes) : undefined));
	}

	protected setUpdatedParams(
		version: number, attrs: CommonAttrs|undefined, xattrs: XAttrs|undefined
	): void {
		if (attrs) {
			this.attrs = attrs;
		}
		this.xattrs = xattrs;
		this.setCurrentVersion(version);
	}

	protected getParamsForUpdate(changes: XAttrsChanges|undefined): {
		newVersion: number; attrs: CommonAttrs; xattrs?: XAttrs;
	} {
		return {
			newVersion: this.version + 1,
			attrs: this.attrs.copy(),
			xattrs: this.updatedXAttrs(changes)
		};
	}

	async updateXAttrs(changes: XAttrsChanges): Promise<number> {
		if (Object.keys(changes).length === 0) { return this.version; }
		return this.doChange(true, async () => {
			const { xattrs, newVersion } = this.getParamsForUpdate(changes);
			const base = await this.storage.getObjSrc(this.objId);
			const sub = await this.crypto.writeXAttrs(xattrs!, newVersion, base);
			await this.storage.saveObj(this.objId, newVersion, sub);
			this.setUpdatedParams(newVersion, undefined, xattrs);
			return this.version;
		});
	}

	async getXAttr(
		xaName: string, flags: VersionedReadFlags|undefined
	): Promise<{ attr: any; version: number; }> {
		if (shouldReadCurrentVersion(flags)) {
			return {
				attr: (this.xattrs ? this.xattrs.get(xaName) : undefined),
				version: this.version
			};
		} else {
			const src = await this.getObjSrcOfVersion(flags);
			const payload = await this.crypto.readonlyPayload(src);
			const xattrs = await payload.getXAttrs();
			return {
				attr: xattrs.get(xaName),
				version: src.version
			};
		}
	}

	async listXAttrs(
		flags: VersionedReadFlags|undefined
	):Promise<{ lst: string[]; version: number; }> {
		if (shouldReadCurrentVersion(flags)) {
			return {
				lst: (this.xattrs ? this.xattrs.list() : []),
				version: this.version
			};
		} else {
			const src = await this.getObjSrcOfVersion(flags);
			const payload = await this.crypto.readonlyPayload(src);
			const xattrs = await payload.getXAttrs();
			return {
				lst: xattrs.list(),
				version: src.version
			};
		}
	}

	getAttrs(): CommonAttrs {
		return this.attrs;
	}

	async listVersions(): Promise<{ current?: number; archived?: number[]; }> {
		return (await this.storage.status(this.objId)).listVersions();
	}

	async archiveCurrent(version?: number): Promise<number> {
		if (this.isInSyncedStorage) {
			const storage = this.syncedStorage();
			const status = await storage.status(this.objId);
			const { state, synced } = status.syncStatus();
			if (state !== 'synced') {
				throw makeFSSyncException(this.name, { notSynced: true });
			}
			if (version) {
				if (synced!.latest !== version) {
					throw makeFSSyncException(this.name, { versionMismatch: true });
				}	
			} else {
				version = synced!.latest!;
			}
			await storage.archiveVersionOnServer(this.objId, version);
			await status.archiveCurrentVersion();
			return version;
		} else {
			if (version) {
				if (this.currentVersion !== version) {
					throw makeFileException('versionMismatch', this.name);
				}
			} else {
				version = this.currentVersion;
			}
			const status = await this.storage.status(this.objId);
			await status.archiveCurrentVersion();
			return version;
		}
	}

	removeNonFolderObj(src: FSChangeSrc): Promise<void> {
		assert(this.type !== 'folder');
		return this.doChange(true, () => this.removeThisFromStorageNodes(src));
	}

	protected async removeThisFromStorageNodes(src: FSChangeSrc): Promise<void> {
		if (this.currentVersion < 0) { return; }
		await this.storage.removeObj(this.objId);
		this.storage.nodes.delete(this);
		this.currentVersion = -1;
		const event: RemovedEvent = {
			type: 'removed',
			path: this.name,
			src
		};
		this.broadcastEvent(event, true);
	}

	/**
	 * This method runs node changing function in an exclusive manner.
	 * Returned promise resolves to whatever change function returns.
	 * This way of setting up an exclusive transaction is an alternative to using
	 * startTransition() method. Use one or the other depending on convenience.
	 * @param awaitPrevChange is a flag, which true value awaits previous
	 * ongoing change, while false value throws up, refusing to perform
	 * concurrent action (without waiting).
	 * @param change is a function that does an appropriate transition from one
	 * version to another, performing respective storage operations, and setting
	 * new current version, when change has been successful.
	 */
	protected async doChange<T>(
		awaitPrevChange: boolean, change: () => Promise<T>
	): Promise<T> {
		if (!this.writeProc) {
			this.writeProc = new SingleProc();
		}
		if (!awaitPrevChange && this.writeProc.isProcessing()) {
			throw makeFileException(
				'concurrentUpdate', this.name+` type ${this.type}`);
		}
		const res = await this.writeProc.startOrChain(async () => {
			if (this.currentVersion < 0) {
				throw makeFileException(
					'notFound', this.name, `Object is marked removed`);
			}
			try {
				const res = await change();
				return res;
			} catch (exc) {
				if (!(exc as RuntimeException).runtimeException) {
					throw errWithCause(exc, `Cannot save changes to ${this.type} ${this.name}, version ${this.version}`);
				}
				if ((exc as StorageException).type === 'storage') {
					if ((exc as StorageException).concurrentTransaction) {
						throw makeFileException('concurrentUpdate', this.name, exc);
					} else if ((exc as StorageException).objNotFound) {
						throw makeFileException('notFound', this.name, exc);
					}
				} else if (((exc as FileException).type === 'file')
				|| ((exc as FSSyncException).type === 'fs-sync')) {
					throw exc;
				}
				throw makeFileException('ioError', this.name, exc);		
			}
		});
		return res;
	}

	protected broadcastEvent(
		event: FSEvent, complete?: boolean, childObjId?: string
	): void {
		if (this.events && complete) {
			this.events.sink.next(event);
			this.events.sink.complete();
			this.events = undefined;
		}
		this.storage.broadcastNodeEvent(
			this.objId, this.parentId, childObjId, event
		);
	}

	/**
	 * This is a lazily initialized field, when there is an external entity
	 * that wants to see this node's events.
	 */
	private events: {
		sink: Subject<FSEvent|RemoteEvent>;
		out: Observable<FSEvent|RemoteEvent>;
		storeSub: Subscription;
	}|undefined = undefined;

	get event$(): Observable<FSEvent|RemoteEvent> {
		if (!this.events) {
			const sink = new Subject<FSEvent|RemoteEvent>();
			const out = sink.asObservable().pipe(share());
			const storeSub = this.storage.getNodeEvents()
			.pipe(
				filter(({ objId }) => (this.objId === objId)),
				map(({ event }) => copyWithPathIfRemoteEvent(event, this.name))
			)
			.subscribe({
				next: event => sink.next(event),
				complete: () => {
					sink.complete();
					if (this.events?.sink === sink) {
						this.events = undefined;
					}
				},
				error: err => {
					sink.error(err);
					if (this.events?.sink === sink) {
						this.events = undefined;
					}
				}
			});
			this.events = { sink, out, storeSub };
		}
		return this.events.out;
	}

	protected syncedStorage(): SyncedStorage {
		if (!this.isInSyncedStorage) { throw new Error(`Storage is not synced`); }
		return this.storage as SyncedStorage;
	}

	async syncStatus(): Promise<SyncStatus> {
		const storage = this.syncedStorage();
		const status = (await storage.status(this.objId)).syncStatus();
		if (this.parentId) {
			const parent = storage.nodes.get<FolderNode>(this.parentId);
			if (parent) {
				status.existsInSyncedParent =
					await parent.childExistsInSyncedVersion(this.objId);
			}
		}
		return status;
	}

	async updateStatusInfo(): Promise<SyncStatus> {
		const storage = this.syncedStorage();
		const status = await storage.updateStatusInfo(this.objId);
		return status;
	}

	isSyncedVersionOnDisk(
		version: number
	): Promise<'partial'|'complete'|'none'> {
		const storage = this.syncedStorage();
		return storage.isRemoteVersionOnDisk(this.objId, version);
	}

	 async download(version: number): Promise<void> {
		const storage = this.syncedStorage();
		return storage.download(this.objId, version);
	}

	protected abstract setCurrentStateFrom(src: ObjSource): Promise<void>;

	adoptRemote(opts: OptionsToAdopteRemote|undefined): Promise<void> {
		return this.doChange(true, async () => {
			const storage = this.syncedStorage();
			try {
				const adopted = await storage.adoptRemote(this.objId, opts);
				if (!adopted) { return; }
				const src = await this.storage.getObjSrc(this.objId, adopted);
				await this.setCurrentStateFrom(src);
				const event: FileChangeEvent = {
					type: 'file-change',
					src: 'sync',
					path: this.name,
					newVersion: this.version
				};
				this.broadcastEvent(event);
			} catch (exc) {
				throw setPathInExc(exc, this.name);
			}
		});
	}

	protected async needUpload(localVersion: number|undefined): Promise<{
		localVersion: number; uploadVersion: number; createOnRemote: boolean;
	}|undefined> {
		const { local, remote, synced } = await this.syncStatus();
		if (localVersion) {
			if (localVersion !== this.currentVersion) {
				throw makeFSSyncException(this.name, {
					versionMismatch: true,
					localVersion: this.currentVersion,
					message: `Given local version ${localVersion} is not equal to current version ${this.currentVersion}`
				});
			}
			if (!local || (local.latest !== localVersion)) {
				throw makeFSSyncException(this.name, {
					versionMismatch: true,
					message: `No local version ${localVersion} to upload`
				});
			}
		} else {
			if (!local || !this.currentVersion) { return; }
			localVersion = this.currentVersion;
		}
		if (remote) {
			if (remote.latest) {
				const uploadVersion = remote.latest+1;
				return { createOnRemote: false, localVersion, uploadVersion };
			} else {
				throw makeFSSyncException(this.name, {
					versionMismatch: true,
					removedOnServer: true
				});
			}
		} else if (synced) {
			if (synced.latest) {
				const uploadVersion = synced.latest+1;
				return { createOnRemote: false, localVersion, uploadVersion };
			} else {
				throw makeFSSyncException(this.name, {
					versionMismatch: true,
					removedOnServer: true
				});
			}
		} else {
			const uploadVersion = 1;
			return { createOnRemote: true, localVersion, uploadVersion };
		}
	}

	async upload(
		opts: OptionsToUploadLocal|undefined
	): Promise<number|undefined> {
		try {
			const toUpload = await this.needUpload(opts?.localVersion);
			if (!toUpload) { return; }
			const { localVersion, createOnRemote, uploadVersion } = toUpload;
			const uploadHeader = await this.uploadHeaderChange(
				localVersion, uploadVersion);
			const storage = this.syncedStorage();
			await storage.upload(
				this.objId, localVersion, uploadVersion, uploadHeader,
				createOnRemote
			);
			return await this.doChange(true, async () => {
				storage.dropCachedLocalObjVersionsLessOrEqual(
					this.objId, localVersion
				);
				if (this.currentVersion === localVersion) {
					this.currentVersion = uploadVersion;
				}
				return uploadVersion;
			});
		} catch (exc) {
			throw setPathInExc(exc, this.name);
		}
	}

	protected async uploadHeaderChange(
		localVersion: number, uploadVersion: number
	): Promise<UploadHeaderChange|undefined> {
		if (localVersion === uploadVersion) { return; }
		const currentSrc = await this.storage.getObjSrc(
			this.objId, localVersion);
		const localHeader = await currentSrc.readHeader();
		const uploadHeader = await this.crypto.reencryptHeader(
			localHeader, uploadVersion);
		return { localHeader, localVersion, uploadHeader, uploadVersion };
	}

}
Object.freeze(NodeInFS.prototype);
Object.freeze(NodeInFS);


function copyWithPathIfRemoteEvent(
	e: RemoteEvent|FSEvent, path: string
): RemoteEvent {
	switch (e.type) {
		case 'remote-change':
			return { type: e.type, path, newVersion: e.newVersion };
		case 'remote-removal':
			return { type: e.type, path };
		case 'remote-version-archival':
			return { type: e.type, path, archivedVersion: e.archivedVersion };
		case 'remote-arch-ver-removal':
			return { type: e.type, path, removedArchVer: e.removedArchVer };
		default:
			return e as any;
	}
}

export function shouldReadCurrentVersion(
	flags: VersionedReadFlags|undefined
): boolean {
	if (flags) {
		const { archivedVersion, remoteVersion } = flags;
		if (archivedVersion || remoteVersion) {
			return false;
		}
	}
	return true;
}


Object.freeze(exports);