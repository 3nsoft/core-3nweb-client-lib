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

import { base64 } from '../../lib-common/buffer-utils';
import { makeFileException, FileException } from '../../lib-common/exceptions/file';
import { errWithCause } from '../../lib-common/exceptions/error';
import { Storage, Node, NodeType, setPathInExc, FSChangeSrc, ObjId } from './common';
import { FSEvent, NodeInFS } from './node-in-fs';
import { FileNode } from './file-node';
import { LinkNode } from './link-node';
import { LinkParameters } from '../fs-utils/files';
import { makeFSSyncException, StorageException } from './exceptions';
import { defer } from '../../lib-common/processes/deferred';
import { copy, deepEqual } from '../../lib-common/json-utils';
import { AsyncSBoxCryptor, KEY_LENGTH, NONCE_LENGTH, calculateNonce, idToHeaderNonce, Subscribe, ObjSource } from 'xsp-files';
import * as random from '../../lib-common/random-node';
import { parseFolderInfo, serializeFolderInfo } from './folder-node-serialization';
import { CommonAttrs, XAttrs } from './attrs';
import { NodePersistance } from './node-persistence';
import { assert } from '../../lib-common/assert';
import { appendArray } from './util/for-arrays';

type ListingEntry = web3n.files.ListingEntry;
type EntryAdditionEvent = web3n.files.EntryAdditionEvent;
type EntryRemovalEvent = web3n.files.EntryRemovalEvent;
type EntryRenamingEvent = web3n.files.EntryRenamingEvent;
type XAttrsChanges = web3n.files.XAttrsChanges;
type FolderDiff = web3n.files.FolderDiff;
type OptionsToAdopteRemote = web3n.files.OptionsToAdopteRemote;
type OptionsToAdoptRemoteItem = web3n.files.OptionsToAdoptRemoteItem;
type OptionsToUploadLocal = web3n.files.OptionsToUploadLocal;
type VersionedReadFlags = web3n.files.VersionedReadFlags;

export interface NodeInfo {
	/**
	 * This is a usual file name.
	 */
	name: string;
	/**
	 * This is a key that en(de)crypts this node's object(s).
	 */
	key: Uint8Array;
	/**
	 * This is an id of file's object.
	 */
	objId: string;
	/**
	 * If this field is present and is true, it indicates that entity is a
	 * folder.
	 */
	isFolder?: boolean;
	/**
	 * If this field is present and is true, it indicates that entity is a
	 * file.
	 */
	isFile?: boolean;
	/**
	 * If this field is present and is true, it indicates that entity is a
	 * symbolic link.
	 */
	isLink?: boolean;
}

export interface FolderInfo {
	nodes: {
		[name: string]: NodeInfo;
	};
}

export interface FolderInJSON extends FolderInfo {
	ctime: number;
	xattrs?: any;
}

function jsonToInfoAndAttrs(
	json: FolderInJSON
): { folderInfo: FolderInfo; attrs: CommonAttrs; xattrs?: XAttrs; } {
	const folderInfo: FolderInfo = {
		nodes: copy(json.nodes)
	};
	for (const node of Object.values(folderInfo.nodes)) {
		node.key = base64.open(node.key as any);
	}
	checkFolderInfo(folderInfo);
	const attrs = new CommonAttrs(json.ctime, json.ctime);
	return { attrs, folderInfo };
}


class FolderPersistance extends NodePersistance {

	constructor(zNonce: Uint8Array, key: Uint8Array, cryptor: AsyncSBoxCryptor) {
		super(zNonce, key, cryptor);
		Object.seal(this);
	}

	async write(
		folderInfo: FolderInfo, version: number,
		attrs: CommonAttrs, xattrs: XAttrs|undefined
	): Promise<Subscribe> {
		const bytes = serializeFolderInfo(folderInfo);
		return this.writeWhole(bytes, version, attrs, xattrs);
	}

	async read(src: ObjSource): Promise<{
		folderInfo: FolderInfo; attrs: CommonAttrs; xattrs?: XAttrs;
	}> {
		const { content, xattrs, attrs } = await this.readAll(src);
		const folderInfo = parseFolderInfo(content);
		return { folderInfo, xattrs, attrs: CommonAttrs.fromAttrs(attrs) };
	}

	static async readFolderContent(
		objId: string|null, key: Uint8Array, src: ObjSource,
		cryptor: AsyncSBoxCryptor
	): Promise<FolderInfo> {
		if (objId === null) {
			throw new Error("Missing objId for non-root folder");
		}
		const zNonce = idToHeaderNonce(objId);
		const { folderInfo } = await (
			new FolderPersistance(zNonce, key, cryptor)
		).read(src);
		return folderInfo;
	}

}
Object.freeze(FolderPersistance.prototype);
Object.freeze(FolderPersistance);


let nextMoveLabel = Math.floor(Math.random()/2*Number.MAX_SAFE_INTEGER);
function getMoveLabel(): number {
	const label = nextMoveLabel;
	if (nextMoveLabel >= Number.MAX_SAFE_INTEGER) {
		nextMoveLabel = 0;
	} else {
		nextMoveLabel += 1;
	}
	return label;
}

export interface FolderLinkParams {
	folderName: string;
	objId: string;
	fKey: string;
}


export class FolderNode extends NodeInFS<FolderPersistance> {

	private currentState: FolderInfo = { nodes: {} };

	private constructor(
		storage: Storage, name: string|undefined,
		objId: string|null, zNonce: Uint8Array, version: number,
		parentId: string|undefined, key: Uint8Array, setNewAttrs: boolean
	) {
		super(storage, 'folder', name!, objId!, version, parentId);
		if (name === undefined) {
			assert(!objId && !parentId,
				`Root folder must have both objId and parent as nulls.`);
		} else if (objId === null) {
			throw new Error("Missing objId for non-root folder");
		}
		this.crypto = new FolderPersistance(zNonce, key, storage.cryptor);
		if (setNewAttrs) {
			this.attrs = CommonAttrs.makeForTimeNow();
		}
		Object.seal(this);
	}

