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

import { AsyncSBoxCryptor, SegmentsWriter, makeSegmentsWriter, SegmentsReader, makeSegmentsReader, compareVectors, calculateNonce, makeDecryptedByteSource, Subscribe, ObjSource, makeDecryptedByteSourceWithAttrs, ByteSource } from 'xsp-files';
import { base64 } from '../../../lib-common/buffer-utils';
import { SingleProc } from '../../../lib-common/processes';
import * as random from '../../../lib-common/random-node';
import { Node, NodeType, Storage, RemoteEvent } from './common';
import { makeFileException, Code as excCode, Code } from '../../../lib-common/exceptions/file';
import { errWithCause } from '../../../lib-common/exceptions/error';
import { StorageException } from '../exceptions';
import { Observable, Subject } from 'rxjs';
import { encryptBytesToSinkProc, encryptAttrsToSinkProc } from '../../../lib-common/obj-streaming/sink-utils';
import { share } from 'rxjs/operators';
import { AttrsHolder, EntityAttrs } from '../../files/file-attrs';

const SEG_SIZE = 16;	// in 256-byte blocks = 4K in bytes

const EMPTY_BYTE_ARR = new Uint8Array(0);

export abstract class NodeCrypto {

	protected constructor(
		private zerothHeaderNonce: Uint8Array,
		private key: Uint8Array,
		private cryptor: AsyncSBoxCryptor
	) {}
	
	wipe(): void {
		if (this.key) {
			this.key.fill(0);
			this.key = (undefined as any);
			this.zerothHeaderNonce.fill(0);
			this.zerothHeaderNonce = (undefined as any);
		}
	}

	compareKey(keyB64: string): boolean {
		const k = base64.open(keyB64);
		return compareVectors(k, this.key);
	}

	fileKeyInBase64(): string {
		if (!this.key) { throw new Error("Cannot use wiped object."); }
		return base64.pack(this.key);
	}

	protected segWriter(version: number): Promise<SegmentsWriter> {
		if (!this.key) { throw new Error("Cannot use wiped object."); }
		return makeSegmentsWriter(
			this.key, this.zerothHeaderNonce, version,
			{ type: 'new', segSize: SEG_SIZE, formatWithSections: true },
			random.bytes, this.cryptor);
	}

	protected async segWriterWithBase(
		newVersion: number, base: ObjSource
	): Promise<SegmentsWriter> {
		if (!this.key) { throw new Error("Cannot use wiped object."); }
		return makeSegmentsWriter(
			this.key, this.zerothHeaderNonce, newVersion,
			{ type: 'update', base, formatWithSections: true },
			random.bytes, this.cryptor);
	}

	protected async segReader(src: ObjSource): Promise<SegmentsReader> {
		if (!this.key) { throw new Error("Cannot use wiped object."); }
		const version = src.version;
		const header = await src.readHeader();
		return makeSegmentsReader(this.key, this.zerothHeaderNonce,
			version, header, this.cryptor);
	}

	async saveBytes(
		bytes: Uint8Array|Uint8Array[], version: number, attrs: AttrsHolder<any>
	): Promise<Subscribe> {
		attrs.mtime = Date.now();
		const segWriter = await this.segWriter(version);
		const sub = encryptBytesToSinkProc(bytes, attrs.toBytes(), segWriter);
		return sub;
	}

	async saveAttrs<T extends EntityAttrs>(
		attrs: AttrsHolder<T>, version: number, base: ObjSource|undefined
	): Promise<Subscribe> {
		if (base) {
			const writer = await this.segWriterWithBase(version, base);
			const { attrsBytes } = await this.getAttrsAndByteSrc(base);
			const baseAttrsSize = (attrsBytes ? attrsBytes.length : 0);
			return encryptAttrsToSinkProc(attrs.toBytes(), writer, baseAttrsSize);
		} else {
			const writer = await this.segWriter(version);
			return encryptAttrsToSinkProc(attrs.toBytes(), writer, undefined);
		}
	}

