/*
 Copyright (C) 2015 - 2017, 2019 - 2020, 2022 3NSoft Inc.
 
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

import { ScryptGenParams } from '../../key-derivation';
import { AsyncSBoxCryptor, Subscribe, ObjSource } from 'xsp-files';
import { objChanged, objRemoved } from '../../../lib-common/service-api/3nstorage/owner';

export { AsyncSBoxCryptor } from 'xsp-files';
export { FolderInJSON } from './folder-node'; 

type StorageType = web3n.files.FSType;

export interface RemoteObjRemovalEvent extends objRemoved.Event {
	type: 'remote-delete'
}

export interface RemoteObjChangeEvent extends objChanged.Event {
	type: 'remote-change'
}

export type RemoteEvent = RemoteObjRemovalEvent | RemoteObjChangeEvent;

export interface Node {
	objId: string;
	name: string;
	type: NodeType;
	processRemoteEvent: (event: RemoteEvent) => Promise<void>;
	localDelete(): Promise<void>;
}

export type NodeType = 'file' | 'link' | 'folder';

export type ObjId = string|null;

/**
 * This is a container for file system nodes.
 * 
 * Current implementation performs two functions: container for nodes, and a
 * provider of node type, corresponding to given object.
 * The later function, used by synced storage for conflict resolution, takes
 * advantage of container not forgeting nodes, like cache may do.
 * So, at least for local storage's sake, this container may be refactored to
 * act more like cache, and even then we shouldn't forget about cascading keys
 * and a need to keep parent nodes in memory, while child nodes are in
 * use/cache.
 */
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
		if (existing) { throw new Error(`Cannot add second node for the same id ${node.objId}`); }
		this.nodes.set(node.objId, node);
	}

	getNodeOrPromise<T extends Node>(objId: string):
			{ node?: T, nodePromise?: Promise<T> } {
		const node = this.nodes.get(objId);
		if (node) { return { node: node as T }; }
		return { nodePromise: this.promises.get(objId) as Promise<T> };
	}

	setPromise(objId: string, promise: Promise<Node>): void {
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

export interface Storage {
	
	readonly type: StorageType;

	readonly versioned: boolean;
	
	readonly cryptor: AsyncSBoxCryptor;

	readonly nodes: NodesContainer;

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
	 * @param objId
	 */
	getObj(objId: string): Promise<ObjSource>;
	
	/**
	 * This saves given object, asynchronously.
	 * @param objId
	 * @param version
	 * @param sinkSub is a sink subscribe function
	 */
	saveObj(objId: string, version: number, sinkSub: Subscribe): Promise<void>;

	/**
	 * This asynchronously removes an object. Note that it does not remove
	 * archived version, only current one.
	 * @param objId
	 */
	removeObj(objId: string): Promise<void>;
	
	/**
	 * This asynchronously runs closing cleanup.
	 */
	close(): Promise<void>;

}

export function wrapStorageImplementation(impl: Storage): Storage {
	const wrap: Storage = {
		type: impl.type,
		versioned: impl.versioned,
		nodes: impl.nodes,
		storageForLinking: impl.storageForLinking.bind(impl),
		generateNewObjId: impl.generateNewObjId.bind(impl),
		getObj: impl.getObj.bind(impl),
		saveObj: impl.saveObj.bind(impl),
		close: impl.close.bind(impl),
		removeObj: impl.removeObj.bind(impl),
		cryptor: impl.cryptor
	};
	return Object.freeze(wrap);
}

export type StorageGetter = (type: StorageType, location?: string) => Storage;

export interface SyncedStorage extends Storage {

	/**
	 * This returns a promise, resolvable to root key generation parameters.
	 */
	getRootKeyDerivParamsFromServer(): Promise<ScryptGenParams>;

	getRemoteConflictObjVersion(objId: string, version: number):
		Promise<ObjSource>;
}

export function wrapSyncStorageImplementation(impl: SyncedStorage):
		SyncedStorage {
	const storageWrap = wrapStorageImplementation(impl);
	const wrap: SyncedStorage = {
		type: storageWrap.type,
		versioned: storageWrap.versioned,
		close: storageWrap.close,
		cryptor: storageWrap.cryptor,
		generateNewObjId: storageWrap.generateNewObjId,
		getObj: storageWrap.getObj,
		nodes: storageWrap.nodes,
		removeObj: storageWrap.removeObj,
		saveObj: storageWrap.saveObj,
		storageForLinking: storageWrap.storageForLinking,
		getRootKeyDerivParamsFromServer:
			impl.getRootKeyDerivParamsFromServer.bind(impl),
		getRemoteConflictObjVersion: impl.getRemoteConflictObjVersion.bind(impl)
	};
	return Object.freeze(wrap);
}

Object.freeze(exports);