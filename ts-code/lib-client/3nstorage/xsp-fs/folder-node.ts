/*
 Copyright (C) 2015 - 2020 3NSoft Inc.
 
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

/**
 * Everything in this module is assumed to be inside of a file system
 * reliance set.
 */

import { base64 } from '../../../lib-common/buffer-utils';
import { makeFileException, Code as excCode, FileException }
	from '../../../lib-common/exceptions/file';
import { errWithCause } from '../../../lib-common/exceptions/error';
import { Storage, Node, NodeType } from './common';
import { NodeInFS, NodeCrypto } from './node-in-fs';
import { FileNode } from './file-node';
import { LinkNode } from './link-node';
import { LinkParameters } from '../../files';
import { StorageException } from '../exceptions';
import { defer, Deferred } from '../../../lib-common/processes';
import { copy } from '../../../lib-common/json-utils';
import { AsyncSBoxCryptor, KEY_LENGTH, NONCE_LENGTH, calculateNonce, idToHeaderNonce, Subscribe, ObjSource }
	from 'xsp-files';
import * as random from '../../../lib-common/random-node';
import { deserializeFolderInfo, serializeFolderInfo }
	from './folder-node-serialization';
import { FolderAttrs, AttrsHolder, EntityAttrs } from '../../files/file-attrs';

type ListingEntry = web3n.files.ListingEntry;
type EntryAdditionEvent = web3n.files.EntryAdditionEvent;
type EntryRemovalEvent = web3n.files.EntryRemovalEvent;
type RemovedEvent = web3n.files.RemovedEvent;
type EntryRenamingEvent = web3n.files.EntryRenamingEvent;

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

export interface FolderInfoWithAttrs extends FolderInfo {
	attrs?: FolderAttrs;
}

function jsonToInfoAndAttrs(
	json: FolderInfoWithAttrs
): { folderInfo: FolderInfo; attrs?: AttrsHolder<FolderAttrs>; } {
	const folderInfo: FolderInfo = {
		nodes: copy(json.nodes)
	};
	for (const node of Object.values(folderInfo.nodes)) {
		node.key = base64.open(node.key as any);
	}
	checkFolderInfo(folderInfo);
	if (json.attrs) {
		const attrs = AttrsHolder.fromJSONReadonly(json.attrs);
		return { attrs, folderInfo };
	} else {
		return { folderInfo };
	}
}

class FolderCrypto extends NodeCrypto {

	constructor(zNonce: Uint8Array, key: Uint8Array, cryptor: AsyncSBoxCryptor) {
		super(zNonce, key, cryptor);
		Object.seal(this);
	}

	async pack(
		folderInfo: FolderInfo, version: number, attrs: AttrsHolder<FolderAttrs>
	): Promise<Subscribe> {
		return this.saveBytes(serializeFolderInfo(folderInfo), version, attrs);
	}

	async open(
		src: ObjSource
	): Promise<{ folderInfo: FolderInfo; attrs?: AttrsHolder<FolderAttrs>; }> {
		try {
			const { attrs, content } = await this.readBytes(src);
			const folderInfo = deserializeFolderInfo(content);
			if (attrs) {
				return {
					folderInfo,
					attrs: AttrsHolder.fromBytesReadonly<FolderAttrs>(attrs)
				}
			} else {
				return { folderInfo };
			}
		} catch (err) {
			throw errWithCause(err, `Cannot open folder object`);
		}
	}

}
Object.freeze(FolderCrypto.prototype);
Object.freeze(FolderCrypto);

export interface FolderLinkParams {
	folderName: string;
	objId: string;
	fKey: string;
}

export class FolderNode extends NodeInFS<FolderCrypto, FolderAttrs> {

	private currentState: FolderInfo = { nodes: {} };
	private transitionState: FolderInfo = (undefined as any);
	private transitionVersion: number|undefined = undefined;
	private transitionSaved = false;

