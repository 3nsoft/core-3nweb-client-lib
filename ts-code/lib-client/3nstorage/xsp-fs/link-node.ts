/*
 Copyright (C) 2016 - 2018, 2020 3NSoft Inc.
 
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

import { NodeInFS, NodeCrypto } from './node-in-fs';
import { utf8, toBuffer } from '../../../lib-common/buffer-utils';
import { errWithCause } from '../../../lib-common/exceptions/error';
import { LinkParameters } from '../../files';
import { DeviceFS } from '../../local-files/device-fs';
import { FileLinkParams } from './file-node';
import { FolderLinkParams } from './folder-node';
import { Storage, AsyncSBoxCryptor } from './common';
import { FileObject } from './file';
import { XspFS } from './fs';
import { idToHeaderNonce, ObjSource } from 'xsp-files';
import { markTransferable } from '../../../lib-common/mark-transferable';
import { LinkAttrs, AttrsHolder } from '../../files/file-attrs';

class LinkCrypto extends NodeCrypto {
	
	constructor(zNonce: Uint8Array, key: Uint8Array, cryptor: AsyncSBoxCryptor) {
		super(zNonce, key, cryptor);
		Object.seal(this);
	}
	
	async readLinkParams(
		src: ObjSource
	): Promise<{ params: LinkParameters<any>; attrs?: AttrsHolder<LinkAttrs> }> {
		try {
			const { content, attrs } = await this.readBytes(src);
			const params = JSON.parse(utf8.open(content));
			if (attrs) {
				return {
					params,
					attrs: AttrsHolder.fromBytesReadonly<LinkAttrs>(attrs)
				};
			} else {
				return { params };
			}
		} catch (exc) {
			throw errWithCause(exc, `Cannot open link object`);
		}
	}

}
Object.freeze(LinkCrypto.prototype);
Object.freeze(LinkCrypto);

type SymLink = web3n.files.SymLink;

function makeFileSymLink(
	storage: Storage, params: LinkParameters<FileLinkParams>
): SymLink {
	const sl: SymLink = {
		isFile: true,
		readonly: !!params.readonly,
		target: () => FileObject.makeFileFromLinkParams(storage, params)
	};
	return Object.freeze(markTransferable(sl, 'SimpleObject'));
}

function makeFolderSymLink(
	storage: Storage, params: LinkParameters<FolderLinkParams>
): SymLink {
	const sl: SymLink = {
		isFolder: true,
		readonly: !!params.readonly,
		target: () => XspFS.makeFolderFromLinkParams(storage, params)
	};
	return Object.freeze(markTransferable(sl, 'SimpleObject'));
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

export class LinkNode extends NodeInFS<LinkCrypto, LinkAttrs> {

	private linkParams: any = (undefined as any);

	constructor(
		storage: Storage, name: string, objId: string, version: number,
		parentId: string|undefined, key: Uint8Array
	) {
		super(storage, 'link', name, objId, version, parentId);
		if (!name || !objId || !parentId) { throw new Error(
			"Bad link parameter(s) given"); }
		this.crypto = new LinkCrypto(
			idToHeaderNonce(this.objId), key, this.storage.cryptor);
		this.attrs = AttrsHolder.makeReadonlyForLink(Date.now());
		Object.seal(this);
	}

	static async makeForNew(
		storage: Storage, parentId: string, name: string, key: Uint8Array
	): Promise<LinkNode> {
		const objId = await storage.generateNewObjId();
		const link = new LinkNode(storage, name, objId, 0, parentId, key);
		link.attrs = AttrsHolder.makeReadonlyForLink(Date.now());
		return link;
	}

	static async makeForExisting(
		storage: Storage, parentId: string, name: string,
		objId: string, key: Uint8Array
	): Promise<LinkNode> {
		const src = await storage.getObj(objId);
		const link = new LinkNode(
			storage, name, objId, src.version, parentId, key);
		const { params, attrs } = await link.crypto.readLinkParams(src);
		link.linkParams = params;
		link.attrs = (attrs ? attrs : AttrsHolder.makeReadonlyForLink(0));
		return link;
	}

	async setLinkParams(params: LinkParameters<any>): Promise<void> {
		if (this.linkParams) { throw new Error(
			'Cannot set link parameters second time'); }
		return this.doChange(false, async () => {
			const newVersion = this.version + 1;
			this.linkParams = params;
			const bytes = utf8.pack(JSON.stringify(params));
			const attrs = this.attrs.modifiableCopy();
			const sinkSub = await this.crypto.saveBytes(bytes, newVersion, attrs);
			await this.storage.saveObj(this.objId, newVersion, sinkSub);
			this.setCurrentVersion(newVersion);
			attrs.setReadonly();
			this.attrs = attrs;
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

Object.freeze(exports);