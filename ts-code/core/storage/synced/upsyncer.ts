/*
 Copyright (C) 2020, 2022, 2025 - 2026 3NSoft Inc.
 
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

import { StorageOwner } from "../../../lib-client/3nstorage/storage-owner";
import { SyncedObj } from "./obj-files";
import { MonoTypeOperatorFunction } from "rxjs";
import { FileWrite } from "../../../lib-client/objs-on-disk/file-writing-proc";
import { LabelledExecPools, Task } from "../../../lib-common/processes/labelled-exec-pools";
import { LogError } from "../../../lib-client/logging/log-to-file";
import { makeFSSyncException } from "../../../lib-client/xsp-fs/exceptions";
import { assert } from "../../../lib-common/assert";
import { countBytesIn, DiffVerOrderedUpload, NewVersionUpload, WholeVerOrderedUpload } from "./obj-status";
import { ObjSource } from "xsp-files";
import { defer } from "../../../lib-common/processes/deferred";
import { DiffInfo } from "../../../lib-common/service-api/3nstorage/owner";
import { utf8 } from "../../../lib-common/buffer-utils";
import { FiniteChunk } from "../../../lib-common/objs-on-disk/file-layout";
import { ObjId, UploadEventSink, UploadHeaderChange } from "../../../lib-client/xsp-fs/common";
import { NamedProcs } from "../../../lib-common/processes/synced";

const MAX_CHUNK_SIZE = 512*1024;

const MAX_FAST_UPLOAD = 2*1024*1024;

type UploadExecLabel = 'long' | 'fast';
type UploadNeedInfo = NonNullable<NewVersionUpload['needUpload']>;
type UploadEvent = web3n.files.UploadEvent;
type ConnectException = web3n.ConnectException;

export type FileWriteTapOperator = MonoTypeOperatorFunction<FileWrite[]>;


export class UpSyncer {

	private readonly execPools: LabelledExecPools<UploadExecLabel>;
	private readonly tasksByObjIds = new Map<ObjId, UploadTask>();
	private readonly tasksByIds = new Map<number, UploadTask>();
	private readonly syncedUploadStarts = new NamedProcs();

	constructor(
		private readonly remoteStorage: StorageOwner,
		private readonly whenConnected: () => Promise<void>,
		private readonly logError: LogError
	) {
		this.execPools = new LabelledExecPools([
			{ label: 'long', maxProcs: 1 },
			{ label: 'fast', maxProcs: 1 }
		], logError);
		Object.seal(this);
	}

	start(): void {
		this.execPools.start();
	}

	async stop(): Promise<void> {
		await this.execPools.stop();	// implicitly cancels all upsync tasks
	}

	async removeCurrentVersionOf(obj: SyncedObj): Promise<void> {
		try {
			await this.remoteStorage.deleteObj(obj.objId!);
		} catch (exc) {
			if ((exc as ConnectException).type === 'connect') {
				await this.whenConnected();
				return this.removeCurrentVersionOf(obj);
			} else {
				await this.logError(exc, `Uploading of obj removal failed.`);
				return;
			}
		}
		await obj.recordRemovalUploadAndGC();
	}

	async startUploadFromDisk(
		obj: SyncedObj, localVersion: number, uploadVersion: number,
		uploadHeader: UploadHeaderChange|undefined, createOnRemote: boolean,
		eventSink: UploadEventSink|undefined,
	): Promise<{ completion: Promise<void>; uploadTaskId: number; }> {
		const foundTask = this.tasksByObjIds.get(obj.objId);
		if (foundTask) {
			throw makeFSSyncException('', {
				alreadyUploading: true,
				uploadTaskId: foundTask.taskId
			});
		}
		const uploadStart = this.syncedUploadStarts.latestTaskAtThisMoment<{
			completion: Promise<void>; uploadTaskId: number;
		}>(obj.objId!);
		if (uploadStart) {
			return uploadStart;
		}
		return this.syncedUploadStarts.start(obj.objId!, async () => {
			let uploadTaskId: number;
			do {
				uploadTaskId = Math.floor(Number.MAX_SAFE_INTEGER * Math.random());
			} while (this.tasksByIds.has(uploadTaskId));

			const syncedBase = await obj.combineLocalBaseIfPresent(localVersion);
			if (uploadHeader) {
				await obj.saveUploadHeaderFile(uploadHeader);
			}
			const task = await UploadTask.for(
				obj, localVersion, uploadVersion, uploadHeader?.uploadHeader, syncedBase,
				createOnRemote, uploadTaskId, eventSink, this.remoteStorage, this.whenConnected,
				async () => {
					if (this.tasksByIds.delete(task.taskId)) {
						this.tasksByObjIds.delete(task.objId);
					}
					await obj.recordUploadCompletion(
						localVersion, uploadVersion, (uploadHeader ? {
							newHeader: uploadHeader.uploadHeader,
							originalHeader: uploadHeader.localHeader
						} : undefined)
					);
					if (localVersion > uploadVersion) {
						await obj.removeLocalVersionFilesLessThan(localVersion);
					}
				}
			);
			this.tasksByIds.set(uploadTaskId, task);
			this.tasksByObjIds.set(task.objId, task);
			const completion = task.completion();
			completion.catch(noop);
			this.execPools.add(task);
			return { completion, uploadTaskId };
		});
	}

}
Object.freeze(UpSyncer.prototype);
Object.freeze(UpSyncer);


export interface UploadStatusRecorder {
	recordUploadStart(info: NewVersionUpload): Promise<void>;
	recordUploadCancellation(info: NewVersionUpload): Promise<void>;
	recordUploadInterimState(info: NewVersionUpload): Promise<void>;
}


class UploadTask implements Task<UploadExecLabel> {

	private readonly uploadCompletion = defer<void>();
	private readonly execLabel: UploadExecLabel;
	private readonly totalBytesToUpload: number;

	private constructor(
		public readonly taskId: number,
		private readonly remoteStorage: StorageOwner,
		private readonly whenConnected: () => Promise<void>,
		public readonly objId: ObjId,
		private readonly objStatus: UploadStatusRecorder,
		private readonly src: ObjSource,
		private readonly info: NewVersionUpload,
		private readonly uploadHeader: Uint8Array|undefined,
		private readonly doAtCompletion: () => Promise<void>,
		private readonly eventSink: UploadEventSink|undefined
	) {
		this.execLabel = executorLabelFor(this.info.needUpload!);
		this.totalBytesToUpload = countBytesIn(this.info);
		this.emitUploadEvent('upload-started', { totalBytesToUpload: this.totalBytesToUpload });
		Object.seal(this);
	}

	static async for(
		obj: SyncedObj, localVersion: number, uploadVersion: number,
		uploadHeader: Uint8Array|undefined, syncedBase: number|undefined,
		createObj: boolean, taskId: number, eventSink: UploadEventSink|undefined,
		remoteStorage: StorageOwner, whenConnected: () =>Promise<void>, doAtCompletion: () => Promise<void>
	): Promise<UploadTask> {
		const src = await obj.getObjSrcFromLocalAndSyncedBranch(localVersion);
		let needUpload: UploadNeedInfo;
		if (syncedBase) {
			const { diff, newSegsPackOrder } = await obj.diffForUploadOf(localVersion);
			needUpload = await diffVerUpload(src, uploadHeader, diff, newSegsPackOrder);
		} else {
			needUpload = await wholeVerUpload(src, uploadHeader, createObj);
		}
		const info: NewVersionUpload = {
			type: 'new-version',
			localVersion,
			uploadVersion,
			baseVersion: syncedBase,
			needUpload
		};
		const objStatus = obj.statusObj();
		await objStatus.recordUploadStart(info);
		return new UploadTask(
			taskId, remoteStorage, whenConnected, obj.objId, objStatus, src, info, uploadHeader,
			doAtCompletion, eventSink
		);
	}

	neededExecutor(): UploadExecLabel|undefined {
		return (!this.info.needUpload ? undefined : this.execLabel);
	}

	completion(): Promise<void> {
		return this.uploadCompletion.promise;
	}

	private emitUploadEvent(type: UploadEvent['type'], fields: Partial<UploadEvent>): void {
		this.eventSink?.({
			type,
			localVersion: this.info.localVersion,
			uploadTaskId: this.taskId,
			uploadVersion: this.info.uploadVersion,
			path: '',
			...fields
		} as any);
	}

	async process(): Promise<boolean> {
		if (!this.info.needUpload) { return true; }
		try {
			const upload = this.info.needUpload;
			if (upload.type === 'ordered-diff') {
				if (upload.transactionId) {
					await this.continueOrderedDiffUpload(upload);
				} else {
					await this.startOrderedDiffUpload(upload);
				}
			} else if (upload.type === 'ordered-whole') {
				if (upload.transactionId) {
					await this.continueOrderedUpload(upload);
				} else {
					await this.startOrderedUpload(upload);
				}
			} else {
				throw new Error(`Unimplemented ${(upload as any).type} upload`);
			}
			await this.objStatus.recordUploadInterimState(this.info);
			if (this.info.needUpload) {
				if (this.eventSink) {
					this.emitUploadEvent('upload-progress', {
						totalBytesToUpload: this.totalBytesToUpload,
						bytesLeftToUpload: countBytesIn(this.info)
					});
				}
				return false;
			} else {
				await this.doAtCompletion().finally(() => {
					this.uploadCompletion.resolve();
					if (this.eventSink) {
						this.emitUploadEvent('upload-done', {});
					}
				});
				return true;
			}
		} catch (exc) {
			if ((exc as ConnectException).type === 'connect') {
				this.emitUploadEvent('upload-disconnected', {});
				await this.whenConnected();
				return false;
			} else {
				this.info.needUpload = undefined;
				this.uploadCompletion.reject(makeFSSyncException(`obj-upload`, {
					message: `Fail to upload local version ${this.info.uploadVersion}`,
					localVersion: this.info.uploadVersion,
					cause: exc
				}));
				await this.objStatus.recordUploadCancellation(this.info);
				return true;
			}
		}
	}

	private async startOrderedUpload(upload: WholeVerOrderedUpload): Promise<void> {
		const maxSegs = this.maxUploadChunk() - upload.header!;
		assert(maxSegs > 1);
		const segsToUpload = Math.min(upload.segsLeft, maxSegs);
		const header = await this.headerToUpload();
		let segs: Uint8Array|undefined = undefined;
		if (segsToUpload > 0) {
			segs = await this.src.segSrc.readAt(upload.segsOfs,segsToUpload);
		}
		assert(!!segs && (segs.length === segsToUpload));
		const ver = this.info.uploadVersion;
		if (segsToUpload === upload.segsLeft) {
			await this.remoteStorage.saveNewObjVersion(
				this.objId, { ver, last: true }, undefined,
				{ header, segs }
			);
			this.info.needUpload = undefined;
		} else {
			upload.transactionId = await this.remoteStorage.saveNewObjVersion(
				this.objId, { ver }, undefined,
				{ header, segs }
			);
			if (!upload.transactionId) {
	
				// XXX should this be runtime exception saying that remote acts badly ?
	
				throw new Error(`Server didn't start obj saving transaction`);
			}
			upload.header = undefined;
			upload.segsOfs += segsToUpload;
			upload.segsLeft -= segsToUpload;
		}
	}

	private async headerToUpload(): Promise<Uint8Array> {
		return (this.uploadHeader ? this.uploadHeader : await this.src.readHeader());
	}

	private async startOrderedDiffUpload(
		upload: DiffVerOrderedUpload
	): Promise<void> {
		const diff = utf8.pack(JSON.stringify(upload.diff));
		const maxSegs = this.maxUploadChunk() - upload.header! - diff.length;
		assert(maxSegs > 1);
		const header = await this.headerToUpload();
		const ver = this.info.uploadVersion;
		if (upload.newSegsLeft.length === 0) {
			await this.remoteStorage.saveNewObjVersion(
				this.objId,
				{ ver, last: true }, undefined,
				{ header, diff }
			);
			this.info.needUpload = undefined;
		} else {
			upload.transactionId = await this.remoteStorage.saveNewObjVersion(
				this.objId,
				{ ver }, undefined,
				{ header, diff }
			);
			if (!upload.transactionId) {
		
				// XXX should this be runtime exception saying that remote acts badly ?

				throw new Error(`Server didn't start obj saving transaction`);
			}
			upload.header = undefined;
		}
	}

	private maxUploadChunk(): number {
		return (this.remoteStorage.maxChunkSize ?
			this.remoteStorage.maxChunkSize : MAX_CHUNK_SIZE);
	}

	private async continueOrderedUpload(upload: WholeVerOrderedUpload): Promise<void> {
		const segsToUpload = Math.min(upload.segsLeft, this.maxUploadChunk());
		const segs = await this.src.segSrc.readAt(upload.segsOfs, segsToUpload);
		assert(!!segs && (segs.length === segsToUpload));
		const ofs = upload.segsOfs;
		const trans = upload.transactionId!;
		if (segsToUpload === upload.segsLeft) {
			await this.remoteStorage.saveNewObjVersion(
				this.objId, undefined, { ofs, trans, last: true }, { segs }
			);
			this.info.needUpload = undefined;
		} else {
			await this.remoteStorage.saveNewObjVersion(
				this.objId, undefined, { ofs, trans }, { segs }
			);
			upload.segsOfs += segsToUpload;
			upload.segsLeft -= segsToUpload;
		}
	}

	private async continueOrderedDiffUpload(upload: DiffVerOrderedUpload): Promise<void> {
		const maxSegs = this.maxUploadChunk();
		const segInfo = upload.newSegsLeft[0];
		assert(!!segInfo);
		const len = Math.min(maxSegs, segInfo.len);
		const segs = await this.src.segSrc.readAt(segInfo.thisVerOfs, len);
		assert(!!segs && (segs.length === len));
		if (segInfo.len > len) {
			upload.newSegsLeft.splice(1, 0, {
				len: segInfo.len - len,
				thisVerOfs: segInfo.thisVerOfs + len
			});
		}
		const ofs = segInfo.thisVerOfs;
		const trans = upload.transactionId!;
		if (upload.newSegsLeft.length === 1) {
			await this.remoteStorage.saveNewObjVersion(
				this.objId, undefined, { ofs, trans, last: true }, { segs }
			);
			this.info.needUpload = undefined;
		} else {
			await this.remoteStorage.saveNewObjVersion(
				this.objId, undefined, { ofs, trans }, { segs }
			);
			upload.newSegsLeft.splice(0, 1);
		}
	}

	cancel(): Promise<void> {
		// XXX
		throw new Error("UploadTask.cancel() not implemented.");
	}

}
Object.freeze(UploadTask.prototype);
Object.freeze(UploadTask);


async function wholeVerUpload(
	src: ObjSource, uploadHeader: Uint8Array|undefined, createObj: boolean
): Promise<WholeVerOrderedUpload> {
	const header = await expectedHeaderLen(src, uploadHeader);
	const segsSize = (await src.segSrc.getSize()).size;
	return {
		type: 'ordered-whole',
		createObj,
		header,
		segsOfs: 0,
		segsLeft: segsSize
	};
}

async function diffVerUpload(
	src: ObjSource, uploadHeader: Uint8Array|undefined, diff: DiffInfo,
	newSegsPackOrder: FiniteChunk[]
): Promise<DiffVerOrderedUpload> {
	const header = await expectedHeaderLen(src, uploadHeader);
	return {
		type: 'ordered-diff',
		diff,
		newSegsLeft: newSegsPackOrder,
		header
	};
}

async function expectedHeaderLen(
	src: ObjSource, uploadHeader: Uint8Array|undefined
): Promise<number> {
	return (uploadHeader ?
		uploadHeader.length : (await src.readHeader()).length);
}

function uploadSize(info: UploadNeedInfo): number {
	if (info.type === 'ordered-whole') {
		return info.header! + info.segsLeft;
	} else if (info.type === 'ordered-diff') {
		let uploadSize = info.header!;
		for (const { len } of info.newSegsLeft) {
			uploadSize += len;
		}
		return uploadSize;
	} else {
		throw new Error(`Unimplemented upload type ${(info as any).type}`);
	}
}

function executorLabelFor(info: UploadNeedInfo): UploadExecLabel {
	return ((uploadSize(info) <= MAX_FAST_UPLOAD) ? 'fast' : 'long');
}

function noop() {}


Object.freeze(exports);