	private constructor(
		storage: Storage, name: string|undefined,
		objId: string|null, zNonce: Uint8Array|undefined, version: number,
		parentId: string|undefined, key: Uint8Array, setNewAttrs: boolean
	) {
		super(storage, 'folder', name!, objId!, version, parentId);
		if (!name && (objId || parentId)) {
			throw new Error("Root folder must "+
				"have both objId and parent as nulls.");
		} else if (objId === null) {
			new Error("Missing objId for non-root folder");
		}
		if (!zNonce) {
			if (!objId) { throw new Error(
				`Missing object id for folder, when zeroth nonce is not given`); }
			zNonce = idToHeaderNonce(objId);
		}
		this.crypto = new FolderCrypto(zNonce, key, storage.cryptor);
		if (setNewAttrs) {
			this.attrs = AttrsHolder.makeReadonlyForFolder(Date.now());
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
		await rf.saveFirstVersion();
		return rf;
	}

	static async rootFromObjBytes(
		storage: Storage, name: string|undefined,
		objId: string|null, src: ObjSource, key: Uint8Array
	): Promise<FolderNode> {
		let zNonce: Uint8Array|undefined = undefined;
		if (!objId) {
			const header = await src.readHeader();
			zNonce = calculateNonce(
				header.subarray(0, NONCE_LENGTH), -src.version);
		}
		const rf = await FolderNode.readNodeFromObjBytes(
			storage, name, objId, zNonce, src, key);
		rf.storage.nodes.set(rf);
		return rf;
	}

	private static async readNodeFromObjBytes(
		storage: Storage, name: string|undefined, objId: string|null,
		zNonce: Uint8Array|undefined, src: ObjSource, key: Uint8Array
	): Promise<FolderNode> {
		const rf = new FolderNode(
			storage, name, objId, zNonce, src.version, undefined, key, false);
		const { folderInfo, attrs } = await rf.crypto.open(src);
		rf.currentState = folderInfo;
		rf.attrs = (attrs ? attrs : AttrsHolder.makeReadonlyForFolder(0));
		return rf;
	}

	static async rootFromLinkParams(
		storage: Storage, params: FolderLinkParams
	): Promise<FolderNode> {
		const existingNode = storage.nodes.get(params.objId);

		if (existingNode) {
			if (existingNode.type !== 'folder') { throw new Error(
				`Existing object ${params.objId} type is ${existingNode.type}, while link parameters ask for folder.`); }
			// Note that, although we return existing folder node, we should check
			// if link parameters contained correct key. Only holder of a correct
			// key may use existing object.
			(existingNode as FolderNode).crypto.compareKey(params.fKey);
			return (existingNode as FolderNode);
		}

		const src = await storage.getObj(params.objId);
		const key = base64.open(params.fKey);
		return FolderNode.rootFromObjBytes(
			storage, params.folderName, params.objId, src, key);
	}

	static rootFromJSON(
		storage: Storage, name: string|undefined, folderJson: FolderInfoWithAttrs
	): FolderNode {
		const rf = new FolderNode(
			storage, name, 'readonly-root', EMPTY_ARR, 0,
			undefined, (undefined as any), false);
		const { folderInfo, attrs } = jsonToInfoAndAttrs(folderJson);
		rf.currentState = folderInfo;
		rf.attrs = (attrs ? attrs : AttrsHolder.makeReadonlyForFolder(0));
		return rf;
	}

	list(): { lst: ListingEntry[]; version: number; } {
		const names = Object.keys(this.currentState.nodes);
		const lst: ListingEntry[] = new Array(names.length);
		for (let i=0; i < names.length; i+=1) {
			const entity = this.currentState.nodes[names[i]];
			const info: ListingEntry = { name: entity.name };
			if (entity.isFolder) { info.isFolder = true; }
			else if (entity.isFile) { info.isFile = true }
			else if (entity.isLink) { info.isLink = true }
			lst[i] = info;
		}
		return { lst, version: this.version };
	}

	listFolders(): string[] {
		return Object.keys(this.currentState.nodes).filter(
			name => !!this.currentState.nodes[name].isFolder);
	}

	private getNodeInfo(name: string, undefOnMissing = false):
			NodeInfo|undefined {
		const fj = this.currentState.nodes[name];
		if (fj) {
			return fj;
		} else if (undefOnMissing) {
			return;
		} else {
			throw makeFileException(excCode.notFound, name);
		}
	}

	hasChild(childName: string, throwIfMissing = false): boolean {
		return !!this.getNodeInfo(childName, !throwIfMissing);
	}

	/**
	 * @param objId
	 * @return either node (promise for node), or a deferred, which promise has
	 * been registered under a given id, and, therefore, has to be resolved with
	 * node.
	 */
	private getNodeOrArrangePromise<T extends Node>(
		objId: string
	): { nodeOrPromise?: T|Promise<T>, deferred?: Deferred<T> } {
		const { node, nodePromise } =
			this.storage.nodes.getNodeOrPromise<T>(objId);
		if (node) { return { nodeOrPromise: node }; }
		if (nodePromise) { return { nodeOrPromise: nodePromise }; }
		const deferred = defer<T>();
		this.storage.nodes.setPromise(objId, deferred.promise);
		return { deferred };
	}

	async getNode<T extends Node>(
		type: NodeType|undefined, name: string, undefOnMissing = false
	): Promise<T|undefined> {
		const childInfo = this.getNodeInfo(name, undefOnMissing);
		if (!childInfo) { return; }

		if (type) {
			if ((type === 'file') && !childInfo.isFile) {
				throw makeFileException(excCode.notFile, childInfo.name);
			} else if ((type === 'folder') && !childInfo.isFolder) {
				throw makeFileException(excCode.notDirectory, childInfo.name);
			} else if ((type === 'link') && !childInfo.isLink) {
				throw makeFileException(excCode.notLink, childInfo.name);
			}
		}

		const { nodeOrPromise: child, deferred } =
			this.getNodeOrArrangePromise<T>(childInfo.objId);
		if (child) { return child; }
		
		try {
			let node: Node;
			if (childInfo.isFile) {
				node = await FileNode.makeForExisting(
					this.storage, this.objId, name, childInfo.objId, childInfo.key);
			} else if (childInfo.isFolder) {
				const src = await this.storage.getObj(childInfo.objId);

				// const f = new FolderNode(
				// 	this.storage, childInfo.name, childInfo.objId, undefined,
				// 	src.version, this.objId, childInfo.key, false);
				// const { folderInfo, attrs } = await f.crypto.open(src);
				// f.currentState = folderInfo;
				// f.attrs = (attrs ? attrs : AttrsHolder.makeReadonlyForFolder(0));

				node = await FolderNode.readNodeFromObjBytes(
					this.storage, childInfo.name, childInfo.objId, undefined, src, childInfo.key);
			} else if (childInfo.isLink) {
				node = await LinkNode.makeForExisting(
					this.storage, this.objId, name, childInfo.objId, childInfo.key);
			} else {
				throw new Error(`Unknown type of fs node`);
			}
			deferred!.resolve(node as T);
			return node as T;
		} catch (exc) {
			deferred!.reject(exc);
			if (exc.objNotFound) {
				await this.fixMissingChildAndThrow(exc, childInfo);
			}
			throw errWithCause(exc, `Cannot instantiate ${type} node '${this.name}/${childInfo.name}' from obj ${childInfo.objId}`);
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
		await this.doTransition(true, async () => {
			delete this.transitionState.nodes[childInfo.name];
			const event: EntryRemovalEvent = {
				type: 'entry-removal',
				path: this.name,
				name: childInfo.name,
				newVersion: this.transitionVersion
			};
			this.broadcastEvent(event);
		}).catch(noop);
		const fileExc = makeFileException(excCode.notFound, childInfo.name, exc);
		fileExc.inconsistentStateOfFS = true;
		throw fileExc;
	}

	/**
	 * This method prepares a transition state, runs given action, and completes
	 * transition to a new version. Returned promise resolves to whatever given
	 * action returns (promise is unwrapped).
	 * Note that if there is already an ongoing change, this transition will
	 * wait. Such behaviour is generally needed for folder as different processes
	 * may be sharing same elements in a file tree. In contrast, file
	 * operations should more often follow a throw instead wait approach.
	 * @param autoSave true value turns on saving in of transition by this call,
	 * while false value indicates that saving will be done within a given action
	 * @param action is a function that is run when transition is started
	 */
	private doTransition<T>(
		autoSave: boolean, action: () => Promise<T>
	): Promise<T> {
		return this.doChange(true, this.wrapInTransition(autoSave, action));
	}

	private wrapInTransition<T>(
		autoSave: boolean, action: () => Promise<T>
	): () => Promise<T> {
		return async () => {
			
			// start transition and prepare transition state
			// Note on copy: byte arrays are not cloned
			this.transitionState = copy(this.currentState);
			this.transitionVersion = this.version + 1;
			
			try {
				
				// do action within transition state
				const result = await action();

				// return fast, if transaction was canceled
				if (!this.transitionState) { return result; }

				// save transition state, if saving hasn't been done inside of action
				if (autoSave) {
					await this.saveTransitionState();
				}

				// complete transition
				if (!this.transitionSaved) { throw new Error(
					`Transition state has not been saved`); }
				this.currentState = this.transitionState;
				this.setCurrentVersion(this.transitionVersion);
				
				return result;

			} finally {
				// cleanup after both completion and fail
				this.clearTransitionState();
			}
		};
	}

	private clearTransitionState(): void {
		this.transitionState = (undefined as any);
		this.transitionVersion = undefined;
		this.transitionSaved = false;
	}

	private async saveTransitionState(): Promise<void> {
		if (!this.transitionState || !this.transitionVersion) { throw new Error(
			`Transition is not set correctly`); }
		if (this.transitionSaved) { throw new Error(
			`Transition has already been saved.`); }
		const attrs = this.attrs.modifiableCopy();
		const encSub = await this.crypto.pack(
			this.transitionState, this.transitionVersion, attrs);
		await this.storage.saveObj(this.objId, this.transitionVersion, encSub);
		this.transitionSaved = true;
		attrs.setReadonly();
		this.attrs = attrs;
	}

	private addToTransitionState(f: Node, key: Uint8Array): void {
		const nodeInfo: NodeInfo = {
			name: f.name,
			objId: f.objId,
			key
		};
		if (f.type === 'folder') { nodeInfo.isFolder = true; }
		else if (f.type === 'file') { nodeInfo.isFile = true; }
		else if (f.type === 'link') { nodeInfo.isLink = true; }
		else { throw new Error(`Unknown type of file system entity: ${f.type}`); }
		this.transitionState.nodes[nodeInfo.name] = nodeInfo;
	}

	/**
	 * This function only creates folder node, but it doesn't insert it anywhere.
	 * @param name
	 */
	private async makeAndSaveNewChildFolderNode(
		name: string
	): Promise<{ node: FolderNode; key: Uint8Array; }> {
		const key = await random.bytes(KEY_LENGTH);
		const childObjId = await this.storage.generateNewObjId();
		const node = new FolderNode(
			this.storage, name, childObjId, undefined, 0, this.objId, key, true);
		await node.saveFirstVersion().catch((exc: StorageException) => {
			if (!exc.objExists) { throw exc; }
			// call this method recursively, if obj id is already used in storage
			return this.makeAndSaveNewChildFolderNode(name);
		});
		return { node, key };
	}

	private async saveFirstVersion(): Promise<void> {
		await this.doChange(false, async () => {
			if (this.version > 0) { throw new Error(
				`Can call this function only for zeroth version, not ${this.version}`); }
			this.setCurrentVersion(1);
			const attrs = this.attrs.modifiableCopy();
			const encSub = await this.crypto.pack(
				this.currentState, this.version, attrs);
			await this.storage.saveObj(this.objId, this.version, encSub);
			attrs.setReadonly();
			this.attrs = attrs;
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
		await node.setLinkParams(params).catch((exc: StorageException) => {
			if (!exc.objExists) { throw exc; }
			// call this method recursively, if obj id is already used in storage
			return this.makeAndSaveNewChildLinkNode(name, params);
		});
		return { node, key };
	}

	private create<T extends Node>(
		type: NodeType, name: string, exclusive: boolean,
		linkParams?: LinkParameters<any>
	): Promise<T> {
		return this.doTransition(false, async () => {
			// do check for concurrent creation of a node
			if (this.getNodeInfo(name, true)) {
				if (exclusive) {
					throw makeFileException(excCode.alreadyExists, name);
				} else if (type === 'folder') {
					this.clearTransitionState();
					return (await this.getNode<T>('folder', name))!;
				} else if (type === 'file') {
					this.clearTransitionState();
					return (await this.getNode<T>('file', name))!;
				} else if (type === 'link') {
					throw new Error(`Link is created in non-exclusive mode`);
				} else {
					throw new Error(`Unknown type of node: ${type}`);
				}
			}

			// create new node
			let node: Node;
			let key: Uint8Array;
			if (type === 'file') {
				({ node, key } = await this.makeAndSaveNewChildFileNode(name));
			} else if (type === 'folder') {
				({ node, key } = await this.makeAndSaveNewChildFolderNode(name));
			} else if (type === 'link') {
				({ node, key } = await this.makeAndSaveNewChildLinkNode(
					name, linkParams!));
			} else {
				throw new Error(`Unknown type of node: ${type}`);
			}
			this.addToTransitionState(node, key);
			await this.saveTransitionState();	// manual save
			this.storage.nodes.set(node);
			const event: EntryAdditionEvent = {
				type: 'entry-addition',
				path: this.name,
				newVersion: this.transitionVersion,
				entry: {
					name: node.name,
					isFile: (node.type === 'file'),
					isFolder: (node.type === 'folder'),
					isLink: (node.type === 'link')
				}
			};
			this.broadcastEvent(event);
			return node as T;
		});
	}

	createFolder(name: string, exclusive: boolean): Promise<FolderNode> {
		return this.create<FolderNode>('folder', name, exclusive);
	}

	createFile(name: string, exclusive: boolean): Promise<FileNode> {
		return this.create<FileNode>('file', name, exclusive);
	}

	async createLink(name: string, params: LinkParameters<any>): Promise<void> {
		await this.create<LinkNode>('link', name, true, params);
	}

	async removeChild(f: NodeInFS<NodeCrypto, EntityAttrs>): Promise<void> {
		await this.doTransition(true, async () => {
			const childJSON = this.transitionState.nodes[f.name];
			if (!childJSON || (childJSON.objId !== f.objId)) { throw new Error(
				`Not a child given: name==${f.name}, objId==${f.objId}, parentId==${f.parentId}, this folder objId==${this.objId}`); }
			delete this.transitionState.nodes[f.name];
			const event: EntryRemovalEvent = {
				type: 'entry-removal',
				path: this.name,
				name: f.name,
				newVersion: this.transitionVersion
			};
			this.broadcastEvent(event);
		});
		// explicitly do not wait on a result of child's delete, cause if it fails
		// we just get traceable garbage, yet, the rest of a live/non-deleted tree
		// stays consistent
		f.localDelete();
	}

	private changeChildName(initName: string, newName: string): Promise<void> {
		return this.doTransition(true, async () => {
			const child = this.transitionState.nodes[initName];
			delete this.transitionState.nodes[child.name];
			this.transitionState.nodes[newName] = child;
			child.name = newName;
			const childNode = this.storage.nodes.get(child.objId);
			if (childNode) {
				childNode.name = newName;
			}
			const event: EntryRenamingEvent = {
				type: 'entry-renaming',
				path: this.name,
				newName,
				oldName: initName,
				newVersion: this.transitionVersion
			};
			this.broadcastEvent(event);
		});
	}

	async moveChildTo(
		childName: string, dst: FolderNode, nameInDst: string
	): Promise<void> {
		if (dst.hasChild(nameInDst)) {
			throw makeFileException(excCode.alreadyExists, nameInDst); }
		if (dst === this) {
			// In this case we only need to change child's name
			return this.changeChildName(childName, nameInDst);
		}
		const childJSON = this.getNodeInfo(childName)!;
		// we have two transitions here, in this and in dst.
		await Promise.all([
			await dst.moveChildIn(nameInDst, childJSON),
			await this.moveChildOut(childName)
		]);
	}

	private async moveChildOut(name: string): Promise<void> {
		await this.doTransition(true, async () => {
			delete this.transitionState.nodes[name];
			const event: EntryRemovalEvent = {
				type: 'entry-removal',
				path: this.name,
				name,
				newVersion: this.transitionVersion
			};
			this.broadcastEvent(event);
		});
	}

	private async moveChildIn(newName: string, child: NodeInfo): Promise<void> {
		child = copy(child);
		await this.doTransition(true, async () => {
			child.name = newName;
			this.transitionState.nodes[child.name] = child;
			const event: EntryAdditionEvent = {
				type: 'entry-addition',
				path: this.name,
				entry: {
					name: child.name,
					isFile: child.isFile,
					isFolder: child.isFolder,
					isLink: child.isLink
				},
				newVersion: this.transitionVersion
			};
			this.broadcastEvent(event);
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
					throw makeFileException(excCode.alreadyExists, path[0]);
				} else {
					return f;
				}
			}
		} catch (err) {
			if (!(err as FileException).notFound) { throw err; }
			if (!createIfMissing) { throw err; }
			try {
				f = await this.createFolder(path[0], exclusiveCreate);
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

	private async getAllNodes(): Promise<NodeInFS<NodeCrypto, EntityAttrs>[]> {
		const lst = this.list().lst;
		const content: NodeInFS<NodeCrypto, EntityAttrs>[] = [];
		for (const entry of lst) {
			let node: NodeInFS<NodeCrypto, EntityAttrs>|undefined;
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

	protected async delete(remoteEvent?: boolean): Promise<void> {
		if (remoteEvent) {
			return super.delete(true);
		}

		const childrenNodes = await this.getAllNodes();
		await this.storage.removeObj(this.objId);
		this.storage.nodes.delete(this);
		this.setCurrentVersion(-1);
		this.currentState = { nodes: {} };
		const event: RemovedEvent = {
			type: 'removed',
			path: this.name,
			isRemote: remoteEvent
		};
		this.broadcastEvent(event, true);

		// explicitly do not wait on a result of child's delete, cause if it fails
		// we just get traceable garbage, yet, the rest of a live/non-deleted tree
		// stays consistent
		for (const node of childrenNodes) {
			node.localDelete();
		}
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

	// XXX make default conflict resolution for folder
	// async resolveConflict(remoteVersion: number): Promise<void> {
	// 	// XXX we need to read remote version outside of doChange
	// 	const src = await (this.storage as SyncedStorage).getSyncedObjVersion(
	// 		this.objId, remoteVersion);
	// 	const remInfo = await this.crypto.open(src);
	// 	await this.doChange(true, async () => {
	// 		// XXX this is a default conflict resolution
	// 		// XXX drop all previous local versions(!)
	// 	});
	// }

	protected async doOnExternalChange(expectedVersion: number): Promise<void> {
		if (expectedVersion <= this.version) { return; }
		const src = await this.storage.getObj(this.objId);
		const newVersion = src.version;
		if (newVersion <= this.version) { return; }
		const { folderInfo, attrs } = await this.crypto.open(src);
		const initState = this.currentState;
		this.currentState = checkFolderInfo(folderInfo);
		this.setCurrentVersion(newVersion);
		if (attrs) {
			this.attrs = attrs;
		}

		const addedEntries = Object.keys(this.currentState.nodes)
		.filter(name => !initState.nodes[name]);
		const removedEntries = Object.keys(initState.nodes)
		.filter(name => !this.currentState.nodes[name]);
		
		if ((addedEntries.length === 1) && (removedEntries.length === 1)) {
			const event: EntryRenamingEvent = {
				type: 'entry-renaming',
				path: this.name,
				isRemote: true,
				oldName: removedEntries[0],
				newName: addedEntries[0],
				newVersion
			}
			this.broadcastEvent(event);
		} else {
			addedEntries.forEach(name => {
				const addedNode = this.currentState.nodes[name];
				const event: EntryAdditionEvent = {
					type: 'entry-addition',
					path: this.name,
					isRemote: true,
					entry: {
						name: addedNode.name,
						isFile: addedNode.isFile,
						isFolder: addedNode.isFolder,
						isLink: addedNode.isLink
					},
					newVersion
				};
				this.broadcastEvent(event);
			});
			removedEntries.forEach(name => {
				const event: EntryRemovalEvent = {
					type: 'entry-removal',
					path: this.name,
					isRemote: true,
					name,
					newVersion
				};
				this.broadcastEvent(event);
			});
		}
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

Object.freeze(exports);