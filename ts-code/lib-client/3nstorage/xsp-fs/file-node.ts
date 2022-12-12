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

import { NodeInFS } from './node-in-fs';
import { LinkParameters } from '../../files';
import { Storage, AsyncSBoxCryptor } from './common';
import { base64, byteLengthIn } from '../../../lib-common/buffer-utils';
import { defer } from '../../../lib-common/processes/deferred';
import { idToHeaderNonce, Subscribe, ObjSource } from 'xsp-files';
import { assert } from '../../../lib-common/assert';
import { CommonAttrs, XAttrs } from './attrs';
import { makeVersionMismatchExc } from '../../../lib-common/exceptions/file';
import { NodePersistance, ReadonlyPayload } from './node-persistence';

type FileByteSource = web3n.files.FileByteSource;
type FileByteSink = web3n.files.FileByteSink;
type XAttrsChanges = web3n.files.XAttrsChanges;
type VersionedReadFlags = web3n.files.VersionedReadFlags;

interface FileAttrs {
	attrs: CommonAttrs;
	size: number;
	xattrs?: XAttrs;
}

async function fileAttrsFrom(payload: ReadonlyPayload): Promise<FileAttrs> {
	const attrs = payload.getAttrs();
	const xattrs = await payload.getXAttrs();
	return { attrs: CommonAttrs.fromAttrs(attrs), size: attrs.size, xattrs };
}


class FilePersistance extends NodePersistance {

	constructor(zNonce: Uint8Array, key: Uint8Array, cryptor: AsyncSBoxCryptor) {
		super(zNonce, key, cryptor);
		Object.seal(this);
	}

	async getAttrs(objSrc: ObjSource): Promise<FileAttrs> {
		const payload = await super.readonlyPayload(objSrc);
		return await fileAttrsFrom(payload);
	}

	async getFileSource(objSrc: ObjSource): Promise<FileByteSource> {
		const payload = await this.readonlyPayload(objSrc);
		return payload.makeFileByteSource();
	}

	async readBytes(
		objSrc: ObjSource, start: number|undefined, end: number|undefined
	): Promise<Uint8Array|undefined> {
		if ((typeof start === 'number') && (start < 0)) { throw new Error(
			`Parameter start has bad value: ${start}`); }
		if ((typeof end === 'number') && (end < 0)) { throw new Error(
			`Parameter end has bad value: ${end}`); }
		const payload = await this.readonlyPayload(objSrc);
		const size = payload.getAttrs().size;
		if (start === undefined) {
			start = 0;
			end = size;
		} else if (start >= size) {
			return;
		}
		if (typeof end === 'number') {
			end = Math.min(size, end);
			if (end <= start) {
				return;
			}
		} else {
			end = size;
		}
		return await payload.readSomeContentBytes(start, end);
	}

	async saveBytes(
		bytes: Uint8Array|Uint8Array[], version: number,
		attrs: CommonAttrs, xattrs: XAttrs|undefined
	): Promise<Subscribe> {
		return super.writeWhole(bytes, version, attrs, xattrs);
	}

	async getFileSink(
		version: number, attrs: CommonAttrs, xattrs: XAttrs|undefined,
		base: ObjSource|undefined
	): Promise<{ sinkPromise: Promise<FileByteSink>; sub: Subscribe; }> {
		return await super.writableSink(version, attrs, xattrs, base);
	}

}
Object.freeze(FilePersistance.prototype);
Object.freeze(FilePersistance);


export interface FileLinkParams {
	fileName: string;
	objId: string;
	fKey: string;
}


export class FileNode extends NodeInFS<FilePersistance> {

	private fileSize = 0;

	private constructor(
		storage: Storage, fileName: string, objId: string, version: number,
		parentId: string|undefined, key: Uint8Array
	) {
		super(storage, 'file', fileName, objId, version, parentId);
		if (!fileName || !objId) {
			throw new Error("Bad file parameter(s) given");
		}
		this.crypto = new FilePersistance(
			idToHeaderNonce(this.objId), key, this.storage.cryptor
		);
		Object.seal(this);
	}

	static async makeForNew(
		storage: Storage, parentId: string, name: string, key: Uint8Array
	): Promise<FileNode> {
		if (!parentId) { throw new Error("Bad parent id"); }
		const objId = await storage.generateNewObjId();
		const file = new FileNode(storage, name, objId, 0, parentId, key);
		file.attrs = CommonAttrs.makeForTimeNow();
		return file;
	}

	static async makeForExisting(
		storage: Storage, parentId: string, fileName: string,
		objId: string, key: Uint8Array
	): Promise<FileNode> {
		if (!parentId) { throw new Error("Bad parent id"); }
		const file = await FileNode.initWithAttrs(
			storage, parentId, fileName, objId, key
		);
		return file;
	}

	static async makeFromLinkParams(
		storage: Storage, params: FileLinkParams
	): Promise<FileNode> {
		const { objId, fileName } = params;
		const key = base64.open(params.fKey);
		const file = await FileNode.initWithAttrs(
			storage, undefined, fileName, objId, key);
		return file;
	}

	private static async initWithAttrs(
		storage: Storage, parentId: string|undefined, fileName: string,
		objId: string, key: Uint8Array
	): Promise<FileNode> {
		const src = await storage.getObjSrc(objId);
		const file = new FileNode(
			storage, fileName, objId, src.version, parentId, key
		);
		await file.setCurrentStateFrom(src);
		return file;
	}

	protected async setCurrentStateFrom(src: ObjSource): Promise<void> {
		const fileAttrs = await this.crypto.getAttrs(src);
		this.setUpdatedState(src.version, fileAttrs);
	}