	static async newRoot(
		storage: Storage, key: Uint8Array
	): Promise<FolderNode> {
		const zNonce = await random.bytes(NONCE_LENGTH);
		const rf = new FolderNode(
			storage, undefined, null, zNonce, 0, undefined, key, true);
		rf.storage.nodes.set(rf);
		await rf.saveFirstVersion(undefined);
		return rf;
	}

	static async rootFromObjBytes(
		storage: Storage, name: string|undefined,
		objId: string|null, src: ObjSource, key: Uint8Array
	): Promise<FolderNode> {
		const rf = await FolderNode.readNodeFromObjBytes(
			storage, name, objId, src, key
		);
		rf.storage.nodes.set(rf);
		return rf;
	}

	private static async readNodeFromObjBytes(
		storage: Storage, name: string|undefined, objId: string|null,
		src: ObjSource, key: Uint8Array
	): Promise<FolderNode> {
		let zNonce: Uint8Array;
		if (objId) {
			zNonce = idToHeaderNonce(objId);
		} else {
			const header = await src.readHeader();
			zNonce = calculateNonce(
				header.subarray(0, NONCE_LENGTH), -src.version);
		}
		const rf = new FolderNode(
			storage, name, objId, zNonce, src.version, undefined, key, false
		)
		await rf.setCurrentStateFrom(src);
		return rf;
	}

	static async rootFromLinkParams(
		storage: Storage, params: FolderLinkParams
	): Promise<FolderNode> {
		let {
			node: existingNode, nodePromise
		} = storage.nodes.getNodeOrPromise(params.objId);
		if (nodePromise) {
			try {
				existingNode = await nodePromise;
			} catch (err) {
				// ignore errors from other invokation
				return FolderNode.rootFromLinkParams(storage, params);
			}
		}
		if (existingNode) {
			if (existingNode.type !== 'folder') {
				throw new Error(`Existing object ${params.objId} type is ${existingNode.type}, while link parameters ask for folder.`);
			}
			// Note that, although we return existing folder node, we should check
			// if link parameters contained correct key. Only holder of a correct
			// key may use existing object.
			if (!(existingNode as FolderNode).crypto.compareKey(params.fKey)) {
				throw new Error(`Link parameters don't contain correct key to instantiate target folder.`);
			}
			return (existingNode as FolderNode);
		}

		return await storage.nodes.setPromise(
			params.objId,
			storage.getObjSrc(params.objId)
			.then(async src => {
				const key = base64.open(params.fKey);
				return FolderNode.rootFromObjBytes(
					storage, params.folderName, params.objId, src, key
				);
			})
		);
	}

	static rootFromJSON(
		storage: Storage, name: string|undefined, folderJson: FolderInJSON
	): FolderNode {
		const rf = new FolderNode(
			storage, name, 'readonly-root', EMPTY_ARR, 0,
			undefined, EMPTY_ARR, false);
		const { folderInfo, attrs, xattrs } = jsonToInfoAndAttrs(folderJson);
		rf.currentState = folderInfo;
		rf.setUpdatedParams(0, attrs, xattrs);
		return rf;
	}

	protected async setCurrentStateFrom(src: ObjSource): Promise<void> {
		const { folderInfo, attrs, xattrs } = await this.crypto.read(src);
		this.currentState = folderInfo;
		this.setUpdatedParams(src.version, attrs, xattrs);
	}

	async adoptRemote(opts: OptionsToAdopteRemote|undefined): Promise<void> {
		const objsToRm = await this.doChange(true, async () => {
			try {
				const adopted = await this.syncedStorage().adoptRemote(
					this.objId, opts);
				if (!adopted) { return; }
				const src = await this.storage.getObjSrc(this.objId, adopted);
				const originalState = this.currentState;
				await this.setCurrentStateFrom(src);
				const newState = this.currentState;
				const {
					renamedNodes, addedNodes, removedNodes
				} = identifyChanges(originalState.nodes, newState.nodes);
				for (const node of removedNodes) {
					const event: EntryRemovalEvent = {
						type: 'entry-removal',
						src: 'sync',
						path: this.name,
						newVersion: this.version,
						name: node.name
					};
					this.broadcastEvent(event, false, node.objId);
				}
				for (const node of addedNodes) {
					const event: EntryAdditionEvent = {
						type: 'entry-addition',
						src: 'sync',
						entry: nodeInfoToListingEntry(node),
						path: this.name,
						newVersion: this.version
					};
					this.broadcastEvent(event, false, node.objId);
				}
				for (const { objId, oldName, newName } of renamedNodes) {
					const event: EntryRenamingEvent = {
						type: 'entry-renaming',
						src: 'sync',
						oldName,
						newName,
						path: this.name,
						newVersion: this.version
					};
					this.broadcastEvent(event, false, objId);
				}
				return removedNodes;
			} catch (exc) {
				throw setPathInExc(exc, this.name);
			}
		});
		if (!objsToRm) { return; }
		for (const objToRm of objsToRm) {
			const nodeToRm = await this.getOrMakeChildNodeForInfo(objToRm);
			this.callRemoveObjOn('sync', nodeToRm);
		}
	}

	private callRemoveObjOn(src: FSChangeSrc, node: NodeInFS<any>): void {
		if (node.type === 'folder') {
			(node as FolderNode).removeFolderObj(src);
		} else {
			node.removeNonFolderObj(src);
		}
	}

	list(): { lst: ListingEntry[]; version: number; } {
		const lst = Object.values(this.currentState.nodes)
		.map(nodeInfoToListingEntry);
		return { lst, version: this.version };
	}

	async listNonCurrent(
		flags: VersionedReadFlags
	): Promise<{ lst: ListingEntry[]; version: number; }> {
		const src = await this.getObjSrcOfVersion(flags);
		const { folderInfo } = await this.crypto.read(src);
		const lst = Object.values(folderInfo)
		.map(nodeInfoToListingEntry);
		return { lst, version: src.version };
	}

	async childExistsInSyncedVersion(childObjId: string): Promise<boolean> {
		const { state, synced } = await this.syncStatus();
		if (state === 'synced') { return true; }
		if (!synced?.latest) { return false; }
		const storage = this.syncedStorage();
		try {
			const syncedContent = await storage.getObjSrc(this.objId, synced.latest);
			const { folderInfo } = await this.crypto.read(syncedContent);
			const childIsInSynced = !!Object.values(folderInfo.nodes)
			.find(({ objId }) => (objId === childObjId));
			return childIsInSynced;
		} catch (exc) {
			storage.logError(exc, `Exception thrown in checking whether child node's obj is present in synced version.`);
			return false;
		}
	}

