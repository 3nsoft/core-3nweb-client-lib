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

import { NodeInFS, NodeCrypto } from './node-in-fs';
import { LinkParameters } from '../../files';
import { Storage, AsyncSBoxCryptor } from './common';
import { base64, byteLengthIn } from '../../../lib-common/buffer-utils';
import { defer, sleep } from '../../../lib-common/processes';
import { idToHeaderNonce, Subscribe, ObjSource, makeEncryptingByteSinkWithAttrs, SegmentsWriter, ByteSource } from 'xsp-files';
import { assert } from '../../../lib-common/assert';
import { FileBytes } from '../../files/file-source';
import { FileSink } from '../../files/file-sink';
import { FileAttrs, AttrsHolder } from '../../files/file-attrs';
import { RWFileLayout } from '../../files/file-layout';
import { makeVersionMismatchExc } from '../../../lib-common/exceptions/file';

type FileByteSource = web3n.files.FileByteSource;
type FileByteSink = web3n.files.FileByteSink;

class FileCrypto extends NodeCrypto {

	constructor(zNonce: Uint8Array, key: Uint8Array, cryptor: AsyncSBoxCryptor) {
		super(zNonce, key, cryptor);
		Object.seal(this);
	}

	async getAttrsAndByteSrc(
		src: ObjSource
	): Promise<{ attrs?: AttrsHolder<FileAttrs>; attrsByteSize?: number;
			byteSrc: ByteSource; }> {
		const { byteSrc, attrsBytes } = await super.getAttrsAndByteSrc(src);
		if (attrsBytes) {
			return {
				byteSrc,
				attrs: AttrsHolder.fromBytesReadonly(attrsBytes),
				attrsByteSize: attrsBytes.length
			};
		} else {
			return { byteSrc };
		}
	}

	async decryptedBytesSource(
		src: ObjSource
	): Promise<{ fileSrc: FileByteSource; attrs?: AttrsHolder<FileAttrs>; }> {
		const { byteSrc, attrs } = await this.getAttrsAndByteSrc(src);
		const fileSrc = await FileBytes.from(byteSrc, attrs);

		return { attrs, fileSrc };
	}

	async saveBytes(
		bytes: Uint8Array|Uint8Array[], version: number, attrs: AttrsHolder<any>
	): Promise<Subscribe> {
		attrs.setContinuousFileSize(Array.isArray(bytes) ?
			byteLengthIn(bytes) : bytes.length);
		return super.saveBytes(bytes, version, attrs);
	}

	async encryptingByteSink(
		version: number, attrs: AttrsHolder<FileAttrs>, base: ObjSource|undefined
	): Promise<{ sinkDef: Promise<FileByteSink>;
			cancelSinkDef: (err: any) => void; sub: Subscribe; }> {
		attrs.mtime = Date.now();
		let writer: SegmentsWriter;
		let baseAttrsSize: number|undefined;
		let layout: RWFileLayout;
		let initLayoutOfs: number|undefined;
		if (base) {
			writer = await this.segWriterWithBase(version, base);
			const { byteSrc: baseSrc, attrs: baseAttrs, attrsByteSize } =
				await this.getAttrsAndByteSrc(base);
			baseAttrsSize = (baseAttrs ? attrsByteSize : 0);
			if (baseAttrs) {
				initLayoutOfs = baseAttrs.getFileSize();
				if (typeof initLayoutOfs === 'number') {
					layout = RWFileLayout.orderedWithBaseSize(initLayoutOfs);
				} else {
					initLayoutOfs = baseAttrs.getFileLayoutOfs();
					if (typeof initLayoutOfs !== 'number') {
						throw new Error(`File attributes have neither file size, nor pointer to layout`);
					}
					layout = await RWFileLayout.readFromSrc(
						baseSrc, initLayoutOfs);
				}
			} else {
				const { size } = await baseSrc.getSize();
				initLayoutOfs = size;
				layout = RWFileLayout.orderedWithBaseSize(size);
			}
		} else {
			writer = await this.segWriter(version);
			baseAttrsSize = undefined;
			initLayoutOfs = undefined;
			layout = RWFileLayout.orderedWithBaseSize(0);
		}
		const { sink, sub: originalSub } = makeEncryptingByteSinkWithAttrs(
			writer, baseAttrsSize);
		const deferredFileSink = defer<FileByteSink>();
		return {
			sub: obs => {
				const unsub = originalSub(obs);
				FileSink.from(sink, attrs, layout).then(
					sink => deferredFileSink.resolve(sink),
					err => deferredFileSink.reject(err));
				return unsub;
			},
			sinkDef: deferredFileSink.promise,
			cancelSinkDef: deferredFileSink.reject
		};
	}

}
Object.freeze(FileCrypto.prototype);
Object.freeze(FileCrypto);


export interface FileLinkParams {
	fileName: string;
	objId: string;
	fKey: string;
}


export class FileNode extends NodeInFS<FileCrypto, FileAttrs> {