	private setUpdatedState(version: number, fileAttrs: FileAttrs): void {
		this.fileSize = fileAttrs.size;
		super.setUpdatedParams(version, fileAttrs.attrs, fileAttrs.xattrs);
	}

	get size(): number {
		return this.fileSize;
	}

	async readSrc(
		flags: VersionedReadFlags|undefined
	): Promise<{ src: FileByteSource; version: number; }> {
		const objSrc = await this.getObjSrcOfVersion(flags);
		let version: number;
		if ((this.storage.type === 'synced')
		|| (this.storage.type === 'local')
		|| (this.storage.type === 'share')) {
			version = objSrc.version;
		} else {
			version = (undefined as any);
		}
		const src = await this.crypto.getFileSource(objSrc);
		return { src, version };
	}

	async readBytes(
		start: number|undefined, end: number|undefined,
		flags: VersionedReadFlags|undefined
	): Promise<{ bytes: Uint8Array|undefined; version: number; }> {
		const objSrc = await this.getObjSrcOfVersion(flags);
		let version: number;
		if ((this.storage.type === 'synced')
		|| (this.storage.type === 'local')
		|| (this.storage.type === 'share')) {
			version = objSrc.version;
		} else {
			version = (undefined as any);
		}
		const bytes = await this.crypto.readBytes(objSrc, start, end);
		return { bytes, version };
	}

	async writeSink(
		truncate: boolean|undefined, currentVersion: number|undefined,
		changes?: XAttrsChanges
	): Promise<{ sink: FileByteSink; version: number; }> {
		const deferredSink = defer<Promise<FileByteSink>>();
		const newSize = defer<number>();
		let version = 0;	// need to set any value to satisfy compiler

		const completion = this.doChange(false, async () => {
			const {
				attrs, xattrs, newVersion, sinkPromise, sub
			} = await this.startMakingSinkInsideChange(
				truncate, currentVersion, changes
			);
			version = newVersion;
			deferredSink.resolve(sinkPromise);
			await this.savingObjInsideChange(
				attrs, newSize.promise, xattrs, newVersion, sub
			);
		});

		let sink: FileByteSink = (undefined as any);
		// race allows to either get sink or threw possible errors from completion
		await Promise.race([
			deferredSink.promise.then(async sinkPromise => {
				sink = await sinkPromise;
			}),
			completion
		]);
		assert(!!sink);

		// sink's done should await completion of obj saving, and
		// error in obj saving should cancel sink
		const originalDone = sink.done;
		completion.catch(originalDone);
		assert(!Object.isFrozen(sink), `Can't mutate frozen sink`);
		sink.done = async (err?: any): Promise<void> => {
			if (err) {
				newSize.resolve(0);
				await originalDone(err);
				await completion.catch(noop);
			} else {
				const size = await sink.getSize();
				newSize.resolve(size);
				await originalDone();
				await completion;
			}
		};
		return { sink, version };
	}

	private async startMakingSinkInsideChange(
		truncate: boolean|undefined, currentVersion: number|undefined,
		changes?: XAttrsChanges
	): Promise<{
		attrs: CommonAttrs; xattrs?: XAttrs; newVersion: number; sub: Subscribe;
		sinkPromise: Promise<FileByteSink>;
	}> {
		if ((typeof currentVersion === 'number')
		&& (this.version !== currentVersion)) {
			throw makeVersionMismatchExc(this.name);
		}
		const { attrs, xattrs, newVersion } = super.getParamsForUpdate(changes);
		const base = ((truncate || (this.version === 0)) ?
			undefined :
			await this.storage.getObjSrc(this.objId));
		const {
			sinkPromise, sub
		} = await this.crypto.getFileSink(newVersion, attrs, xattrs, base);
		return { attrs, xattrs, newVersion, sinkPromise, sub };
	}

	private async savingObjInsideChange(
		attrs: CommonAttrs, newSize: Promise<number>, xattrs: XAttrs|undefined,
		newVersion: number, encSub: Subscribe
	): Promise<void> {
		await this.storage.saveObj(this.objId, newVersion, encSub);
		const size = await newSize;
		this.setUpdatedState(newVersion, { attrs, size, xattrs });
		this.broadcastEvent({
			type: 'file-change',
			path: this.name,
			src: 'local',
			newVersion
		});
	}

	save(
		bytes: Uint8Array|Uint8Array[], changes?: XAttrsChanges
	): Promise<number> {
		return this.doChange(false, async () => {
			const {
				attrs, xattrs, newVersion
			} = super.getParamsForUpdate(changes);
			const encSub = await this.crypto.saveBytes(
				bytes, newVersion, attrs, xattrs);
			const newSize = Promise.resolve(Array.isArray(bytes) ?
				byteLengthIn(bytes) : bytes.length);
			await this.savingObjInsideChange(
				attrs, newSize, xattrs, newVersion, encSub);
			return this.version;
		});
	}

	getParamsForLink(): LinkParameters<FileLinkParams> {
		if ((this.storage.type !== 'synced') && (this.storage.type !== 'local')) {
			throw new Error(`Creating link parameters to object in ${this.storage.type} file system, is not implemented.`);
		}
		const params: FileLinkParams = {
			fileName: (undefined as any),
			objId: this.objId,
			fKey: this.crypto.fileKeyInBase64()
		};
		const linkParams: LinkParameters<FileLinkParams> = {
			storageType: this.storage.type,
			isFile: true,
			params
		};
		return linkParams;
	}

}
Object.freeze(FileNode.prototype);
Object.freeze(FileNode);


function noop () {}

Object.freeze(exports);