	getNodeInfo(name: string, undefOnMissing = false): NodeInfo|undefined {
		const fj = this.currentState.nodes[name];
		if (fj) {
			return fj;
		} else if (undefOnMissing) {
			return;
		} else {
			throw makeFileException('notFound', name);
		}
	}

	hasChild(childName: string, throwIfMissing = false): boolean {
		return !!this.getNodeInfo(childName, !throwIfMissing);
	}

	async getNode<T extends NodeInFS<any>>(
		type: NodeType|undefined, name: string, undefOnMissing = false
	): Promise<T|undefined> {
		const childInfo = this.getNodeInfo(name, undefOnMissing);
		if (!childInfo) { return; }
		if (type) {
			if ((type === 'file') && !childInfo.isFile) {
				throw makeFileException('notFile', childInfo.name);
			} else if ((type === 'folder') && !childInfo.isFolder) {
				throw makeFileException('notDirectory', childInfo.name);
			} else if ((type === 'link') && !childInfo.isLink) {
				throw makeFileException('notLink', childInfo.name);
			}
		}
		return this.getOrMakeChildNodeForInfo<T>(childInfo);
	}

	private async getOrMakeChildNodeForInfo<T extends NodeInFS<any>>(
		info: NodeInfo
	): Promise<T> {
		const {
			node, nodePromise
		} = this.storage.nodes.getNodeOrPromise<T>(info.objId);
		if (node) { return node; }
		if (nodePromise) { return nodePromise; }
		const deferred = defer<T>();
		const nodeSet = this.storage.nodes.setPromise(
			info.objId, deferred.promise
		);
		try {
			let node: Node;
			if (info.isFile) {
				node = await FileNode.makeForExisting(
					this.storage, this.objId, info.name, info.objId, info.key
				);
			} else if (info.isFolder) {
				const src = await this.storage.getObjSrc(info.objId);
				node = await FolderNode.readNodeFromObjBytes(
					this.storage, info.name, info.objId, src, info.key
				);
			} else if (info.isLink) {
				node = await LinkNode.makeForExisting(
					this.storage, this.objId, info.name, info.objId, info.key
				);
			} else {
				throw new Error(`Unknown type of fs node`);
			}
			deferred.resolve(node as T);
			return nodeSet;
		} catch (exc) {
			if (exc.objNotFound) {
				await this.fixMissingChildAndThrow(exc, info);
			}
			deferred.reject(errWithCause(
				exc, `Failed to instantiate fs node '${this.name}/${info.name}'`
			));
			return nodeSet;
		}
	}

	getFolder(
		name: string, undefOnMissing = false
	): Promise<FolderNode|undefined> {
		return this.getNode<FolderNode>('folder', name, undefOnMissing);
	}

	getFile(
		name: string, undefOnMissing = false
	): Promise<FileNode|undefined> {
		return this.getNode<FileNode>('file', name, undefOnMissing);
	}

	getLink(
		name: string, undefOnMissing = false
	): Promise<LinkNode|undefined> {
		return this.getNode<LinkNode>('link', name, undefOnMissing);
	}

	private async fixMissingChildAndThrow(
		exc: StorageException, childInfo: NodeInfo
	): Promise<never> {
		await this.doTransition(async (state, version) => {
			const presentChild = state.nodes[childInfo.name];
			if (!presentChild || (presentChild.objId !== childInfo.objId)) {
				return [];
			}
			delete state.nodes[childInfo.name];
			const event: EntryRemovalEvent = {
				type: 'entry-removal',
				path: this.name,
				src: 'local',
				name: childInfo.name,
				newVersion: version
			};
			return { event, childObjId: childInfo.objId };
		}).catch(noop);
		const fileExc = makeFileException('notFound', childInfo.name, exc);
		fileExc.inconsistentStateOfFS = true;
		throw fileExc;
	}

	/**
	 * This method prepares a transition state, runs given action, and completes
	 * transition to a new version.
	 * Note that if there is already an ongoing change, this transition will
	 * wait. Such behaviour is generally needed for folder as different processes
	 * may be sharing same elements in a file tree. In contrast, file
	 * operations should more often follow a throw instead wait approach.
	 * @param change is a function that is run when transition is started
	 */
	private async doTransition(change: TransactionChange): Promise<void> {
		await this.doChange(true, () => this.performTransition(change));
	}

	private async performTransition(change: TransactionChange): Promise<void> {
		// start transition and prepare transition state
		// Note on copy: byte arrays are not cloned
		const state = copy(this.currentState);
		const version = this.version + 1;
		const attrs = this.attrs.copy();

		// do action within transition state
		const changeEvents = await change(state, version);

		// save transition state
		const encSub = await this.crypto.write(
			state, version, attrs, this.xattrs);
		await this.storage.saveObj(this.objId, version, encSub);

		// complete transition
		this.currentState = state;
		this.setCurrentVersion(version);
		this.attrs = attrs;

		if (Array.isArray(changeEvents)) {
			for (const { event, childObjId } of changeEvents) {
				this.broadcastEvent(event, false, childObjId);
			}
		} else {
			const { event, childObjId } = changeEvents;
			this.broadcastEvent(event, false, childObjId);
		}
	}

	/**
	 * This function only creates folder node, but it doesn't insert it anywhere.
	 * @param name
	 */
	private async makeAndSaveNewChildFolderNode(
		name: string, changes: XAttrsChanges|undefined
	): Promise<{ node: FolderNode; key: Uint8Array; }> {
		const key = await random.bytes(KEY_LENGTH);
		const childObjId = await this.storage.generateNewObjId();
		const node = new FolderNode(
			this.storage, name, childObjId, idToHeaderNonce(childObjId), 0,
			this.objId, key, true);
		await node.saveFirstVersion(changes).catch((exc: StorageException) => {
			if (!exc.objExists) { throw exc; }
			// call this method recursively, if obj id is already used in storage
			return this.makeAndSaveNewChildFolderNode(name, changes);
		});
		return { node, key };
	}