	async getAttrsAndByteSrc(
		src: ObjSource
	): Promise<{ attrsBytes?: Uint8Array; byteSrc: ByteSource; }> {
		const segReader = await this.segReader(src);
		if (segReader.formatVersion === 2) {
			const byteSrc = await makeDecryptedByteSourceWithAttrs(
				src.segSrc, segReader);
			const attrsBytes = await byteSrc.readAttrs();
			return { byteSrc, attrsBytes };
		} else if (segReader.formatVersion === 1) {
			const byteSrc = makeDecryptedByteSource(src.segSrc, segReader);
			return { byteSrc };
		} else {
			throw new Error(`XSP segments format ${segReader.formatVersion} is unknown`);
		}
	}

	async readBytes(
		src: ObjSource
	): Promise<{ content: Uint8Array; attrs?: Uint8Array; }> {
		const segReader = await this.segReader(src);
		if (segReader.formatVersion === 2) {
			const decSrc = await makeDecryptedByteSourceWithAttrs(
				src.segSrc, segReader);
			const attrs = await decSrc.readAttrs();
			const bytes = await decSrc.read(undefined);
			return { attrs, content: (bytes ? bytes : EMPTY_BYTE_ARR) };
		} else if (segReader.formatVersion === 1) {
			const decSrc = makeDecryptedByteSource(src.segSrc, segReader);
			const bytes = await decSrc.read(undefined);
			return { content: (bytes ? bytes : EMPTY_BYTE_ARR) };
		} else {
			throw new Error(`XSP segments format ${segReader.formatVersion} is unknown`);
		}
	}

	reencryptHeader = async (
		initHeader: Uint8Array, newVersion: number
	): Promise<Uint8Array> => {
		if (!this.key) { throw new Error("Cannot use wiped object."); }
		const headerContent = await this.cryptor.formatWN.open(
			initHeader, this.key);
		const n = calculateNonce(this.zerothHeaderNonce, newVersion);
		return this.cryptor.formatWN.pack(headerContent, n, this.key);
	};

}
Object.freeze(NodeCrypto.prototype);
Object.freeze(NodeCrypto);


export type FSEvent = web3n.files.FolderEvent | web3n.files.FileEvent;
type FileChangeEvent = web3n.files.FileChangeEvent;
type RemovedEvent = web3n.files.RemovedEvent;
type XAttrsChanges = web3n.files.XAttrsChanges;

