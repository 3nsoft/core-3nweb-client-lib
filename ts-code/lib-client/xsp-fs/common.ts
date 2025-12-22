/*
 Copyright (C) 2015 - 2017, 2019 - 2020, 2022, 2025 3NSoft Inc.
 
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

import type { ScryptGenParams } from '../key-derivation';
import type { AsyncSBoxCryptor, Subscribe, ObjSource } from 'xsp-files';
import type { Observable } from 'rxjs';
import type { LogError } from '../logging/log-to-file';

export type { AsyncSBoxCryptor } from 'xsp-files';
export type { FolderInJSON } from './folder-node'; 

type StorageType = web3n.files.FSType;
type FolderEvent = web3n.files.FolderEvent;
type FileEvent = web3n.files.FileEvent;
type RemoteEvent = web3n.files.RemoteEvent;
type SyncStatus = web3n.files.SyncStatus;
type OptionsToAdopteRemote = web3n.files.OptionsToAdopteRemote;
type FSSyncException = web3n.files.FSSyncException;
type FileException = web3n.files.FileException;
type UploadEvent = web3n.files.UploadEvent;
type DownloadEvent = web3n.files.DownloadEvent;

export type FSChangeSrc = web3n.files.FSChangeEvent['src'];

export interface Node {
	objId: string;
	name: string;
	type: NodeType;
}

export type NodeType = 'file' | 'link' | 'folder';

export type ObjId = string|null;

export class NodesContainer {

	private nodes = new Map<ObjId, Node|null>();
	private promises = new Map<string, Promise<Node>>();

	constructor() {
		Object.seal(this);
	}

	get<T extends Node>(objId: ObjId): T|undefined {
		const node = this.nodes.get(objId);
		if (!node) { return; }
		return node as T;
	}

	set(node: Node): void {
		const existing = this.nodes.get(node.objId);
		if (existing && (existing !== node)) {
			throw new Error(`Cannot add second node for the same id ${node.objId}`);
		}
		this.nodes.set(node.objId, node);
	}

	getNodeOrPromise<T extends Node>(
		objId: string
	): { node?: T, nodePromise?: Promise<T> } {
		const node = this.nodes.get(objId);
		if (node) { return { node: node as T }; }
		return { nodePromise: this.promises.get(objId) as Promise<T> };
	}

	setPromise<T extends Node>(objId: string, promise: Promise<T>): Promise<T> {
		if (this.nodes.get(objId)) { throw new Error(
			`Cannot set promise for an already set node, id ${objId}.`); }
		const envelopedPromise = (async () => {
			try {
				const node = await promise;
				this.set(node);
				return node;
			} finally {
				this.promises.delete(objId);
			}
		})();
		this.promises.set(objId, envelopedPromise);
		envelopedPromise.catch(noop);
		return envelopedPromise;
	}

	delete(node: Node): boolean {
		const existing = this.get(node.objId);
		if (existing !== node) { return false; }
		this.nodes.delete(node.objId);
		return true;
	}

	reserveId(objId: string): boolean {
		if (this.nodes.has(objId)) { return false; }
		this.nodes.set(objId, null);
		return true;
	}

	clear(): void {
		this.nodes.clear();
		this.nodes = (undefined as any);
	}

}

function noop() {}

export interface NodeEvent {
	objId: ObjId;
	parentObjId?: ObjId;
	childObjId?: ObjId;
	event: FolderEvent|FileEvent|RemoteEvent|UploadEvent|DownloadEvent;
}

export interface Storage {

	readonly type: StorageType;
	readonly versioned: boolean;

	readonly cryptor: AsyncSBoxCryptor;

	readonly nodes: NodesContainer;

	readonly logError: LogError;

	getNodeEvents(): Observable<NodeEvent>;

	broadcastNodeEvent(
		objId: ObjId, parentObjId: ObjId|undefined, childObjId: ObjId|undefined,
		ev: NodeEvent['event']
	): void;

	/**
	 * This returns a storage of another type, for use by link functionality.
	 * @param type is a type of a requested storage.
	 * @param location is an additional location parameter for storages that
	 * require further localization, like shared storage.
	 */
	storageForLinking(type: StorageType, location?: string): Storage;
	
	/**
	 * This returns a new objId, reserving it in nodes container.
	 */
	generateNewObjId(): Promise<string>;

	/**
	 * This returns a promise, resolvable to source for a requested object.
	 */
	getObjSrc(
		objId: ObjId, version?: number, allowArchived?: boolean
	): Promise<ObjSource>;
	
	/**
	 * This saves given object, asynchronously.
	 * @param objId
	 * @param version
	 * @param sinkSub is a sink subscribe function
	 */
	saveObj(objId: ObjId, version: number, sinkSub: Subscribe): Promise<void>;

	/**
	 * This asynchronously removes an object. Note that it does not remove
	 * archived version, only current one.
	 * @param objId
	 */
	removeObj(objId: ObjId): Promise<void>;
	
	/**
	 * This asynchronously runs closing cleanup.
	 */
	close(): Promise<void>;

	status(objId: ObjId): Promise<LocalObjStatus>;

}

