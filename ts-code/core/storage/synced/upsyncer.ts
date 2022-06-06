/*
 Copyright (C) 2020, 2022 3NSoft Inc.
 
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

import { StorageOwner, FirstSaveReqOpts, FollowingSaveReqOpts } from "../../../lib-client/3nstorage/service";
import { SyncedObj } from "./obj-files";
import { MonoTypeOperatorFunction } from "rxjs";
import { FileWrite, HeaderWrite, SegsWrite } from "../../../lib-client/objs-on-disk/file-writing-proc";
import { tap } from "rxjs/operators";
import { LabelledExecPools, Task } from "../../../lib-common/processes/labelled-exec-pools";
import { LogError } from "../../../lib-client/logging/log-to-file";
import { StorageException } from "../../../lib-client/3nstorage/exceptions";
import { assert } from "../../../lib-common/assert";
import { ArchivalInfo, RemovalInfo, UploadInfo, UpSyncTaskInfo } from "./obj-status";
import { ObjId } from "../../../lib-client/3nstorage/xsp-fs/common";

const MAX_CHUNK_SIZE = 512*1024;

const MAX_FAST_UPLOAD = 2*1024*1024;

type UploadExecLabel = 'long' | 'fast';
type UploadNeedInfo = NonNullable<UploadInfo['needUpload']>;

function executorLabelFor(info: UploadNeedInfo): UploadExecLabel {
	let uploadSize = 0;
	if (info.header) {
		uploadSize += info.header;
	}
	for (const seg of info.segs) {
		uploadSize += seg.len;
	}
	return ((uploadSize <= MAX_FAST_UPLOAD) ? 'fast' : 'long');
}

function addEventToInfo(info: UploadNeedInfo, writeEv: FileWrite[]): void {
	for (const w of writeEv) {
		if ((w as HeaderWrite).isHeader) {
			info.header = w.bytes.length;
		} else {
			mergeSections(info.segs, w as SegsWrite);
		}
	}
}

function mergeSections(segs: UploadNeedInfo['segs'], w: SegsWrite): void {
	const wStart = w.ofs;
	const wLen = w.bytes.length;
	for (let i=0; i<segs.length; i+=1) {
		const section = segs[i];
		const sectionEnd = section.ofs + section.len;
		if (sectionEnd < wStart) {
			continue;
		}
		if (sectionEnd === wStart) {
			section.len += wLen;
		} else if (section.ofs <= wStart) {
			const maxOverlap = section.len - (wStart - section.ofs);
			if (maxOverlap < wLen) {
				section.len += wLen - maxOverlap;
			}
		} else if ((wStart + wLen) === section.ofs) {
			section.ofs = wStart;
		} else {
			segs.splice(i, 0, { ofs: wStart, len: wLen });
		}
		return;
	}
	segs.push({ ofs: wStart, len: wLen });
}

export type FileWriteTapOperator = MonoTypeOperatorFunction<FileWrite[]>;

export type BroadcastUpSyncEvent = (objId: ObjId, task: UpSyncTaskInfo) => void;


export class UpSyncer {

	private readonly execPools: LabelledExecPools<UploadExecLabel>;
	private readonly uploads = new Map<SyncedObj, ObjUpSync>();

	constructor(
		private readonly remoteStorage: StorageOwner,
		private readonly logError: LogError,
		private readonly broadcastUpSyncEvent: BroadcastUpSyncEvent
	) {
		this.execPools = new LabelledExecPools([
			{ label: 'long', maxProcs: 1 },
			{ label: 'fast', maxProcs: 1 }
		], logError);
		Object.seal(this);
	}

	private getOrMakeUploadsFor(obj: SyncedObj): ObjUpSync {
		let uploads = this.uploads.get(obj);
		if (!uploads) {
			uploads = new ObjUpSync(
				obj, this.remoteStorage, this.execPools, this.logError,
				this.broadcastUpSyncEvent);
			this.uploads.set(obj, uploads);
		}
		return uploads;
	}

	start(): void {
		this.execPools.start();
	}

	async stop(): Promise<void> {
		await this.execPools.stop();	// implicitly cancels all upsync tasks
		this.uploads.clear();
	}

	tapFileWrite(
		obj: SyncedObj, isNew: boolean, newVersion: number, baseVersion?: number
	): FileWriteTapOperator {
		const objUploads = this.getOrMakeUploadsFor(obj);
		return objUploads.tapFileWrite(isNew, newVersion, baseVersion);
	}

	async removeCurrentVersionOf(obj: SyncedObj): Promise<void> {
		const objUploads = this.getOrMakeUploadsFor(obj);
		if (objUploads.neededExecutor()) {
			this.execPools.add(objUploads);
		}
	}

}
Object.freeze(UpSyncer.prototype);
Object.freeze(UpSyncer);


class ObjUpSync implements Task<UploadExecLabel> {

	private taskInProcess: UpSyncTaskInfo|undefined = undefined;
	private isCancelled = false;
	private runningProc: Promise<void>|undefined = undefined;

	constructor(
		private readonly obj: SyncedObj,
		private readonly remoteStorage: StorageOwner,
		private readonly execPools: LabelledExecPools<UploadExecLabel>,
		private readonly logError: LogError,
		private readonly broadcastUpSyncEvent: BroadcastUpSyncEvent
	) {
		Object.seal(this);
	}

	tapFileWrite(
		isObjNew: boolean, newVersion: number, baseVersion: number|undefined
	): FileWriteTapOperator {
		// XXX for now upload is started when write is complete, but tapped code
		//     layout can adopt upload as before completion.
		const uploadInfo: UploadInfo = {
			type: 'upload',
			version: newVersion,
			baseVersion,
			needUpload: {
				segs: []
			}
		};
		if (isObjNew) {
			uploadInfo.createObj = true;
		}
		return tap(
			writeEv => {
				addEventToInfo(uploadInfo.needUpload!, writeEv);
			},
			async err => {
				// XXX cancel in-tap upload, when it will be added.
				//     Something should be done in case there is a transaction that
				//     needs  cancelling.
				await this.cancelTransactionIfOpen(uploadInfo);

				await this.logError(err);
			},
			() => {
				uploadInfo.needUpload!.allByteOnDisk = true;
				this.enqueueTask(uploadInfo);
			}
		);
	}

	private enqueueTask(task: UpSyncTaskInfo): void {
		this.obj.sync().queueTask(task);
		if (this.neededExecutor()) {
			this.execPools.add(this);
		} else {
			this.obj.scheduleSelfGC();
		} 
	}

	private async recordTaskCompletion(task: UpSyncTaskInfo): Promise<void> {
		this.taskInProcess = undefined;
		if (task.type === 'upload') {
			await this.obj.markVersionSynced(task.version);
		}
		await this.obj.sync().recordTaskCompletion(task);
		this.broadcastUpSyncEvent(this.obj.objId, task);
	}

	neededExecutor(): UploadExecLabel|undefined {
		const task = this.obj.sync().glanceOnNextTask();
		if (!task) { return; }
		if (task.type !== 'upload') { return 'fast'; }
		if (!task.needUpload) { return; }
		return executorLabelFor(task.needUpload!);
	}

	removeArchivedVersion(version: number): void {
		this.enqueueTask({
			type: 'removal',
			archivedVersions: version
		});
	}

	async cancel(): Promise<void> {
		this.isCancelled = true;
		await this.runningProc?.catch(noop);
	}

	async process(): Promise<void> {
		if (this.obj.sync().isSyncDone() || this.isCancelled) { return; }
		let task: UpSyncTaskInfo|undefined = undefined;
		try {
			if (!this.taskInProcess) {
				this.taskInProcess = (
					await this.obj.sync().getTaskForProcessing())!;
				if (this.isCancelled) { return; }
			}
			task = this.taskInProcess;
		} catch (err) {
			await this.logError(err, `ObjUpSync.process fails to get task`);
			return;
		}
		try {
			if (task.type === 'upload') {
				this.runningProc = this.processUpload(task);
			} else if (task.type === 'removal') {
				this.runningProc = this.processRemoval(task);
			} else if (task.type === 'archiving') {
				this.runningProc = this.processArchival(task);
			} else {
				throw new Error(`This shouldn't be reached`);
			}
			try {
				await this.runningProc;
			} finally {
				this.runningProc = undefined;
			}
		} catch (err) {
			await this.logError(err, `From ObjUpSync.process task ${task.type}`);
		}
	}

	private async processArchival(task: ArchivalInfo): Promise<void> {

		// XXX tell server to archive current version

		await this.logError(
			`Archival of current version is not implemented, yet.`);
		await this.recordTaskCompletion(task);
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
		await this.recordTaskCompletion(task);
		this.obj.scheduleSelfGC();
	}

	private async processUpload(task: UploadInfo): Promise<void> {
		if (task.needUpload) {
			if (task.needUpload.allByteOnDisk) {
				if (task.transactionId) {
					await this.continueUploadOfCompletedVersion(task);
				} else {
					await this.startUploadOfCompletedVersion(task);
				}
			}
		} else {
			await this.recordTaskCompletion(task);
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

	private async startUploadOfCompletedVersion(
		uploadInfo: UploadInfo
	): Promise<void> {
		const src = await this.obj.getObjSrc(uploadInfo.version);
		const header = await src.readHeader();
		const maxChunkLen = (this.remoteStorage.maxChunkSize ?
			this.remoteStorage.maxChunkSize - header.length : MAX_CHUNK_SIZE);
		assert(maxChunkLen > 0);
		const srcLen = (await src.segSrc.getSize()).size;
		if (srcLen <= maxChunkLen) {
			const segs = await src.segSrc.read(maxChunkLen);
			await this.uploadWholeVersion(
				!!uploadInfo.createObj, uploadInfo.version, header, segs
			);
			uploadInfo.needUpload = undefined;
			await this.recordTaskCompletion(uploadInfo);
		} else {
			const segs = await src.segSrc.read(maxChunkLen);
			uploadInfo.transactionId = await this.startUploadTransaction(
				!!uploadInfo.createObj, uploadInfo.version, header, segs!
			);
			uploadInfo.needUpload!.segs = [
				{ ofs: segs!.length, len: srcLen - segs!.length }
			];
			await this.obj.sync().recordInterimStateOfCurrentTask(uploadInfo);
			this.execPools.add(this);
		}
	}

	private async uploadWholeVersion(
		create: boolean, ver: number,
		header: Uint8Array, segs: Uint8Array|undefined
	): Promise<void> {
		const opts: FirstSaveReqOpts = {
			header: header.length, ver, last: true
		};
		if (create) {
			opts.create = true;
		}
		const bytes = (segs ? [ header, segs ] : [ header ]);
		await this.remoteStorage.saveNewObjVersion(
			this.obj.objId, bytes, opts, undefined
		);
	}

	private async startUploadTransaction(
		create: boolean, ver: number, header: Uint8Array, segs: Uint8Array
	): Promise<string> {
		const opts: FirstSaveReqOpts = {
			header: header.length, ver
		};
		if (create) {
			opts.create = true;
		}
		const txnId = await this.remoteStorage.saveNewObjVersion(
			this.obj.objId, [ header, segs ], opts, undefined);
		if (!txnId) {
			throw new Error(`Server didn't start obj saving transaction`);
		}
		return txnId;
	}

	private async continueUploadOfCompletedVersion(
		uploadInfo: UploadInfo
	): Promise<void> {
		const section = uploadInfo.needUpload!.segs[0];
		const lenToRead = Math.min(
			section.len,
			(this.remoteStorage.maxChunkSize ?
				this.remoteStorage.maxChunkSize : MAX_CHUNK_SIZE));
		const src = await this.obj.getObjSrc(uploadInfo.version);
		await src.segSrc.seek(section.ofs);
		const segs = await src.segSrc.read(lenToRead);
		if (!segs || (segs.length < lenToRead)) { throw new Error(
			`Unexpected end of obj source`); }
		const last = ((uploadInfo.needUpload!.segs.length === 1) &&
			(segs.length === section.len));
		
		if (last) {
			const opts: FollowingSaveReqOpts = {
				ofs: section.ofs,
				trans: uploadInfo.transactionId!,
				last
			};
			await this.remoteStorage.saveNewObjVersion(
				this.obj.objId, segs, undefined, opts);
			uploadInfo.needUpload = undefined;
			await this.recordTaskCompletion(uploadInfo);
		} else {
			const opts: FollowingSaveReqOpts = {
				ofs: section.ofs,
				trans: uploadInfo.transactionId!
			};
			await this.remoteStorage.saveNewObjVersion(
				this.obj.objId, segs, undefined, opts);
			if (segs.length === section.len) {
				uploadInfo.needUpload!.segs.splice(0, 1);
			} else {
				section.ofs += segs.length;
				section.len -= segs.length;
			}
			this.execPools.add(this);
		}
	}

}
Object.freeze(ObjUpSync.prototype);
Object.freeze(ObjUpSync);


function noop() {}


Object.freeze(exports);