	private async saveFirstVersion(
		changes: XAttrsChanges|undefined
	): Promise<void> {
		await this.doChange(false, async () => {
			if (this.version > 0) { throw new Error(
				`Can call this function only for zeroth version, not ${this.version}`); }
			const {
				attrs, xattrs, newVersion
			} = super.getParamsForUpdate(changes);
			const encSub = await this.crypto.write(
				this.currentState, newVersion, attrs, xattrs);
			await this.storage.saveObj(this.objId, newVersion, encSub);
			super.setUpdatedParams(newVersion, attrs, xattrs);
		});
	}

	/**
	 * This function only creates file node, but it doesn't insert it anywhere.
	 * @param name
	 */
	private async makeAndSaveNewChildFileNode(
		name: string
	): Promise<{ node: FileNode; key: Uint8Array; }> {
		const key = await random.bytes(KEY_LENGTH);
		const node = await FileNode.makeForNew(this.storage, this.objId, name, key);
		await node.save([]).catch((exc: StorageException) => {
			if (!exc.objExists) { throw exc; }
			// call this method recursively, if obj id is already used in storage
			return this.makeAndSaveNewChildFileNode(name);
		});
		return { node, key };
	}

	/**
	 * This function only creates link node, but it doesn't insert it anywhere.
	 * @param name
	 * @param params
	 */
	private async makeAndSaveNewChildLinkNode(
		name: string, params: LinkParameters<any>
	): Promise<{ node: LinkNode; key: Uint8Array; }> {
		const key = await random.bytes(KEY_LENGTH);
		const node = await LinkNode.makeForNew(
			this.storage, this.objId, name, key);
		await node.save(params).catch((exc: StorageException) => {
			if (!exc.objExists) { throw exc; }
			// call this method recursively, if obj id is already used in storage
			return this.makeAndSaveNewChildLinkNode(name, params);
		});
		return { node, key };
	}

	private create<T extends NodeInFS<any>>(
		type: NodeType, name: string, exclusive: boolean,
		changes?: XAttrsChanges, linkParams?: LinkParameters<any>
	): Promise<T> {
		return this.doChange(true, async () => {

			// do check for concurrent creation of a node
			if (this.getNodeInfo(name, true)) {
				if (exclusive) {
					throw makeFileException('alreadyExists', name);
				} else if (type === 'folder') {
					return (await this.getNode<T>('folder', name))!;
				} else if (type === 'file') {
					return (await this.getNode<T>('file', name))!;
				} else if (type === 'link') {
					throw new Error(`Link is created in non-exclusive mode`);
				} else {
					throw new Error(`Unknown type of node: ${type}`);
				}
			}

			let node: Node = (undefined as any);

			await this.performTransition(async (state, version) => {
				// create new node
				let key: Uint8Array;
				if (type === 'file') {
					({ node, key } = await this.makeAndSaveNewChildFileNode(name));
				} else if (type === 'folder') {
					({ node, key } = await this.makeAndSaveNewChildFolderNode(
						name, changes));
				} else if (type === 'link') {
					({ node, key } = await this.makeAndSaveNewChildLinkNode(
						name, linkParams!));
				} else {
					throw new Error(`Unknown type of node: ${type}`);
				}

				addToTransitionState(state, node, key);
				this.storage.nodes.set(node);

				const event: EntryAdditionEvent = {
					type: 'entry-addition',
					path: this.name,
					src: 'local',
					newVersion: version,
					entry: nodeToListingEntry(node)
				};
				return { event, childObjId: node.objId };
			});

			return node as T;
		});
	}

	createFolder(
		name: string, exclusive: boolean, changes: XAttrsChanges|undefined
	): Promise<FolderNode> {
		return this.create<FolderNode>('folder', name, exclusive, changes);
	}

	createFile(name: string, exclusive: boolean): Promise<FileNode> {
		return this.create<FileNode>('file', name, exclusive);
	}

	async createLink(name: string, params: LinkParameters<any>): Promise<void> {
		await this.create<LinkNode>('link', name, true, undefined, params);
	}

	async removeChild(f: NodeInFS<any>): Promise<void> {
		await this.doTransition(async (state, version) => {
			const childJSON = state.nodes[f.name];
			if (!childJSON || (childJSON.objId !== f.objId)) { throw new Error(
				`Not a child given: name==${f.name}, objId==${f.objId}, parentId==${f.parentId}, this folder objId==${this.objId}`); }
			delete state.nodes[f.name];
			const event: EntryRemovalEvent = {
				type: 'entry-removal',
				path: this.name,
				src: 'local',
				name: f.name,
				newVersion: version
			};
			return { event, childObjId: f.objId };
		});
		// explicitly do not wait on a result of child's delete, cause if it fails
		// we just get traceable garbage, yet, the rest of a live/non-deleted tree
		// stays consistent
		this.callRemoveObjOn('local', f);
}

	private changeChildName(initName: string, newName: string): Promise<void> {
		return this.doTransition(async (state, version) => {
			const child = state.nodes[initName];
			delete state.nodes[child.name];
			state.nodes[newName] = child;
			child.name = newName;
			const childNode = this.storage.nodes.get(child.objId);
			if (childNode) {
				childNode.name = newName;
			}
			const event: EntryRenamingEvent = {
				type: 'entry-renaming',
				path: this.name,
				src: 'local',
				newName,
				oldName: initName,
				newVersion: version
			};
			return { event, childObjId: child.objId };
		});
	}

	async moveChildTo(
		childName: string, dst: FolderNode, nameInDst: string
	): Promise<void> {
		if (dst.hasChild(nameInDst)) {
			throw makeFileException('alreadyExists', nameInDst); }
		if (dst === this) {
			// In this case we only need to change child's name
			await this.changeChildName(childName, nameInDst);
		} else {
			const childJSON = this.getNodeInfo(childName)!;
			// we have two transitions here, in this and in dst.
			const moveLabel = getMoveLabel();
			await dst.moveChildIn(nameInDst, childJSON, moveLabel);
			await this.moveChildOut(childName, childJSON.objId, moveLabel);
		}
	}

