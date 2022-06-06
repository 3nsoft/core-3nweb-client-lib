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

import { SingleProc } from '../../../lib-common/processes/synced';
import { Node, NodeType, Storage, RemoteEvent, SyncedStorage } from './common';
import { makeFileException, Code as excCode, Code } from '../../../lib-common/exceptions/file';
import { errWithCause } from '../../../lib-common/exceptions/error';
import { StorageException } from '../exceptions';
import { Observable, Subject } from 'rxjs';
import { share } from 'rxjs/operators';
import { CommonAttrs, XAttrs } from './attrs';
import { NodePersistance } from './node-persistence';
import { UpSyncTaskInfo } from '../../../core/storage/synced/obj-status';


export type FSEvent = web3n.files.FolderEvent | web3n.files.FileEvent;
type FileChangeEvent = web3n.files.FileChangeEvent;
type RemovedEvent = web3n.files.RemovedEvent;
type XAttrsChanges = web3n.files.XAttrsChanges;
type RuntimeException = web3n.RuntimeException;
type Stats = web3n.files.Stats;


export abstract class NodeInFS<P extends NodePersistance> implements Node {

	protected crypto: P = (undefined as any);

	protected attrs: CommonAttrs = (undefined as any);
	protected xattrs: XAttrs|undefined = undefined;
	
	private writeProc: SingleProc|undefined = undefined;

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
		protected readonly storage: Storage,
		public readonly type: NodeType,
		public name: string,
		public readonly objId: string,
		private currentVersion: number,
		public parentId: string | undefined
	) {}

	private updatedXAttrs(changes: XAttrsChanges|undefined): XAttrs|undefined {
		return (this.xattrs ?
			(changes ? this.xattrs.makeUpdated(changes) : this.xattrs) :
			(changes ? XAttrs.makeEmpty().makeUpdated(changes) : undefined));
	}

	protected setUpdatedParams(
		version: number, attrs: CommonAttrs|undefined, xattrs: XAttrs|undefined
	): void {
		if (attrs) {
			this.attrs = attrs;
		}
		this.xattrs = xattrs;
		this.setCurrentVersion(version);
	}

	protected getParamsForUpdate(changes: XAttrsChanges|undefined): {
		newVersion: number; attrs: CommonAttrs; xattrs?: XAttrs;
	} {
		return {
			newVersion: this.version + 1,
			attrs: this.attrs.copy(),
			xattrs: this.updatedXAttrs(changes)
		}
	}

	async updateXAttrs(changes: XAttrsChanges): Promise<number> {
		if (Object.keys(changes).length === 0) { return this.version; }
		return this.doChange(true, async () => {
			const { xattrs, newVersion } = this.getParamsForUpdate(changes);
			const base = await this.storage.getObj(this.objId);
			const sub = await this.crypto.writeXAttrs(xattrs!, newVersion, base);
			await this.storage.saveObj(this.objId, newVersion, sub);
			this.setUpdatedParams(newVersion, undefined, xattrs);
			return this.version;
		});
	}

	getXAttr(xaName: string): any {
		return (this.xattrs ? this.xattrs.get(xaName) : undefined);
	}

	listXAttrs(): string[] {
		return (this.xattrs ? this.xattrs.list() : []);
	}

	getAttrs(): CommonAttrs {
		return this.attrs;
	}

	async	processRemoteEvent(event: RemoteEvent): Promise<void> {
		this.bufferRemoteEvent(event);
		return this.doChange(true, async () => {
			const event = this.getBufferedEvent();
			if (!event) { return; }
			if (event.type === 'remote-change') {

// TODO
// uploader should show if there is process for this obj uploads with version
// in the event, and if so, wait for completion of that process to either ignore
// remote event, or to set conflict, or whatever

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
		if (this.remoteEvents.length > 1) {
			// XXX attempt to compress events

		}
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

	broadcastUpSyncEvent(task: UpSyncTaskInfo): void {
		if (task.type === 'upload') {
			this.broadcastEvent({
				type: 'sync-upload',
				path: this.name,
				current: this.version,
				uploaded: task.version
			});
		}
	}

	/**
	 * This non-synchronized method deletes object from storage, and detaches
	 * this node from storage. Make sure to call it inside access synchronization
	 * construct.
	 */
	protected async delete(remoteEvent?: boolean): Promise<void> {
		if (remoteEvent) {

			// XXX
			throw Error(`Removal from remote side is not implemented, yet.`);

		} else {
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
		if (!awaitPrevChange && this.writeProc.isProcessing()) {
			throw makeFileException(excCode.concurrentUpdate, this.name+` type ${this.type}`);
		}
		const res = await this.writeProc.startOrChain(() => {
			if (this.currentVersion < 0) {
				throw makeFileException(
					Code.notFound, this.name, `Object is marked removed`);
			}
			return change()
			.catch((exc: RuntimeException) => {
				if (!exc.runtimeException) {
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
			});
		});
		return res;
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
		this.storage.broadcastNodeEvent(this.objId, this.parentId, event);
		if (!this.events) { return; }
		this.events.next(event);
		if (complete) {
			this.events.complete();
			this.events = undefined;
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

	async sync(): Promise<Stats['sync']> {
		if ((this.storage.type === 'synced')
		|| (this.storage.type === 'share')) {
			return (this.storage as SyncedStorage).getObjSyncInfo(this.objId);
		}
	}

}
Object.freeze(NodeInFS.prototype);
Object.freeze(NodeInFS);


Object.freeze(exports);