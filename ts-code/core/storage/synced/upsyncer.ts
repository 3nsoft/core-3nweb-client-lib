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

import { StorageOwner } from "../../../lib-client/3nstorage/storage-owner";
import { SyncedObj } from "./obj-files";
import { MonoTypeOperatorFunction } from "rxjs";
import { FileWrite } from "../../../lib-client/objs-on-disk/file-writing-proc";
import { LabelledExecPools, Task } from "../../../lib-common/processes/labelled-exec-pools";
import { LogError } from "../../../lib-client/logging/log-to-file";
import { makeFSSyncException } from "../../../lib-client/xsp-fs/exceptions";
import { assert } from "../../../lib-common/assert";
import { DiffVerOrderedUpload, NewVersionUpload, WholeVerOrderedUpload } from "./obj-status";
import { ObjSource } from "xsp-files";
import { defer } from "../../../lib-common/processes/deferred";
import { DiffInfo } from "../../../lib-common/service-api/3nstorage/owner";
import { utf8 } from "../../../lib-common/buffer-utils";
import { FiniteChunk } from "../../../lib-common/objs-on-disk/file-layout";
import { ObjId } from "../../../lib-client/xsp-fs/common";

const MAX_CHUNK_SIZE = 512*1024;

const MAX_FAST_UPLOAD = 2*1024*1024;

type UploadExecLabel = 'long' | 'fast';
type UploadNeedInfo = NonNullable<NewVersionUpload['needUpload']>;

export type FileWriteTapOperator = MonoTypeOperatorFunction<FileWrite[]>;


export class UpSyncer {

	private readonly execPools: LabelledExecPools<UploadExecLabel>;

	constructor(
		private readonly remoteStorage: StorageOwner,
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

	/**
	 * Creates an rxjs operator to tap saving process, starting upload while
	 * writing is ongoing.
	 */
	tapFileWrite(
		obj: SyncedObj, isNew: boolean, newVersion: number, baseVersion?: number
	): FileWriteTapOperator {

		throw new Error('UpSyncer.tapFileWrite() not implemented');

		// const objUploads = this.getOrMakeUploadsFor(obj);
		// return objUploads.tapFileWrite(isNew, newVersion, baseVersion);
	}

	async removeCurrentVersionOf(obj: SyncedObj): Promise<void> {
		try {
			await this.remoteStorage.deleteObj(obj.objId!);
		} catch (exc) {

			// XXX
			//  - we need to distinguish errors and put this work somewhere
			//    to run when we go online, for example.

			await this.logError(exc, `Uploading of obj removal failed.`);
			return;
		}
		await obj.recordRemovalUploadAndGC();
	}

	async uploadFromDisk(
		obj: SyncedObj, localVersion: number, uploadVersion: number,
		uploadHeader: Uint8Array|undefined, syncedBase: number|undefined,
		createOnRemote: boolean
	): Promise<void> {
		const task = await UploadTask.for(
			obj, localVersion, uploadVersion, uploadHeader, syncedBase,
			createOnRemote,
			this.remoteStorage, this.execPools);
		this.execPools.add(task);
		await task.completion();
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

	private constructor(
		private readonly remoteStorage: StorageOwner,
		private readonly objId: ObjId,
		private readonly objStatus: UploadStatusRecorder,
		private readonly src: ObjSource,
		private readonly execPools: LabelledExecPools<UploadExecLabel>,
		private readonly info: NewVersionUpload,
		private readonly uploadHeader: Uint8Array|undefined
	) {
		this.execLabel = executorLabelFor(this.info.needUpload!);
		Object.seal(this);
	}

	static async for(
		obj: SyncedObj, localVersion: number, uploadVersion: number,
		uploadHeader: Uint8Array|undefined, syncedBase: number|undefined,
		createObj: boolean,
		remoteStorage: StorageOwner, execPools: LabelledExecPools<UploadExecLabel>
	): Promise<UploadTask> {
		const src = await obj.getObjSrcFromLocalAndSyncedBranch(localVersion);
		let needUpload: UploadNeedInfo;
		if (syncedBase) {
			const {
				diff, newSegsPackOrder
			} = await obj.diffForUploadOf(localVersion);
			needUpload = await diffVerUpload(
				src, uploadHeader, diff, newSegsPackOrder);
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
			remoteStorage, obj.objId, objStatus, src, execPools, info, uploadHeader
		);
	}

	neededExecutor(): UploadExecLabel|undefined {
		return (!this.info.needUpload ? undefined : this.execLabel);
	}

	completion(): Promise<void> {
		return this.uploadCompletion.promise;
	}

	async process(): Promise<void> {
		if (!this.info.needUpload) { return; }
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
				this.execPools.add(this);
			} else {
				this.uploadCompletion.resolve();
			}
		} catch (exc) {
			this.info.needUpload = undefined;
			this.uploadCompletion.reject(makeFSSyncException(`obj-upload`, {
				message: `Fail to upload local version ${this.info.uploadVersion}`,
				localVersion: this.info.uploadVersion,
				cause: exc
			}));
			await this.objStatus.recordUploadCancellation(this.info);
		}
	}

	private async startOrderedUpload(
		upload: WholeVerOrderedUpload
	): Promise<void> {
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
		return (this.uploadHeader ?
			this.uploadHeader : await this.src.readHeader());
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

	private async continueOrderedUpload(
		upload: WholeVerOrderedUpload
	): Promise<void> {
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

	private async continueOrderedDiffUpload(
		upload: DiffVerOrderedUpload
	): Promise<void> {
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