	private async moveChildOut(
		name: string, childObjId: string, moveLabel: number
	): Promise<void> {
		await this.doTransition(async (state, version) => {
			const child = state.nodes[name];
			delete state.nodes[name];
			const event: EntryRemovalEvent = {
				type: 'entry-removal',
				path: this.name,
				src: 'local',
				name,
				newVersion: version,
				moveLabel
			};
			return { event, childObjId };
		});
	}

	private async moveChildIn(
		newName: string, child: NodeInfo, moveLabel: number
	): Promise<void> {
		child = copy(child);
		await this.doTransition(async (state, version) => {
			child.name = newName;
			state.nodes[child.name] = child;
			const event: EntryAdditionEvent = {
				type: 'entry-addition',
				path: this.name,
				src: 'local',
				entry: nodeInfoToListingEntry(child),
				newVersion: version,
				moveLabel
			};
			return { event, childObjId: child.objId };
		});
	}

	async getFolderInThisSubTree(
		path: string[], createIfMissing = false, exclusiveCreate = false
	): Promise<FolderNode> {
		if (path.length === 0) { return this; }
		let f: FolderNode;
		try {
			f = (await this.getFolder(path[0]))!;
			// existing folder at this point
			if (path.length === 1) {
				if (exclusiveCreate) {
					throw makeFileException('alreadyExists', path[0]);
				} else {
					return f;
				}
			}
		} catch (err) {
			if (!(err as FileException).notFound) { throw err; }
			if (!createIfMissing) { throw err; }
			try {
				f = await this.createFolder(path[0], exclusiveCreate, undefined);
			} catch (exc) {
				if ((exc as FileException).alreadyExists && !exclusiveCreate) {
					return this.getFolderInThisSubTree(path, createIfMissing);
				} 
				throw exc;
			}
		}
		if (path.length > 1) {
			return f.getFolderInThisSubTree(path.slice(1),
				createIfMissing, exclusiveCreate);
		} else {
			return f;
		}
	}

	/**
	 * This returns true if folder has no child nodes, i.e. is empty.
	 */
	isEmpty(): boolean {
		return (Object.keys(this.currentState.nodes).length === 0);
	}

	private async getAllNodes(): Promise<NodeInFS<NodePersistance>[]> {
		const lst = this.list().lst;
		const content: NodeInFS<NodePersistance>[] = [];
		for (const entry of lst) {
			let node: NodeInFS<NodePersistance>|undefined;
			if (entry.isFile) {
				node = await this.getFile(entry.name, true);
			} else if (entry.isFolder) {
				node = await this.getFolder(entry.name, true);
			} else if (entry.isLink) {
				node = await this.getLink(entry.name, true);
			}
			if (node) {
				content.push(node);
			}
		}
		return content;
	}

	private async removeFolderObj(
		src: FSChangeSrc, passIdsForRmUpload = false
	): Promise<ObjId[]|undefined> {
		const childrenNodes = await this.doChange(true, async () => {
			if (this.version < 0) { return; }
			const childrenNodes = await this.getAllNodes();
			await this.removeThisFromStorageNodes(src);
			return childrenNodes;
		});
		if (!childrenNodes || (childrenNodes.length === 0)) { return; }
		if (this.isInSyncedStorage) {
			if (passIdsForRmUpload) {
				return this.removeChildrenObjsInSyncedStorage(
					childrenNodes, src, true
				);
			} else {
				this.removeChildrenObjsInSyncedStorage(childrenNodes, src, false);
			}
		} else {
			this.callRemoveObjOnAll(src, childrenNodes);
		}
	}

	private callRemoveObjOnAll(src: FSChangeSrc, nodes: NodeInFS<any>[]): void {
		for (const f of nodes) {
			this.callRemoveObjOn(src, f);
		}
	}

	private async removeChildrenObjsInSyncedStorage(
		childrenNodes: NodeInFS<NodePersistance>[], src: FSChangeSrc,
		passIdsForRmUpload: boolean
	): Promise<ObjId[]|undefined> {
		if (this.version < 0) { return; }
		let uploadRmsHere: boolean;
		let collectedIds: ObjId[]|undefined;
		if (passIdsForRmUpload) {
			collectedIds = [];
			uploadRmsHere = false;
		} else {
			try {
				const status = await this.syncedStorage().status(this.objId);
				if (status.neverUploaded()) {
					collectedIds = [];
					uploadRmsHere = true;
				} else {
					collectedIds = undefined;
					uploadRmsHere = false;
				}
			} catch (exc) {
				if ((exc as StorageException).objNotFound) {
					collectedIds = [];
					uploadRmsHere = true;
				} else {
					throw exc;
				}
			}
		}
		if (!collectedIds) {
			this.callRemoveObjOnAll(src, childrenNodes);
			return;
		}
		await Promise.allSettled(childrenNodes.map(async child => {
			const status = await this.syncedStorage().status(child.objId);
			if (!status.neverUploaded()) {
				collectedIds!.push(child.objId);
			}
			if (child.type === 'folder') {
				const ids = await (child as FolderNode).removeFolderObj(
					src, passIdsForRmUpload);
				if (ids) {
					collectedIds!.push(...ids);
				}				
			} else {
				await child.removeNonFolderObj(src);
			}
		}));
		if (uploadRmsHere) {
			await this.uploadRemovalOfObjs(collectedIds);
		} else {
			return collectedIds;
		}
	}

	private async uploadRemovalOfObjs(objsToRm: ObjId[]): Promise<void> {
		objsToRm.sort();	// shuffle order
		await Promise.allSettled(
			objsToRm.map(objToRm => this.syncedStorage().uploadObjRemoval(objToRm))
		);
	}

	getParamsForLink(): LinkParameters<FolderLinkParams> {
		if ((this.storage.type !== 'synced') && (this.storage.type !== 'local')) {
			throw new Error(`Creating link parameters to object in ${this.storage.type} file system, is not implemented.`); }
		const params: FolderLinkParams = {
			folderName: (undefined as any),
			objId: this.objId,
			fKey: this.crypto.fileKeyInBase64()
		};
		const linkParams: LinkParameters<FolderLinkParams> = {
			storageType: this.storage.type,
			isFolder: true,
			params
		};
		return linkParams;
	}