	private constructor(
		storage: Storage, fileName: string, objId: string, version: number,
		parentId: string|undefined, key: Uint8Array
	) {
		super(storage, 'file', fileName, objId, version, parentId);
		if (!fileName || !objId) { throw new Error(
			"Bad file parameter(s) given"); }
		this.crypto = new FileCrypto(
			idToHeaderNonce(this.objId), key, this.storage.cryptor);
		Object.seal(this);
	}

	static async makeForNew(
		storage: Storage, parentId: string, name: string, key: Uint8Array
	): Promise<FileNode> {
		if (!parentId) { throw new Error("Bad parent id"); }
		const objId = await storage.generateNewObjId();
		const file = new FileNode(storage, name, objId, 0, parentId, key);
		file.attrs = AttrsHolder.makeReadonlyForFile(Date.now());
		return file;
	}

	static async makeForExisting(
		storage: Storage, parentId: string, fileName: string,
		objId: string, key: Uint8Array
	): Promise<FileNode> {
		if (!parentId) { throw new Error("Bad parent id"); }
		const file = await FileNode.initWithAttrs(
			storage, parentId, fileName, objId, key);
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
		const src = await storage.getObj(objId);
		const file = new FileNode(
			storage, fileName, objId, src.version, parentId, key);
		const { attrs } = await file.crypto.getAttrsAndByteSrc(src);
		file.attrs = (attrs ?
			attrs : AttrsHolder.makeReadonlyForFile(Date.now()));
		return file;
	}

	async readSrc(): Promise<{ src: FileByteSource; version: number; }> {
		const objSrc = await this.storage.getObj(this.objId);
		const { fileSrc: src } = await this.crypto.decryptedBytesSource(objSrc);
		let version: number;
		if ((this.storage.type === 'synced') || (this.storage.type === 'local')) {
			version = objSrc.version;
			if (this.version < version) {
				this.setCurrentVersion(version);
			}
		} else {
			// unversioned storage passes undefined version
			version = (undefined as any);
		}
		return { src, version };
	}

	async writeSink(
		truncate: boolean|undefined, currentVersion: number|undefined
	): Promise<{ sink: FileByteSink; version: number; }> {
		const deferredSink = defer<{ sinkPromise: Promise<FileByteSink>; }>();
		let newVersion = 0;	// need to set any value to satisfy compiler

		const completion = this.doChange(false, async () => {
			const step1 = await this.startMakingSinkInsideChange(
				truncate, currentVersion
			).catch(err => {
				deferredSink.reject(err);
				throw err;
			});
			newVersion = step1.newVersion;
			deferredSink.resolve({ sinkPromise: step1.sinkDef });
			await this.savingObjInsideChange(
				step1.attrs, step1.newVersion, step1.sub
			).catch(err => {
				step1.cancelSinkDef(err);
				throw err;
			});
		});

		// in case overall completion is never waited, if early error comes
		completion.catch(noop);

		// explicitly await two steps to get all possible errors
		const sDef = await deferredSink.promise;	// after await newVersion is set
		const sink = await sDef.sinkPromise;

		// sink's done should await completion of obj saving, and
		// error in obj saving should cancel sink
		const originalDone = sink.done;
		completion.catch(originalDone);
		assert(!Object.isFrozen(sink), `Can't mutate frozen sink`);
		sink.done = async (err?: any): Promise<void> => {
			if (err) {
				await originalDone(err);
			} else {
				await originalDone();
				await completion;
			}
		};
		return {
			sink,
			version: newVersion
		};
	}

	private async startMakingSinkInsideChange(
		truncate: boolean|undefined, currentVersion: number|undefined
	): Promise<{ attrs: AttrsHolder<FileAttrs>; newVersion: number;
			sinkDef: Promise<FileByteSink>; sub: Subscribe;
			cancelSinkDef: (err: any) => void; }> {
		if ((typeof currentVersion === 'number')
		&& (this.version !== currentVersion)) {
			throw makeVersionMismatchExc(this.name);
		}
		const newVersion = this.version + 1;
		const attrs = this.attrs.modifiableCopy();
		const base = ((truncate || (this.version === 0)) ?
			undefined :
			await this.storage.getObj(this.objId));
		const { sinkDef, sub, cancelSinkDef } =
			await this.crypto.encryptingByteSink(newVersion, attrs, base);
		return { attrs, newVersion, sinkDef, sub, cancelSinkDef };
	}

	private async savingObjInsideChange(
		attrs: AttrsHolder<FileAttrs>, newVersion: number, encSub: Subscribe
	): Promise<void> {
		await this.storage.saveObj(this.objId, newVersion, encSub);
		this.setCurrentVersion(newVersion);
		attrs.setReadonly();
		this.attrs = attrs;
		this.broadcastEvent({
			type: 'file-change',
			path: this.name,
			newVersion
		});
	}

	save(bytes: Uint8Array|Uint8Array[]): Promise<number> {
		return this.doChange(false, async () => {
			const newVersion = this.version + 1;
			const attrs = this.attrs.modifiableCopy();
			const encSub = await this.crypto.saveBytes(bytes, newVersion, attrs);
			await this.savingObjInsideChange(attrs, newVersion, encSub);
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