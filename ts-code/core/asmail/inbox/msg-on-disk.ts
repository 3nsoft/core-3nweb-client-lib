/*
 Copyright (C) 2016 - 2019 3NSoft Inc.

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

import * as fs from '../../../lib-common/async-fs-node';
import { ObjOnDisk, ObjDownloader } from '../../../lib-client/objs-on-disk/obj-on-disk';
import { SingleProc } from '../../../lib-common/processes';
import { MsgMeta } from '../../../lib-common/service-api/asmail/retrieval';
import { errWithCause } from '../../../lib-common/exceptions/error';
import { ObjSource } from 'xsp-files';
import { MsgDownloader } from './msg-downloader';
import { join } from 'path';

export type MsgKeyStatus = 'not-checked' | 'not-found' | 'fail' | 'ok';

export interface ObjSize {
	header: number;
	segments: number;
}

export interface MsgStatus {
	msgId: string;
	keyStatus: MsgKeyStatus;
	onDisk: boolean;
	mainObjId: string;
	deliveryTS: number;
}

const META_FNAME = 'meta.json';
const STATUS_FNAME = 'status.json';

function makeInitMsgStatus(msgId: string, meta: MsgMeta): MsgStatus {
	return {
		msgId,
		keyStatus: 'not-checked',
		onDisk: false,
		mainObjId: meta.extMeta.objIds[0],
		deliveryTS: meta.deliveryStart
	};
}

export class MsgOnDisk {

	private readonly syncProc = new SingleProc();

	private readonly objs = new Map<string, ObjOnDisk>();

	private readonly objDownloader: ObjDownloader;

	private constructor(
		public readonly msgId: string,
		private readonly msgFolderPath: string,
		private readonly msgDownloader: MsgDownloader,
		public readonly status: MsgStatus,
		private readonly objsIds: Set<string>
	) {
		this.objDownloader = this.msgDownloader.getObjDownloader(msgId);
		Object.freeze(this.objDownloader);
		Object.freeze(this);
	}

	static async forExistingMsg(msgId: string, path: string,
			msgDownloader: MsgDownloader): Promise<MsgOnDisk> {
		const meta = await readJSON<MsgMeta>(path, META_FNAME, msgId);
		const status = await readJSON<MsgStatus>(path, STATUS_FNAME, msgId);
		const objIds = objIdsFromMeta(meta);
		return new MsgOnDisk(msgId, path, msgDownloader, status, objIds);
	}

	static async createOnDisk(path: string, msgId: string, meta: MsgMeta,
			msgDownloader: MsgDownloader): Promise<MsgOnDisk> {
		const status = makeInitMsgStatus(msgId, meta);
		const objIds = objIdsFromMeta(meta);
		const msg = new MsgOnDisk(msgId, path, msgDownloader, status, objIds);
		await writeJSON(path, META_FNAME, meta, true);
		await writeJSON(path, STATUS_FNAME, status, true);
		return msg;
	}

	getMsgMeta(): Promise<MsgMeta> {
		return readJSON<MsgMeta>(this.msgFolderPath, META_FNAME, this.msgId);
	}

	private objFilePath(objId: string): string {
		return join(this.msgFolderPath, objId);
	}

	async getObjFile(objId: string): Promise<ObjOnDisk> {
		let file = this.objs.get(objId);
		if (file) { return file; }
		if (!this.objsIds.has(objId)) { throw new Error(
			`Obj ${objId} not present in message ${this.msgId}`); }
		const path = this.objFilePath(objId);
		const isOnDisk = !!(await fs.stat(path)
		.catch((exc: fs.FileException) => {
			if (exc.notFound) { return; }
			throw errWithCause(exc, `Cannot stat message obj at ${path}`);
		}));
		file = (isOnDisk ?
			await ObjOnDisk.forExistingFile(objId, 0, path, this.objDownloader) :
			await ObjOnDisk.createFileForExistingVersion(
				objId, 0, path, this.objDownloader));
		this.objs[objId] = file;
		return file;
	}

	async getMsgObj(objId: string): Promise<ObjSource> {
		const objFile = await this.getObjFile(objId);
		return objFile.getSrc()
	}

	get deliveryTS(): number {
		return this.status.deliveryTS;
	}

	get keyStatus(): MsgKeyStatus {
		return this.status.keyStatus;
	}

	updateMsgKeyStatus(newStatus: MsgKeyStatus): Promise<void> {
		return this.syncProc.startOrChain(async () => {
			if (newStatus === 'not-checked') { throw new Error(
				`New key status cannot be ${newStatus}.`); }
			if (this.status.keyStatus === 'not-checked') {
				this.status.keyStatus = newStatus;
			} else {
				throw Error(`Message has key status ${this.status.keyStatus}, and can't be updated to ${newStatus}`);
			}
			await this.saveStatusToDisk();
		});
	}

	private async saveStatusToDisk(): Promise<void> {
		await writeJSON(this.msgFolderPath, STATUS_FNAME, this.status);
	}

}
Object.freeze(MsgOnDisk.prototype);
Object.freeze(MsgOnDisk);

async function readJSON<T>(msgFolderPath: string, fname: string, msgId: string):
		Promise<T> {
	const path = join(msgFolderPath, fname);
	try {
		return JSON.parse(await fs.readFile(
			path, { flag: 'r', encoding: 'utf8' }));
	} catch (err) {
		throw errWithCause(err, `Can't read file ${fname} of message ${msgId}`);
	}
}

async function writeJSON(msgFolderPath: string, fname: string, json: any,
		exclusive = false): Promise<void> {
	const path = join(msgFolderPath, fname);
	await fs.writeFile(path, JSON.stringify(json),
		{ flag: (exclusive ? 'wx' : 'w') });
}

function objIdsFromMeta(meta: MsgMeta): Set<string> {
	const ids = new Set<string>();
	for (const objId of Object.keys(meta.objs)) {
		ids.add(objId);
	}
	return ids;
}


Object.freeze(exports);