	async upload(
		opts: OptionsToUploadLocal|undefined
	): Promise<number|undefined> {
		try {
			const toUpload = await this.needUpload(opts?.localVersion);
			if (!toUpload) { return; }
			if (toUpload.createOnRemote) {
				return await super.upload(opts);
			}
			const storage = this.syncedStorage();
			const { localVersion, uploadVersion } = toUpload;
			const removedNodes = await this.getNodesRemovedBetweenVersions(
				localVersion, uploadVersion - 1
			);
			const uploadHeader = await this.uploadHeaderChange(
				localVersion, uploadVersion
			);
			await storage.upload(
				this.objId, localVersion, uploadVersion, uploadHeader, false
			);
			if (removedNodes.length > 0) {
				// start upload of children's removal after folder's upload;
				// we also don't await for chidren removal
				this.uploadRemovalOf(removedNodes);
			}
			return uploadVersion;
		} catch (exc) {
			throw setPathInExc(exc, this.name);
		}
	}

	private async uploadRemovalOf(removedNodes: NodeInfo[]): Promise<void> {
		const rmObjs: ObjId[] = [];
		for (const node of removedNodes) {
			appendArray(rmObjs, await this.listRemovedInTreeToUploadRm(node));
		}
		await this.uploadRemovalOfObjs(rmObjs);
	}

	private async listRemovedInTreeToUploadRm(
		node: NodeInfo
	): Promise<ObjId[]|ObjId|undefined> {
		const storage = this.syncedStorage();
		let versionBeforeRm: number|undefined;
		try {
			const status = await storage.status(node.objId);
			versionBeforeRm = status.versionBeforeUnsyncedRemoval();
			if (!versionBeforeRm) { return; }
		} catch (exc) {
			if ((exc as StorageException).objNotFound
			|| (exc as FileException).notFound) {
				return;
			}
			throw exc;
		}
		if (node.isFolder) {
			const objs = [ node.objId ];
			const src = await storage.getObjSrc(node.objId, versionBeforeRm, true);
			const folderContent = await FolderPersistance.readFolderContent(
				node.objId, node.key, src, storage.cryptor
			);
			for (const child of Object.values(folderContent.nodes)) {
				appendArray(objs, await this.listRemovedInTreeToUploadRm(child));
			}
			return objs;
		} else {
			return node.objId;
		}
	}

	protected async needUpload(localVersion: number|undefined): Promise<{
		localVersion: number; uploadVersion: number; createOnRemote: boolean;
	}|undefined> {
		const toUpload = await super.needUpload(localVersion);
		if (!toUpload) { return; }
		const storage = this.syncedStorage();
		if (toUpload.localVersion === this.version) {
			for (const { objId, name } of Object.values(this.currentState.nodes)) {
				if ((await storage.status(objId)).neverUploaded()) {
					throw makeFSSyncException(this.name, {
						childNeverUploaded: true, childName: name
					});
				}
			}
		} else {
			throw makeFSSyncException(this.name, {
				versionMismatch: true,
				localVersion: toUpload.localVersion,
				message: `Local version has concurrently changed from ${toUpload.localVersion} to current ${this.version}`
			});
		}
		return toUpload;
	}

	private async getNodesRemovedBetweenVersions(
		newVer: number, syncedVer: number
	): Promise<NodeInfo[]> {
		const storage = this.syncedStorage();
		let stateToUpload: FolderInfo;
		if (this.version === newVer) {
			stateToUpload = this.currentState;
		} else {
			const localVerSrc = await storage.getObjSrcOfRemoteVersion(
				this.objId, newVer
			);
			({ folderInfo: stateToUpload } = await this.crypto.read(localVerSrc));
		}
		const syncedVerSrc = await storage.getObjSrcOfRemoteVersion(
			this.objId, syncedVer
		);
		const { folderInfo: syncedState } = await this.crypto.read(syncedVerSrc);
		const { removedNodes } = identifyChanges(
			syncedState.nodes, stateToUpload.nodes);
		return removedNodes;
	}

	async adoptRemoteFolderItem(
		itemName: string, opts: OptionsToAdoptRemoteItem|undefined
	): Promise<number> {
		if (opts?.localVersion) {
			if (this.version !== opts.localVersion) {
				throw makeFSSyncException(this.name, {
					versionMismatch: true,
					message: `Given local version ${opts.localVersion} is not equal to current ${this.version}`
				});
			}
		}
		const { remote } = await this.syncStatus();
		if (!remote) {
			throw makeFSSyncException(this.name, {
				versionMismatch: true,
				message: `No remote versions`
			});
		}
		if (opts?.remoteVersion) {
			if (opts.remoteVersion !== remote.latest) {
				throw makeFSSyncException(this.name, {
					versionMismatch: true,
					message: `Unknown remote version ${opts.remoteVersion}`
				});
			}
		} else if (!remote.latest) {
			throw makeFSSyncException(this.name, {
				remoteIsArchived: true
			});
		}
		const storage = this.syncedStorage();
		const srcOfRemote = await storage.getObjSrcOfRemoteVersion(
			this.objId, remote.latest);
		const {
			folderInfo: { nodes: remoteNodes }
		} = await this.crypto.read(srcOfRemote);
		const remoteChildNode = remoteNodes[itemName];
		if (!remoteChildNode) {
			throw makeFSSyncException(this.name, {
				remoteFolderItemNotFound: true,
				message: `Item '${itemName}' is not found in remote version`
			});
		}
		const localNodeToRm = this.getNodeInfo(itemName, true);
		if (!localNodeToRm) {
			return await this.addRemoteChild(remoteChildNode);
		} else if (localNodeToRm.objId === remoteChildNode.objId) {
			assert(typeOfNode(localNodeToRm) === typeOfNode(remoteChildNode));
			// XXX
			throw new Error(`Adaptation of changing keys needs implementation`);
		} else {
			return await this.replaceLocalChildWithRemote(remoteChildNode);
		}
	}

	private async addRemoteChild(remoteChildNode: NodeInfo): Promise<number> {
		let newVersion: number;
		await this.doTransition(async (state, version) => {
			newVersion = version;
			state.nodes[remoteChildNode.name] = remoteChildNode;
			const event: EntryAdditionEvent = {
				type: 'entry-addition',
				path: this.name,
				src: 'sync',
				entry: nodeInfoToListingEntry(remoteChildNode),
				newVersion
			};
			return { event, childObjId: remoteChildNode.objId };
		});
		return newVersion!;
	}

