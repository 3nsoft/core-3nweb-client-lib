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

import { NamedProcs } from "../../../lib-common/processes";
import { MailRecipient } from "../../../lib-client/asmail/recipient";
import { ObjDownloader, InitDownloadParts } from "../../../lib-client/objs-on-disk/obj-on-disk";
import { MsgMeta } from "../../../lib-common/service-api/asmail/retrieval";
import { Layout } from "xsp-files";
import { joinByteArrs } from "../../../lib-common/buffer-utils";
import { ObjId } from "../../../lib-client/3nstorage/xsp-fs/common";

const MAX_GETTING_CHUNK = 512*1024;
const DOWNLOAD_START_CHUNK = 128*1024;

/**
 * Downloader is responsible for getting mail objects from server and placing
 * bytes into cache.
 */
export class MsgDownloader {

	/**
	 * Per-object chained downloads.
	 * When it comes to the download start, if chain exists, it means that
	 * process has already started.
	 */
	private downloadProcs = new NamedProcs();

	constructor(
		private msgReceiver: MailRecipient
	) {
		Object.freeze(this);
	}

	private async sync<T>(msgId: string, objId: ObjId,
			action: () => Promise<T>): Promise<T> {
		const id = `${msgId}/${objId}`;
		return this.downloadProcs.startOrChain(id, action);
	}

	getMsgMeta(msgId: string): Promise<MsgMeta> {
		return this.sync(msgId, null, () => this.msgReceiver.getMsgMeta(msgId));
	}

	getObjDownloader(msgId: string): ObjDownloader {
		return {
			getLayoutWithHeaderAndFirstSegs: objId =>
				this.getLayoutWithHeaderAndFirstSegs(msgId, objId),
			getSegs: (objId, v, start, end) =>
				this.getSegs(msgId, objId, start, end)
		};
	}

	private async getLayoutWithHeaderAndFirstSegs(
		msgId: string, objId: ObjId
	): Promise<InitDownloadParts> {
		if (!objId) { throw new Error(`Message object cannot be null`); }
		const { header, segsChunk, segsTotalLen } = await this.sync(msgId, objId,
			() => this.msgReceiver.getObj(msgId, objId, DOWNLOAD_START_CHUNK));
		const layout: Layout = {
			sections: [ { src: 'new', ofs: 0, len: segsTotalLen } ]
		};
		return { header, segs: segsChunk, layout };
	}

	private async getSegs(
		msgId: string, objId: ObjId, start: number, end: number
	): Promise<Uint8Array> {
		if (!objId) { throw new Error(`Message object cannot have null id`); }
		return this.sync(msgId, objId, async () => {
			if ((end - start) < MAX_GETTING_CHUNK) {
				const allBytes = await this.msgReceiver.getObjSegs(
					msgId, objId, start, end);
				return allBytes;
			} else {
				const chunks: Uint8Array[] = [];
				let ofs=start;
				while (ofs<end) {
					const len = Math.min(end-ofs, MAX_GETTING_CHUNK);
					const chunk = await this.msgReceiver.getObjSegs(
						msgId, objId, ofs, ofs+len);
					chunks.push(chunk);
					ofs += chunk.length;
				}
				return joinByteArrs(chunks);
			}
		});
	}
	
}
Object.freeze(MsgDownloader.prototype);
Object.freeze(MsgDownloader);

Object.freeze(exports);