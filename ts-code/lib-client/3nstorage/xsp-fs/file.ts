/*
 Copyright (C) 2016 - 2020, 2022 3NSoft Inc.
 
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

import { makeFileException, Code as excCode } from '../../../lib-common/exceptions/file';
import { Linkable, LinkParameters, wrapReadonlyFile, wrapWritableFile } from '../../files';
import { FileNode, FileLinkParams } from './file-node';
import { utf8 } from '../../../lib-common/buffer-utils';
import { Storage } from './common';
import { pipe } from '../../../lib-common/byte-streaming/pipe';
import { toRxObserver } from '../../../lib-common/utils-for-observables';

type Stats = web3n.files.Stats;
type File = web3n.files.File;
type WritableFile = web3n.files.WritableFile;
type ReadonlyFile = web3n.files.ReadonlyFile;
type FileEvent = web3n.files.FileEvent;
type Observer<T> = web3n.Observer<T>;
type FileByteSource = web3n.files.FileByteSource;
type FileByteSink = web3n.files.FileByteSink;
type XAttrsChanges = web3n.files.XAttrsChanges;


export class FileObject implements WritableFile, Linkable {

	v: V;

	private constructor(
		public name: string,
		public isNew: boolean,
		node: FileNode|undefined,
		makeOrGetNode: (() => Promise<FileNode>)|undefined,
		public writable: boolean
	) {
		this.v = new V(name, node, makeOrGetNode, writable);
		Object.seal(this);
	}

	static makeExisting(
		node: FileNode, writable: boolean
	): WritableFile|ReadonlyFile {
		const f = new FileObject(node.name, false, node, undefined, writable);
		return (writable ?
			wrapWritableFile(f) : wrapReadonlyFile(f));
	}

	static makeForNotExisiting(
		name: string, makeNode: () => Promise<FileNode>
	): WritableFile {
		const f = new FileObject(name, true, undefined, makeNode, true);
		return wrapWritableFile(f);
	}

	static async makeFileFromLinkParams(
		storage: Storage, params: LinkParameters<FileLinkParams>
	): Promise<WritableFile|ReadonlyFile> {
		const node = await FileNode.makeFromLinkParams(storage, params.params);
		return FileObject.makeExisting(node, !params.readonly);
	}

	async getLinkParams(): Promise<LinkParameters<FileLinkParams>> {
		if (!this.v.node) { throw new Error(
			'File does not exist, yet, and cannot be linked.'); }
		const linkParams = this.v.node.getParamsForLink();
		linkParams.params.fileName = this.name;
		linkParams.readonly = !this.writable;
		return linkParams;
	}

	async stat(): Promise<Stats> {
		if (!this.v.node) { throw makeFileException(excCode.notFound, this.name); }
		const sync = await this.v.node.sync();
		const attrs = this.v.node.getAttrs();
		const stat: Stats = {
			writable: this.writable,
			size: this.v.node.size,
			version: this.v.node.version,
			sync,
			isFile: true,
			ctime: new Date(attrs.ctime),
			mtime: new Date(attrs.mtime),
		};
		return stat;
	}

	async updateXAttrs(changes: XAttrsChanges): Promise<void> {
		await this.v.updateXAttrs(changes);
	}

	async getXAttr(xaName: string): Promise<any> {
		const { attr } = await this.v.getXAttr(xaName);
		return attr;
	}

	async listXAttrs(): Promise<string[]> {
		const { lst } = await this.v.listXAttrs();
		return lst;
	}

	watch(observer: Observer<FileEvent>): () => void {
		if (!this.v.node) { throw new Error(
			`Node for file ${this.name} is not yet initialized`); }
		const sub = this.v.node.event$
		.subscribe(toRxObserver(observer));
		return () => sub.unsubscribe();
	}
	
	async readBytes(
		start?: number, end?: number
	): Promise<Uint8Array|undefined> {
		const { bytes } = await this.v.readBytes(start, end);
		return bytes;
	}

	async readTxt(): Promise<string> {
		const { txt } = await this.v.readTxt();
		return txt;
	}

	async readJSON<T>(): Promise<T> {
		const { json } = await this.v.readJSON<T>();
		return json;
	}

	async getByteSource(): Promise<FileByteSource> {
		const { src } = await this.v.getByteSource();
		return src;
	}

	async writeBytes(bytes: Uint8Array): Promise<void> {
		await this.v.writeBytes(bytes);
	}

	async writeTxt(txt: string): Promise<void> {
		await this.v.writeTxt(txt);
	}

	async writeJSON(json: any): Promise<void> {
		await this.v.writeJSON(json);
	}

	async getByteSink(truncate = true): Promise<FileByteSink> {
		const { sink } = await this.v.getByteSink(truncate);
		return sink;
	}

	async copy(file: File): Promise<void> {
		await this.v.copy(file);
	}

}
Object.freeze(FileObject.prototype);
Object.freeze(FileObject);

type WritableFileVersionedAPI = web3n.files.WritableFileVersionedAPI;

class V implements WritableFileVersionedAPI {

	constructor(
		public name: string,
		public node: FileNode|undefined,
		private makeOrGetNode: (() => Promise<FileNode>)|undefined,
		public writable: boolean
	) {
		Object.seal(this);
	}

	private async getNode(): Promise<FileNode> {
		if (!this.node) {
			this.node = await this.makeOrGetNode!();
			this.makeOrGetNode = undefined;
		}
		return this.node;
	}

	async updateXAttrs(changes: XAttrsChanges): Promise<number> {
		const node = await this.getNode();
		return node.updateXAttrs(changes);
	}

	async getXAttr(xaName: string): Promise<{ attr: any; version: number; }> {
		const node = await this.getNode();
		return {
			attr: node.getXAttr(xaName),
			version: node.version
		};
	}

	async listXAttrs(): Promise<{ lst: string[]; version: number; }> {
		const node = await this.getNode();
		return {
			lst: node.listXAttrs(),
			version: node.version
		};
	}

	async getLinkParams(): Promise<LinkParameters<FileLinkParams>> {
		if (!this.node) { throw new Error(
			'File does not exist, yet, and cannot be linked.'); }
		const linkParams = this.node.getParamsForLink();
		linkParams.params.fileName = this.name;
		linkParams.readonly = !this.writable;
		return linkParams;
	}

	async getByteSink(
		truncate = true, currentVersion?: number
	): Promise<{ sink: FileByteSink; version: number; }> {
		const node = await this.getNode();
		return node.writeSink(truncate, currentVersion);
	}
	
	async getByteSource(): Promise<{ src: FileByteSource; version: number; }> {
		if (!this.node) { throw makeFileException(excCode.notFound, this.name); }
		return this.node.readSrc();
	}

	async writeBytes(bytes: Uint8Array): Promise<number> {
		const node = await this.getNode();
		return node.save(bytes);
	}

	writeTxt(txt: string): Promise<number> {
		const bytes = utf8.pack(txt);
		return this.writeBytes(bytes);
	}

	writeJSON(json: any): Promise<number> {
		return this.writeTxt(JSON.stringify(json));
	}

	async readBytes(
		start?: number, end?: number
	): Promise<{ bytes: Uint8Array|undefined; version: number; }> {
		if (!this.node) { throw makeFileException(excCode.notFound, this.name); }
		return await this.node.readBytes(start, end);
	}

	async readTxt(): Promise<{ txt: string; version: number; }> {
		const { bytes, version } = await this.readBytes();
		const txt = (bytes ? utf8.open(bytes) : '');
		return { txt, version };
	}

	async copy(file: File): Promise<number> {
		const { version, sink } = await this.getByteSink();
		const src = (file.v ?
			(await file.v.getByteSource()).src : await file.getByteSource());
		await pipe(src, sink);
		return version;
	}

	async readJSON<T>(): Promise<{ json: T; version: number; }> {
		const { txt, version } = await this.readTxt();
		const json = JSON.parse(txt);
		return { json, version };
	}

}
Object.freeze(V.prototype);
Object.freeze(V);

Object.freeze(exports);