	private async replaceLocalChildWithRemote(
		remoteChildNode: NodeInfo
	): Promise<number> {
		let origChildNode: NodeInfo;
		let newVersion: number;
		await this.doTransition(async (state, version) => {
			newVersion = version;
			origChildNode = state.nodes[remoteChildNode.name];
			state.nodes[remoteChildNode.name] = remoteChildNode;
			const additionEvent: EntryAdditionEvent = {
				type: 'entry-addition',
				path: this.name,
				src: 'sync',
				entry: nodeInfoToListingEntry(remoteChildNode),
				newVersion
			};
			const rmEvent: EntryRemovalEvent = {
				type: 'entry-removal',
				path: this.name,
				src: 'sync',
				name: origChildNode.name
			};
			return [
				{ event: rmEvent, childObjId: origChildNode.objId },
				{ event: additionEvent, childObjId: remoteChildNode.objId }
			];
		});
		const origChild = await this.getOrMakeChildNodeForInfo(origChildNode!);
		const removalsToUpload = (await this.removeChildrenObjsInSyncedStorage(
			[ origChild ], 'sync', true))!;		
		this.uploadRemovalOfObjs(removalsToUpload);
		return newVersion!;
	}

	async diffCurrentAndRemote(
		remoteVersion: number|undefined
	): Promise<FolderDiff|undefined> {
		const { state, remote } = await this.syncStatus();
		let isCurrentLocal: boolean;
		if (state === 'behind') {
			isCurrentLocal = false;
		} else if (state === 'conflicting') {
			isCurrentLocal = true;
		} else {
			return;
		}
		if (remote!.isArchived) {
			return this.diffWithArchivedRemote(isCurrentLocal);
		} else {
			if (remoteVersion) {
				if ((remoteVersion !== remote!.latest!)
				&& !remote!.archived?.includes(remoteVersion)) {
					throw makeFSSyncException(this.name, {
						versionMismatch: true,
						message: `Unknown remote version ${remoteVersion}`
					});
				}
			} else {
				remoteVersion = remote!.latest!;
			}
			const storage = this.syncedStorage();
			const srcOfRemote = await storage.getObjSrcOfRemoteVersion(
				this.objId, remote!.latest!);
			const {
				folderInfo, attrs, xattrs
			} = await this.crypto.read(srcOfRemote);
			return this.diffWithRemote(
				isCurrentLocal, remoteVersion, folderInfo, attrs, xattrs);
		}
	}

	private diffWithArchivedRemote(isCurrentLocal: boolean): FolderDiff {
		return {
			currentVersion: this.version,
			isCurrentLocal,
			isRemoteArchived: true,
			ctime: {
				current: new Date(this.attrs.ctime)
			},
			mtime: {
				current: new Date(this.attrs.ctime)
			}
		};
	}

	private diffWithRemote(
		isCurrentLocal: boolean, remoteVersion: number,
		folderInfo: FolderInfo, attrs: CommonAttrs, xattrs: XAttrs|undefined
	): FolderDiff {
		const { ctime, mtime } = diffAttrs(this.attrs, attrs);
		const {
			inCurrent, inRemote, nameOverlaps
		} = diffNodes(this.currentState, folderInfo);
		return {
			currentVersion: this.version,
			isCurrentLocal,
			isRemoteArchived: false,
			remoteVersion,
			inCurrent,
			inRemote,
			nameOverlaps,
			ctime,
			mtime,
			xattrs: diffXAttrs(this.xattrs, xattrs)
		};
	}

}
Object.freeze(FolderNode.prototype);
Object.freeze(FolderNode);


const EMPTY_ARR = new Uint8Array(0);

function noop() {}

function checkFolderInfo(folderJson: FolderInfo): FolderInfo {
	// TODO throw if folderJson is not ok

	return folderJson;
}

function nodeInfoToListingEntry(
	{ name, isFile, isFolder, isLink }: NodeInfo
): ListingEntry {
	if (isFolder) {
		return { name, isFolder };
	} else if (isFile) {
		return { name, isFile };
	} else if (isLink) {
		return { name, isLink };
	} else {
		return { name };
	}
}

function nodeToListingEntry({ name, type }: Node): ListingEntry {
	switch (type) {
		case 'file':
			return { name, isFolder: true };
		case 'folder':
			return { name, isFolder: true };
		case 'link':
			return { name, isLink: true };
		default:
			return { name };
	}
}

function typeOfNode(nodeInfo: NodeInfo): NodeType {
	if (nodeInfo.isFolder) { return 'folder'; }
	else if (nodeInfo.isFile) { return 'file'; }
	else if (nodeInfo.isLink) { return 'link'; }
	else { throw new Error(`Unknown type of node info`); }
}

function addToTransitionState(
	state: FolderInfo, f: Node, key: Uint8Array
): void {
	const nodeInfo: NodeInfo = {
		name: f.name,
		objId: f.objId,
		key
	};
	if (f.type === 'folder') { nodeInfo.isFolder = true; }
	else if (f.type === 'file') { nodeInfo.isFile = true; }
	else if (f.type === 'link') { nodeInfo.isLink = true; }
	else { throw new Error(`Unknown type of file system entity: ${f.type}`); }
	state.nodes[nodeInfo.name] = nodeInfo;
}

type TransactionChange = (
	state: FolderInfo, version: number
) => Promise<{
	event: FSEvent; childObjId?: string;
}[]|{ event: FSEvent; childObjId?: string; }>;

function diffAttrs(current: CommonAttrs, remote: CommonAttrs): {
	ctime: FolderDiff['ctime']; mtime: FolderDiff['mtime'];
} {
	return {
		ctime: {
			current: new Date(current.ctime),
			remote: new Date(remote.ctime)
		},
		mtime: {
			current: new Date(current.mtime),
			remote: new Date(remote.mtime)
		}
	};
}

function diffNodes(current: FolderInfo, remote: FolderInfo): {
	inCurrent?: ListingEntry[]; inRemote?: ListingEntry[];
	nameOverlaps?: string[];
} {
	const inCurrent = getOnlyNotEqualNodes(current.nodes, remote.nodes);
	const inRemote = getOnlyNotEqualNodes(remote.nodes, current.nodes);
	const combined = combineCheckingNameOverlaps(inCurrent, inRemote);
	return (combined ? combined : {});
}