export abstract class NodeInFS<
	TCrypto extends NodeCrypto, TAttrs extends EntityAttrs> implements Node {

	protected crypto: TCrypto = (undefined as any);

	protected attrs: AttrsHolder<TAttrs> = (undefined as any);
	
	private writeProc: SingleProc|undefined = undefined;
	protected get transition(): Promise<any>|undefined {
		if (!this.writeProc) { return; }
		return this.writeProc.getP();
	}

	get version(): number {
		return this.currentVersion;
	}
	protected setCurrentVersion(newVersion: number) {
		if (!Number.isInteger(newVersion)) { throw new TypeError(
			`Version parameter must be an integer, but ${newVersion} is given`); }
		this.currentVersion = newVersion;
	}

	private remoteEvents: RemoteEvent[]|undefined = undefined;

	protected constructor(
		protected storage: Storage,
		public type: NodeType,
		public name: string,
		public objId: string,
		private currentVersion: number,
		public parentId: string | undefined
	) {}

	async updateXAttrs(changes: XAttrsChanges): Promise<number> {
		if (Object.keys(changes).length === 0) { return this.version; }
		return this.doChange(true, async () => {
			const newVersion = this.version + 1;
			const attrs = this.attrs.modifiableCopy();
			attrs.updateXAttrs(changes);
			const base = ((this.version === 0) ?
				undefined :
				await this.storage.getObj(this.objId));
			const sub = await this.crypto.saveAttrs(attrs, newVersion, base);
			await this.storage.saveObj(this.objId, newVersion, sub);
			this.setCurrentVersion(newVersion);
			attrs.setReadonly();
			this.attrs = attrs;
			return this.version;
		});
	}

	getXAttr(xaName: string): any {
		return this.attrs.getXAttr(xaName);
	}

	listXAttrs(): string[] {
		return this.attrs.listXAttrs();
	}

	processRemoteEvent(event: RemoteEvent): Promise<void> {
		this.bufferRemoteEvent(event);
		return this.doChange(true, async () => {
			const event = this.getBufferedEvent();
			if (!event) { return; }
			if (event.type === 'remote-change') {

				// XXX should we use here synced storage methods here?
				//     This method is called only in synced storage.

				// XXX detect if there is a conflict
				// need obj status info here


				// if (conflict) {
				// 	await this.doOnConflict();
				// } else {
				// 	await this.doOnExternalChange();
				// }
			} else if (event.type === 'remote-delete') {
				await this.delete(true);
			} else {
				throw new Error(`Unknown remote bufferred event type ${JSON.stringify(event)}`);
			}
		});
	}

	private bufferRemoteEvent(event: RemoteEvent): void {
		if (!this.remoteEvents) {
			this.remoteEvents = [];
		}
		this.remoteEvents.push(event);
	}

	private getBufferedEvent(): RemoteEvent|undefined {
		if (!this.remoteEvents) { return; }
		const event = this.remoteEvents.shift();
		if (this.remoteEvents.length === 0) {
			this.remoteEvents = undefined;
		}
		return event;
	}

	localDelete(): Promise<void> {
		return this.doChange(true, () => this.delete());
	}

	/**
	 * This non-synchronized method deletes object from storage, and detaches
	 * this node from storage. Make sure to call it inside access synchronization
	 * construct.
	 */
	protected async delete(remoteEvent?: boolean): Promise<void> {
		if (!remoteEvent) {
			await this.storage.removeObj(this.objId);
		}
		this.storage.nodes.delete(this);
		this.currentVersion = -1;
		const event: RemovedEvent = {
			type: 'removed',
			path: this.name,
			isRemote: remoteEvent
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
		if (!awaitPrevChange && this.writeProc.getP()) {
			throw makeFileException(excCode.concurrentUpdate, this.name+` type ${this.type}`);
		}
		try {
			const res = await this.writeProc.startOrChain(() => {
				if (this.currentVersion < 0) {
					throw makeFileException(Code.notFound, this.name);
				}
				return change();
			});
			return res;
		} catch (exc) {
			if (!(exc as web3n.RuntimeException).runtimeException) {
				throw errWithCause(exc, `Cannot save changes to ${this.type} ${this.name}, version ${this.version}`);
			}
			if ((exc as StorageException).type === 'storage') {
				if ((exc as StorageException).concurrentTransaction) {
					throw makeFileException(excCode.concurrentUpdate, this.name, exc);
				} else if ((exc as StorageException).objNotFound) {
					throw makeFileException(excCode.notFound, this.name, exc);
				}
			}
			throw makeFileException(Code.ioError, this.name, exc);
		}
	}

	/**
	 * This method is called on conflict with remote version. This method
	 * is called at ordered point in time requiring no further synchronization.
	 * @param remoteVersion is an object version on server
	 */
	protected async doOnConflict(remoteVersion: number): Promise<void> {
		// XXX

		throw new Error('Unimplemented, yet');

		// OLD CODE BELOW
		// if (remoteVersion < this.version) { return; }
		// await (this.storage as SyncedStorage).setCurrentSyncedVersion(
		// 	this.objId, remoteVersion);
		// this.setCurrentVersion(remoteVersion);
	}

	/**
	 * This non-synchronized method resolves conflict with remote version.
	 * @param remoteVersion 
	 */
	protected async doOnExternalChange(remoteVersion: number): Promise<void> {
		if (remoteVersion <= this.version) { return; }
		const src = await this.storage.getObj(this.objId);
		const newVersion = src.version;
		if (newVersion <= this.version) { return; }
		this.setCurrentVersion(newVersion);
		const event: FileChangeEvent = {
			type: 'file-change',
			path: this.name,
			isRemote: true
		};
		this.broadcastEvent(event);
	}

	protected broadcastEvent(event: FSEvent, complete?: boolean): void {
		if (!this.events) { return; }
		this.events.next(event);
		if (complete) {
			this.events.complete();
		}
	}

	/**
	 * This is a lazily initialized field, when there is an external entity
	 * that wants to see this node's events.
	 */
	private events: Subject<FSEvent>|undefined = undefined;

	get event$(): Observable<FSEvent> {
		if (!this.events) {
			this.events = new Subject<FSEvent>();
		}
		return this.events.asObservable().pipe(share());
	}

}
Object.freeze(NodeInFS.prototype);
Object.freeze(NodeInFS);


Object.freeze(exports);