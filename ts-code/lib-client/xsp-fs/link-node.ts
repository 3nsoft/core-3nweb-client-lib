/*
 Copyright (C) 2016 - 2018, 2020, 2022 3NSoft Inc.
 
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

import { NodeInFS, shouldReadCurrentVersion } from './node-in-fs';
import { utf8 } from '../../lib-common/buffer-utils';
import { LinkParameters } from '../fs-utils/files';
import { DeviceFS } from '../local-files/device-fs';
import { FileLinkParams } from './file-node';
import { FolderLinkParams } from './folder-node';
import { Storage, AsyncSBoxCryptor } from './common';
import { FileObject } from './file';
import { XspFS } from './fs';
import { idToHeaderNonce, ObjSource, Subscribe } from 'xsp-files';
import { CommonAttrs, XAttrs } from './attrs';
import { Attrs, NodePersistance } from './node-persistence';

type VersionedReadFlags = web3n.files.VersionedReadFlags;
type Stats = web3n.files.Stats;

class LinkPersistance extends NodePersistance {
	
	constructor(zNonce: Uint8Array, key: Uint8Array, cryptor: AsyncSBoxCryptor) {
		super(zNonce, key, cryptor);
		Object.seal(this);
	}

	async read(src: ObjSource): Promise<{
		params: LinkParameters<any>; attrs: CommonAttrs; xattrs?: XAttrs;
	}> {
		const { content, attrs, xattrs } = await super.readAll(src);
		if (!content) { throw `Cannot open link object`; }
		const params = formatV1.parse(content);
		return { params, xattrs, attrs: CommonAttrs.fromAttrs(attrs) };
	}

	async write(
		params: LinkParameters<any>, version: number,
		attrs: CommonAttrs, xattrs: XAttrs|undefined
	): Promise<Subscribe> {
		return super.writeWhole(formatV1.pack(params), version, attrs, xattrs);
	}

}
Object.freeze(LinkPersistance.prototype);
Object.freeze(LinkPersistance);


type SymLink = web3n.files.SymLink;
type XAttrsChanges = web3n.files.XAttrsChanges;

function makeFileSymLink(
	storage: Storage, params: LinkParameters<FileLinkParams>
): SymLink {
	const sl: SymLink = {
		isFile: true,
		readonly: !!params.readonly,
		target: () => FileObject.makeFileFromLinkParams(storage, params)
	};
	return Object.freeze(sl);
}

function makeFolderSymLink(
	storage: Storage, params: LinkParameters<FolderLinkParams>
): SymLink {
	const sl: SymLink = {
		isFolder: true,
		readonly: !!params.readonly,
		target: () => XspFS.makeFolderFromLinkParams(storage, params)
	};
	return Object.freeze(sl);
}

function makeLinkToStorage(
	storage: Storage, params: LinkParameters<any>
): SymLink {
	if (params.isFolder) {
		return makeFolderSymLink(storage, params);
	} else if (params.isFile) {
		return makeFileSymLink(storage, params);
	} else {
		throw new Error(`Invalid link parameters`);
	}
}


export class LinkNode extends NodeInFS<LinkPersistance> {

	private linkParams: LinkParameters<any> = (undefined as any);

	constructor(
		storage: Storage, name: string, objId: string, version: number,
		parentId: string|undefined, key: Uint8Array
	) {
		super(storage, 'link', name, objId, version, parentId);
		if (!name || !objId || !parentId) { throw new Error(
			"Bad link parameter(s) given"); }
		this.crypto = new LinkPersistance(
			idToHeaderNonce(this.objId), key, this.storage.cryptor);
		Object.seal(this);
	}

	static async makeForNew(
		storage: Storage, parentId: string, name: string, key: Uint8Array
	): Promise<LinkNode> {
		const objId = await storage.generateNewObjId();
		const link = new LinkNode(storage, name, objId, 0, parentId, key);
		link.attrs = CommonAttrs.makeForTimeNow();
		return link;
	}

	static async makeForExisting(
		storage: Storage, parentId: string, name: string,
		objId: string, key: Uint8Array
	): Promise<LinkNode> {
		const src = await storage.getObjSrc(objId);
		const link = new LinkNode(
			storage, name, objId, src.version, parentId, key);
		const { params, attrs, xattrs } = await link.crypto.read(src);
		link.setUpdatedState(params, src.version, attrs, xattrs);
		link.setCurrentStateFrom(src);
		return link;
	}

	protected async setCurrentStateFrom(src: ObjSource): Promise<void> {
		const { params, attrs, xattrs } = await this.crypto.read(src);
		this.setUpdatedState(params, src.version, attrs, xattrs);
	}

	async getStats(flags?: VersionedReadFlags): Promise<Stats> {
		let attrs: CommonAttrs|Attrs;
		let version: number;
		if (shouldReadCurrentVersion(flags)) {
			attrs = this.attrs;
			version = this.version;
		} else {
			const src = await this.getObjSrcOfVersion(flags);
			attrs = await this.crypto.getAttrs(src);
			version = src.version;
		}
		return {
			ctime: new Date(attrs.ctime),
			mtime: new Date(attrs.mtime),
			version,
			writable: false,
			isLink: true,
		};
	}

	private setUpdatedState(
		params: LinkParameters<any>,
		version: number, attrs: CommonAttrs, xattrs: XAttrs|undefined
	): void {
		this.linkParams = params;
		super.setUpdatedParams(version, attrs, xattrs);
	}

	async save(
		params: LinkParameters<any>, changes?: XAttrsChanges
	): Promise<void> {
		if (this.linkParams) { throw new Error(
			'Cannot set link parameters second time'); }
		return this.doChange(false, async () => {
			// prepare data for recording
			const { attrs, xattrs, newVersion } = this.getParamsForUpdate(changes);
			// save/record
			const sinkSub = await this.crypto.write(
				params, newVersion, attrs, xattrs);
			await this.storage.saveObj(this.objId, newVersion, sinkSub);
			// set updated data in the node
			this.setUpdatedState(params, newVersion, attrs, xattrs);
		});
	}

	private async getLinkParams(): Promise<LinkParameters<any>> {
		if (this.linkParams) { return this.linkParams; }
		// there is a chance that link setting is in progress,
		// we should wait on a change
		await this.doChange(false, async () => {});
		if (this.linkParams) {
			return this.linkParams;
		} else {
			throw new Error(`Link parameters are not set, yet`);
		}
	}

	async read(): Promise<SymLink> {
		const params = await this.getLinkParams();
		if (params.storageType === 'synced') {
			return this.makeLinkToSyncedStorage(params);
		} else if (params.storageType === 'local') {
			return this.makeLinkToLocalStorage(params);
		} else if (params.storageType === 'device') {
			return this.makeLinkToDevice(params);
		} else if (params.storageType === 'share') {
			return this.makeLinkToSharedStorage(params);
		} else {
			throw new Error(`Link to ${params.storageType} are not implemented.`);
		}
	}

	private makeLinkToSharedStorage(params: LinkParameters<any>): SymLink {
		if (params.storageType === this.storage.type) {
			return makeLinkToStorage(this.storage, params);
		} else if ((this.storage.type === 'local') ||
				(this.storage.type === 'synced')) {
			const storage = this.storage.storageForLinking('share');
			return makeLinkToStorage(storage, params);
		} else {
			throw new Error(`Link to ${params.storageType} storage is not supposed to be present in ${this.storage.type} storage.`);
		}
	}

	private makeLinkToLocalStorage(params: LinkParameters<any>): SymLink {
		if (params.storageType === this.storage.type) {
			return makeLinkToStorage(this.storage, params);
		} else {
			throw new Error(`Link to ${params.storageType} storage is not supposed to be present in ${this.storage.type} storage.`);
		}
	}

	private makeLinkToSyncedStorage(params: LinkParameters<any>): SymLink {
		if (params.storageType === this.storage.type) {
			return makeLinkToStorage(this.storage, params);
		} else if (this.storage.type === 'local') {
			const storage = this.storage.storageForLinking('synced');
			return makeLinkToStorage(storage, params);
		} else {
			throw new Error(`Link to ${params.storageType} storage is not supposed to be present in ${this.storage.type} storage.`);
		}
	}

	private makeLinkToDevice(params: LinkParameters<any>): SymLink {
		if (this.storage.type !== 'local') { throw new Error(
			`Link to ${params.storageType} storage is not supposed to be present in ${this.storage.type} storage.`); }
		if (params.isFolder) {
			return DeviceFS.makeFolderSymLink(params);
		} else if (params.isFile) {
			return DeviceFS.makeFileSymLink(params);
		} else {
			throw new Error(`Invalid link parameters`);
		}
	}

}
Object.freeze(LinkNode.prototype);
Object.freeze(LinkNode);


namespace formatV1 {

	// XXX make proper type version check

	export function pack(params: LinkParameters<any>): Uint8Array {
		return utf8.pack(JSON.stringify(params));
	}

	export function parse(bytes: Uint8Array): LinkParameters<any> {
		const params = JSON.parse(utf8.open(bytes)) as LinkParameters<any>;
		return params;
	}

}
Object.freeze(formatV1);


Object.freeze(exports);