function getOnlyNotEqualNodes(
	src: FolderInfo['nodes'], exclude: FolderInfo['nodes']
): ListingEntry[]|undefined {
	const collected: ListingEntry[] = [];
	for (const [ name, nodeInSrc ] of Object.entries(src)) {
		const nodeInExclude = exclude[name];
		if (!nodeInExclude
		|| !areNodesEqual(nodeInSrc, nodeInExclude)) {
			collected.push(nodeInfoToListingEntry(nodeInSrc));
		}
	}
	return ((collected.length > 0) ? collected : undefined);
}

function areNodesEqual(n1: NodeInfo, n2: NodeInfo): boolean {
	if (n1.name !== n2.name) { return false; }
	if (n1.isFile && !n2.isFile) { return false; }
	if (n1.isFolder && !n2.isFolder) { return false; }
	if (n1.isLink && !n2.isLink) { return false; }
	if (n1.objId !== n2.objId) { return false; }
	if (!areBytesEqual(n1.key, n2.key)) { return false; }
	return true;
}

function combineCheckingNameOverlaps<T extends { name: string; }>(
	inCurrent: T[]|undefined, inRemote: T[]|undefined
): {
	inCurrent?: T[]; inRemote?: T[]; nameOverlaps?: string[];
}|undefined {
	if (inCurrent) {
		if (inRemote) {
			const nameOverlaps: string[] = [];
			for (const { name: nameInCurrent } of inCurrent) {
				if (inRemote.find(({ name }) => (name === nameInCurrent))) {
					nameOverlaps.push(nameInCurrent);
				}
			}
			if (nameOverlaps.length > 0) {
				return { inCurrent, inRemote, nameOverlaps };
			} else {
				return { inCurrent, inRemote };
			}
		} else {
			return { inCurrent };
		}
	} else {
		if (inRemote) {
			return { inRemote };
		} else {
			return;
		}
	}
}

function diffXAttrs(
	current: XAttrs|undefined, remote: XAttrs|undefined
): FolderDiff['xattrs'] {
	const haveCurrentXAttrs = (current && (current.list().length > 0));
	const haveRemoteXAttrs = (remote && (remote.list().length > 0));
	if (haveCurrentXAttrs && haveRemoteXAttrs) {
		const inCurrent = getOnlyNotEqualXAttrs(current, remote);
		const inRemote = getOnlyNotEqualXAttrs(remote, current);
		return combineCheckingNameOverlaps(inCurrent, inRemote);
	} else if (haveCurrentXAttrs && !haveRemoteXAttrs) {
		return { inCurrent: allXAttrsToDiff(current) };
	} else if (!haveCurrentXAttrs && haveRemoteXAttrs) {
		return { inRemote: allXAttrsToDiff(remote) };
	} else {
		return;
	}
}

function allXAttrsToDiff(src: XAttrs): { name: string; value: any; }[] {
	const collected: { name: string; value: any; }[] = [];
	for (const name of src.list()) {
		const value = src.get(name);
		if (value !== undefined) {
			collected.push({ name, value });
		}
	}
	return collected;
}

function getOnlyNotEqualXAttrs(
	src: XAttrs, exclude: XAttrs
): { name: string; value: any; }[]|undefined {
	const collected: { name: string; value: any; }[] = [];
	for (const name of src.list()) {
		const valueInSrc = src.get(name);
		if (valueInSrc === undefined) { continue; }
		const valueInExclude = exclude.get(name);
		if ((valueInExclude === undefined)
		|| !areXAttrValuesEqual(valueInSrc, valueInExclude)) {
			collected.push({ name, value: valueInSrc });
		}
	}
	return ((collected.length > 0) ? collected : undefined);
}

function areXAttrValuesEqual(v1: any, v2: any): boolean {
	if (Buffer.isBuffer(v1) || ArrayBuffer.isView(v1)) {
		if (Buffer.isBuffer(v2) || ArrayBuffer.isView(v2)) {
			return areBytesEqual(v1 as Uint8Array, v2 as Uint8Array);
		} {
			return false;
		}
	} else if (typeof v1 === 'string') {
		if (typeof v2 === 'string') {
			return (v1 === v2);
		} else {
			return false;
		}
	} else {
		if (Buffer.isBuffer(v2) || ArrayBuffer.isView(v2)
		|| (typeof v2 === 'string')) {
			return false;
		} else {
			return deepEqual(v1, v2);
		}
	}
}

function areBytesEqual(b1: Uint8Array, b2: Uint8Array): boolean {
	if (b1.length !== b2.length) { return false; }
	for (let i=0; i<b1.length; i+=1) {
		if (b1[i] !== b2[i]) { return false; }
	}
	return true;
}

function identifyChanges(
	originalNodes: FolderInfo['nodes'], newNodes: FolderInfo['nodes']
) : {
	removedNodes: NodeInfo[]; addedNodes: NodeInfo[];
	renamedNodes: { oldName: string; newName: string; objId: string; }[];
} {
	const removedNodes: ReturnType<typeof identifyChanges>['removedNodes'] = [];
	const addedNodes: ReturnType<typeof identifyChanges>['addedNodes'] = [];
	const renamedNodes: ReturnType<typeof identifyChanges>['renamedNodes'] = [];
	for (const [ name, node ] of Object.entries(originalNodes)) {
		const newNode = newNodes[name];
		if (newNode && (newNode.objId === node.objId)) { continue; }
		removedNodes.push(node);
	}
	for (const [ name, newNode ] of Object.entries(newNodes)) {
		const node = originalNodes[name];
		if (node && (newNode.objId === node.objId)) { continue; }
		const indInRm = removedNodes.findIndex(n => (n.objId === newNode.objId));
		if (indInRm < 0) {
			addedNodes.push(newNode);
		} else {
			const oldNode = removedNodes.splice(indInRm, 1)[0];
			renamedNodes.push({
				oldName: oldNode.name,
				newName: newNode.name,
				objId: newNode.objId
			});
		}
	}
	return { addedNodes, removedNodes, renamedNodes };
}


Object.freeze(exports);