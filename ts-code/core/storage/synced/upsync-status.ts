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

import { DeduppedRunner } from '../../../lib-common/processes';
import * as fs from '../../../lib-common/async-fs-node';
import { join } from 'path';
import { readJSONInfoFileIn } from '../common/obj-info-file';
import { LogError } from '../../../lib-client/logging/log-to-file';

export interface UploadInfo {
	type: 'upload';
	transactionId?: string;
	awaiting?: {
		header?: true;
		segs: BytesSection[];
		allByteOnDisk?: true;
	};
	version: number;
	baseVersion?: number;
	done: boolean;
}

export interface BytesSection {
	ofs: number;
	len: number;
}

export interface RemovalInfo {
	type: 'removal',
	archivedVersions?: number[]|number;
	currentVersion?: true;
}

export interface ArchivalInfo {
	type: 'archiving',
	archivalOfCurrent?: true;
}

export type UpSyncTaskInfo = UploadInfo | RemovalInfo | ArchivalInfo;

interface UpSyncInfo {
	queued: UpSyncTaskInfo[];
	current?: UpSyncTaskInfo;
}

export function makeUploadInfo(
	version: number, baseVersion: number|undefined
): UploadInfo {
	return {
		type: 'upload',
		done: false,
		version,
		baseVersion
	};
}

const UPSYNC_FILE_NAME = 'upsync';


export class UpSyncTasks {

	private readonly saveProc = new DeduppedRunner(async () => {
		if (this.isDone()) {
			await fs.unlink(join(this.objFolder, UPSYNC_FILE_NAME)).catch(
				(e: fs.FileException) => { if (!e.notFound) { throw e; } });
		} else {
			await fs.writeFile(
				join(this.objFolder, UPSYNC_FILE_NAME),
				JSON.stringify(this.status),
				{ encoding: 'utf8' });
		}
	});
	private status: UpSyncInfo|undefined = undefined;
	private initProc: Promise<void>|undefined = undefined;
	private tasksAwaitingInit: UpSyncTaskInfo[]|undefined = undefined;

	constructor (
		private readonly objFolder: string,
		logError: LogError
	) {
		this.initProc = readOrMakeUpSyncInfo(this.objFolder).then(
			status => {
				this.status = status;
				if (this.tasksAwaitingInit) {
					for (const t of this.tasksAwaitingInit) {
						this.queueTask(t);
					}
					this.tasksAwaitingInit = undefined;
				}
				this.initProc = undefined;
			},
			err => {
				logError(err, `Can't setup upsync status.`);
				this.initProc = undefined;
			}
		);
		Object.seal(this);
	}

	queueTask(t: UpSyncTaskInfo): void {
		if (this.status) {
			addTaskToQueue(this.status.queued, t);
			this.saveProc.trigger();
		} else {
			if (!this.tasksAwaitingInit) {
				this.tasksAwaitingInit = [];
			}
			this.tasksAwaitingInit.push(t);
		}
	}

	async nextTask(): Promise<UpSyncTaskInfo|undefined> {
		if (!this.status) {
			await this.initProc;
			if (!this.status) { throw new Error(`Status not set after wait`); }
		}
		if (this.status.current) { return this.status.current; }
		this.status.current = this.status.queued.shift();
		if (this.status.current) {
			await this.saveProc.trigger();
		}
		return this.status.current;
	}

	async recordInterimStateOfCurrentTask(t: UploadInfo): Promise<void> {
		if (!this.status) { throw new Error(`This method is called too early.`); }
		if (this.status.current === t) {
			await this.saveProc.trigger();
		} else {
			throw new Error(`Can save interim state of a current task only`);
		}
	}

	async recordTaskCompletion(t: UpSyncTaskInfo): Promise<void> {
		if (!this.status) { throw new Error(`This method is called too early.`); }
		if (this.status.current === t) {
			this.status.current = undefined;
			await this.saveProc.trigger();
		}
	}

	isDone(): boolean {
		if (!this.status) {
			return false;
		} else {
			return (!this.status.current && (this.status.queued.length === 0));
		}
	}

}
Object.freeze(UpSyncTasks.prototype);
Object.freeze(UpSyncTasks);


function addTaskToQueue(q: UpSyncTaskInfo[], t: UpSyncTaskInfo): void {
	if (t.type === 'upload') {
		addUploadToQueue(q, t);
	} else if (t.type === 'removal') {
		addRemovalToQueue(q, t);
	} else if (t.type === 'archiving') {
		addArchivalToQueue(q, t);
	} else {
		throw new Error(`Unsupported upsync task type`);
	}
}

function addUploadToQueue(q: UpSyncTaskInfo[], u: UploadInfo): void {
	// XXX

	q.push(u);
}

function addRemovalToQueue(q: UpSyncTaskInfo[], r: RemovalInfo): void {
	// XXX

	q.push(r);
}

function addArchivalToQueue(q: UpSyncTaskInfo[], a: ArchivalInfo): void {
	// XXX

	q.push(a);
}

async function readOrMakeUpSyncInfo(objFolder: string): Promise<UpSyncInfo> {
	const status = await readJSONInfoFileIn<UpSyncInfo>(
		objFolder, UPSYNC_FILE_NAME);
	if (!status) {
		return { queued: [] };
	}

	// XXX we may do some checks and sanitization here

	return status;
}


Object.freeze(exports);