export interface LocalObjStatus {

	archiveCurrentVersion(): Promise<void>;

	listVersions(): { current?: number; archived?: number[]; };

}

export function wrapStorageImplementation(impl: Storage): Storage {
	const wrap: Storage = {
		type: impl.type,
		versioned: impl.versioned,
		nodes: impl.nodes,
		logError: impl.logError,
		getNodeEvents: impl.getNodeEvents.bind(impl),
		broadcastNodeEvent: impl.broadcastNodeEvent.bind(impl),
		storageForLinking: impl.storageForLinking.bind(impl),
		generateNewObjId: impl.generateNewObjId.bind(impl),
		getObjSrc: impl.getObjSrc.bind(impl),
		saveObj: impl.saveObj.bind(impl),
		close: impl.close.bind(impl),
		removeObj: impl.removeObj.bind(impl),
		status: impl.status.bind(impl),
		cryptor: impl.cryptor
	};
	return Object.freeze(wrap);
}

export type StorageGetter = (type: StorageType, location?: string) => Storage;

export type DownloadEventSink = (event: DownloadEvent) => void;

export type UploadEventSink = (event: UploadEvent) => void;

export interface SyncedStorage extends Storage {

	getObjSrcOfRemoteVersion(objId: ObjId, version: number): Promise<ObjSource>;

	archiveVersionOnServer(objId: ObjId, version: number): Promise<void>;

	/**
	 * This returns a promise, resolvable to root key generation parameters.
	 */
	getRootKeyDerivParamsFromServer(): Promise<ScryptGenParams>;

	adoptRemote(
		objId: ObjId, opts: OptionsToAdopteRemote|undefined
	): Promise<number|undefined>;

	updateStatusInfo(objId: ObjId): Promise<SyncStatus>;

	isRemoteVersionOnDisk(
		objId: ObjId, version: number
	): Promise<'partial'|'complete'|'none'>;

	startDownload(
		objId: ObjId, version: number, eventSink: DownloadEventSink
	): Promise<{ downloadTaskId: number; }|undefined>;

	startUpload(
		objId: ObjId, localVersion: number, uploadVersion: number,
		uploadHeader: UploadHeaderChange|undefined, createOnRemote: boolean,
		eventSink: UploadEventSink|undefined
	): Promise<{ uploadTaskId: number; completion: Promise<void>; }>;

	dropCachedLocalObjVersionsLessOrEqual(
		objId: ObjId, localVersion: number
	): void;

	uploadObjRemoval(objId: ObjId): Promise<void>;

	status(objId: ObjId): Promise<SyncedObjStatus>;

	getNumOfBytesNeedingDownload(objId: ObjId, version: number): Promise<number|'unknown'>;

	suspendNetworkActivity(): void;

	resumeNetworkActivity(): void;

}

export interface SyncedObjStatus extends LocalObjStatus {

	syncStatus(): SyncStatus;

	neverUploaded(): boolean;

	versionBeforeUnsyncedRemoval(): number|undefined;

}

export interface UploadHeaderChange {
	localVersion: number;
	uploadVersion: number;
	localHeader: Uint8Array;
	uploadHeader: Uint8Array;
}

export function wrapSyncStorageImplementation(impl: SyncedStorage): SyncedStorage {
	const storageWrap = wrapStorageImplementation(impl);
	const wrap: SyncedStorage = {} as any;
	for (const [field, value] of Object.entries(storageWrap)) {
		wrap[field] = value;
	}
	wrap.getRootKeyDerivParamsFromServer = impl.getRootKeyDerivParamsFromServer.bind(impl);
	wrap.getObjSrcOfRemoteVersion = impl.getObjSrcOfRemoteVersion.bind(impl);
	wrap.archiveVersionOnServer = impl.archiveVersionOnServer.bind(impl);
	wrap.isRemoteVersionOnDisk = impl.isRemoteVersionOnDisk.bind(impl);
	wrap.startDownload = impl.startDownload.bind(impl);
	wrap.startUpload = impl.startUpload.bind(impl);
	wrap.uploadObjRemoval = impl.uploadObjRemoval.bind(impl);
	wrap.dropCachedLocalObjVersionsLessOrEqual = impl.dropCachedLocalObjVersionsLessOrEqual.bind(impl);
	wrap.adoptRemote = impl.adoptRemote.bind(impl);
	wrap.updateStatusInfo = impl.updateStatusInfo.bind(impl);
	wrap.suspendNetworkActivity = impl.suspendNetworkActivity.bind(impl);
	wrap.resumeNetworkActivity = impl.resumeNetworkActivity.bind(impl);
	wrap.getNumOfBytesNeedingDownload = impl.getNumOfBytesNeedingDownload.bind(impl);
	return Object.freeze(wrap);
}

export function isSyncedStorage(storage: Storage) {
	return !!(storage as SyncedStorage).startUpload;
}


export function setPathInExc(
	exc: FSSyncException|FileException, path: string
): FSSyncException|FileException {
	if ((exc.type === 'fs-sync') || (exc.type === 'file')) {
		exc.path = path;
	}
	return exc;
}


Object.freeze(exports);