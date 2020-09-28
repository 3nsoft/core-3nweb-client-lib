/*
 Copyright (C) 2020 3NSoft Inc.
 
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

import { StorageOwner, FirstSaveReqOpts, FollowingSaveReqOpts } from "../../../lib-client/3nstorage/service";
import { SyncedObj, ObjFiles } from "./obj-files";
import { MonoTypeOperatorFunction } from "rxjs";
import { FileWrite } from "../../../lib-client/objs-on-disk/file-writing-proc";
import { tap } from "rxjs/operators";
import { Worker } from "../../../lib-common/processes";
import { LogError } from "../../../lib-client/logging/log-to-file";
import { UpSyncTasks, UploadInfo, RemovalInfo, ArchivalInfo, makeUploadInfo } from "./upsync-status";
import { StorageException } from "../../../lib-client/3nstorage/exceptions";
import { assert } from "../../../lib-common/assert";

const MAX_CHUNK_SIZE = 512*1024;

export class UpSyncer {

	private readonly uploads = new Map<SyncedObj, ObjUpSync>();

	constructor(
		private readonly remoteStorage: StorageOwner,
		private readonly files: ObjFiles,
		private readonly logError: LogError
	) {
		Object.seal(this);
	}

	private getOrMakeUploadsFor(obj: SyncedObj): ObjUpSync {
		let uploads = this.uploads.get(obj);
		if (!uploads) {
			const status = new UpSyncTasks(obj.objFolder, this.logError);
			uploads = new ObjUpSync(
				obj, status, this.remoteStorage, this.addToWorker, this.logError);
			this.uploads.set(obj, uploads);
		}
		return uploads;
	}

	start(): void {
		this.worker.start(2);
	}

	async stop(): Promise<void> {
		await this.worker.stop();
		for (const upload of this.uploads.values()) {
			upload.stop();
		}
		this.uploads.clear();
	}

	get chunkSize(): number {
		return (this.remoteStorage.maxChunkSize ?
			Math.min(this.remoteStorage.maxChunkSize, MAX_CHUNK_SIZE) :
			MAX_CHUNK_SIZE);
	}

	private readonly addToWorker = (ready: ObjUpSync): void => {
		this.worker.add(ready);
	}

	tapFileWrite(
		obj: SyncedObj, isNew: boolean, newVersion: number, baseVersion?: number
	): FileWriteTapOperator {
		const objUploads = this.getOrMakeUploadsFor(obj);
		return objUploads.tapFileWrite(isNew, newVersion, baseVersion);
	}

	async removeCurrentVersionOf(obj: SyncedObj): Promise<void> {
		const objUploads = this.getOrMakeUploadsFor(obj);
		objUploads.removeCurrentVersion();
	}

	private readonly worker = new Worker<ObjUpSync>(
		async u => {
			await u.process();
			if (u.isDone() && (u === this.uploads.get(u.obj))) {
				this.uploads.delete(u.obj);
			}
		},
		async queue => {
			for (const u of queue) {
				u.stop();
				this.uploads.delete(u.obj);
			}
		}
	);

}
Object.freeze(UpSyncer.prototype);
Object.freeze(UpSyncer);


export type FileWriteTapOperator = MonoTypeOperatorFunction<FileWrite[]>;


class ObjUpSync {

	private readonly objWriteTaps = new Map<UploadInfo, ObjWriteTap>();

	constructor(
		public readonly obj: SyncedObj,
		private readonly status: UpSyncTasks,
		private readonly remoteStorage: StorageOwner,
		private readonly addToWorker: (u: ObjUpSync) => void,
		private readonly logError: LogError
	) {
		Object.freeze(this);
	}

	tapFileWrite(
		isObjNew: boolean, newVersion: number, baseVersion: number|undefined
	): FileWriteTapOperator {
		const tap = new ObjWriteTap(
			this.obj, newVersion, baseVersion, isObjNew);
		const uploadInfo = makeUploadInfo(tap.version, tap.baseVersion);
		this.objWriteTaps.set(uploadInfo, tap);
		return tap.tapOperator();
	}

	stop(): void {

		// XXX
		// - is something needed here?

	}

	removeCurrentVersion(): void {
		this.status.queueTask({
			type: 'removal',
			currentVersion: true
		});
		this.addToWorker(this);
	}

	removeArchivedVersion(version: number): void {
		this.status.queueTask({
			type: 'removal',
			archivedVersions: version
		});
		this.addToWorker(this);
	}

	isDone(): boolean {
		return this.status.isDone();
	}

	async process(): Promise<void> {
		if (this.isDone()) { return; }
		try {
			const task = (await this.status.nextTask())!;
			if (task.type === 'upload') {
				await this.processUpload(task);
			} else if (task.type === 'removal') {
				await this.processRemoval(task);
			} else if (task.type === 'archiving') {
				await this.processArchival(task);
			} else {
				throw new Error(`This shouldn't be reached`);
			}
		} catch (err) {
			await this.logError(err, `Error occured in uploader processing`);
		}
		if (!this.isDone()) {
			this.addToWorker(this);
		}
	}

	private async processArchival(task: ArchivalInfo): Promise<void> {

		// XXX tell server to archive current version

		await this.logError(
			`Archival of current version is not implemented, yet.`);
		await this.status.recordTaskCompletion(task);
	}

	private async processRemoval(task: RemovalInfo): Promise<void> {
		if (task.currentVersion) {
			if (this.obj.objId) {
				await this.remoteStorage.deleteObj(this.obj.objId);
			} else {
				await this.logError(`Root obj can't be removed`);
			}
		}
		if (task.archivedVersions) {

			// XXX tell server to remove given archived versions

			await this.logError(
				`Removal of archived version is not implemented, yet.`);
		}
		await this.status.recordTaskCompletion(task);
	}

	private async processUpload(task: UploadInfo): Promise<void> {
		const tap = this.objWriteTaps.get(task);
		if (tap && !task.done) {
			await this.uploadReadyBytes(task, tap);
		}
		if (tap && !task.done) {
			await this.status.recordInterimStateOfCurrentTask(task);
		} else {
			this.objWriteTaps.delete(task);
			await this.status.recordTaskCompletion(task);
		}
	}

	private async uploadReadyBytes(
		uploadInfo: UploadInfo, tap: ObjWriteTap
	): Promise<void> {
		if (tap.cancelledOrErred()) {
			await this.cancelTransactionIfOpen(uploadInfo);
			return;
		}
		if (uploadInfo.transactionId) {
			await this.doUploadInTransaction(uploadInfo, tap);
		} else if (tap.isDone) {

			// XXX current code does upload after file is written, future code
			// can start upload sooner, and do diff-ed uploads

			await this.doFirstUpload(uploadInfo, tap);
		}
	}

	private async cancelTransactionIfOpen(
		uploadInfo: UploadInfo
	): Promise<void> {
		const txnId = uploadInfo.transactionId;
		if (!txnId) { return; }
		await this.remoteStorage.cancelTransaction(this.obj.objId, txnId)
		.catch((exc: StorageException) => {
			if (!exc.unknownTransaction) { throw exc; }
		});
	}

	private async doFirstUpload(
		uploadInfo: UploadInfo, tap: ObjWriteTap
	): Promise<void> {
		assert(tap.isDone, `Current implementation works only on completely saved to disk objects`);
		assert(!uploadInfo.awaiting);

		const src = await this.obj.getObjSrc(uploadInfo.version);
		// note that endlessness/finiteness of src is not used
		const header = await src.readHeader();
		const maxChunkLen = (this.remoteStorage.maxChunkSize ?
			this.remoteStorage.maxChunkSize - header.length : MAX_CHUNK_SIZE);
		assert(maxChunkLen > 0);
		const segs = await src.segSrc.read(maxChunkLen);
		const srcLen = (await src.segSrc.getSize()).size;
		let last: boolean;
		let bytesToSend: Uint8Array|Uint8Array[];
		if (segs) {
			if (segs.length === maxChunkLen) {
				last = (srcLen === segs.length);
			} else {
				last = false;
			}
			bytesToSend = [ header, segs ];
		} else {
			last = true;
			bytesToSend = header;
		}

		if (last) {
			const opts: FirstSaveReqOpts = {
				header: header.length, ver: uploadInfo.version, last
			};
			await this.remoteStorage.saveNewObjVersion(
				this.obj.objId, bytesToSend, opts, undefined);
			uploadInfo.done = true;
		} else {
			const opts: FirstSaveReqOpts = {
				header: header.length, ver: uploadInfo.version
			};
			const txnId = await this.remoteStorage.saveNewObjVersion(
				this.obj.objId, bytesToSend, opts, undefined);
			if (!txnId) { throw new Error(
				`Server didn't start obj saving transaction`); }
			uploadInfo.transactionId = txnId;
			uploadInfo.awaiting = {
				allByteOnDisk: true,
				segs: [ { ofs: segs!.length, len: srcLen - segs!.length } ]
			};
			this.addToWorker(this);
		}
	}

	private async doUploadInTransaction(
		uploadInfo: UploadInfo, tap: ObjWriteTap
	): Promise<void> {
		assert(tap.isDone, `Current implementation works only on completely saved to disk objects`);
		assert(!!uploadInfo.transactionId
			&& !!uploadInfo.awaiting
			&& (uploadInfo.awaiting.segs.length > 0)
			&& (uploadInfo.awaiting.segs[0].len > 0));

		const section = uploadInfo.awaiting!.segs[0];
		const lenToRead = Math.min(
			section.len,
			(this.remoteStorage.maxChunkSize ?
				this.remoteStorage.maxChunkSize : MAX_CHUNK_SIZE));
		const src = await this.obj.getObjSrc(uploadInfo.version);
		await src.segSrc.seek(section.ofs);
		const segs = await src.segSrc.read(lenToRead);
		if (!segs || (segs.length < lenToRead)) { throw new Error(
			`Unexpected end of obj source`); }
		const last = ((uploadInfo.awaiting!.segs.length === 0) &&
			(segs.length === section.len));
		
		if (last) {
			const opts: FollowingSaveReqOpts = {
				ofs: section.ofs,
				trans: uploadInfo.transactionId!,
				last: true
			};
			await this.remoteStorage.saveNewObjVersion(
				this.obj.objId, segs, undefined, opts);
			uploadInfo.done = true;
			uploadInfo.awaiting = undefined;
		} else {
			const opts: FollowingSaveReqOpts = {
				ofs: section.ofs,
				trans: uploadInfo.transactionId!
			};
			await this.remoteStorage.saveNewObjVersion(
				this.obj.objId, segs, undefined, opts);
			if (segs.length === section.len) {
				uploadInfo.awaiting!.segs.splice(0, 1);
			} else {
				section.ofs += segs.length;
				section.len -= segs.length;
			}
			this.addToWorker(this);
		}
	}

}
Object.freeze(ObjUpSync.prototype);
Object.freeze(ObjUpSync);


class ObjWriteTap {

	isDone = false;
	isCancelled = false;
	err: any = undefined;

	constructor(
		public readonly obj: SyncedObj,
		public readonly version: number,
		public readonly baseVersion: number|undefined,
		public readonly isObjNew: boolean
	) {
		Object.seal(this);
	}

	tapOperator(): FileWriteTapOperator {
		return tap(
			w => {},
			err => {
				this.err = err;
				this.isDone = true;
			},
			() => {
				this.isDone = true;
			}
		);
	}

	cancelledOrErred(): boolean {
		return (this.isCancelled || (this.isDone && this.err));
	}

}
Object.freeze(ObjWriteTap.prototype);
Object.freeze(ObjWriteTap);


Object.freeze(exports);