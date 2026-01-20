/*
 Copyright (C) 2016 - 2019, 2025 - 2026 3NSoft Inc.

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

import { MailRecipient } from "../../../lib-client/asmail/recipient";
import { ObjDownloader, InitDownloadParts, splitSegsDownloads, DownloadsRunner } from "../../../lib-client/objs-on-disk/obj-on-disk";
import { MsgMeta } from "../../../lib-common/service-api/asmail/retrieval";
import { Layout } from "xsp-files";
import { ObjId } from "../../../lib-client/xsp-fs/common";

const MAX_GETTING_CHUNK = 512*1024;
const DOWNLOAD_START_CHUNK = 128*1024;

export class MsgDownloader {

	private readonly runner = new DownloadsRunner();

	constructor(
		private readonly msgReceiver: MailRecipient
	) {
		Object.freeze(this);
	}

	getMsgMeta(msgId: string): Promise<MsgMeta> {
		return this.msgReceiver.getMsgMeta(msgId);
	}

	getObjDownloader(msgId: string): ObjDownloader {
		return {
			getLayoutWithHeaderAndFirstSegs: (objId, v) => this.getLayoutWithHeaderAndFirstSegs(msgId, objId),
			getSegs: (objId, v, start, end) => this.getSegs(msgId, objId, start, end),
			splitSegsDownloads: (start, end) => splitSegsDownloads(start, end, MAX_GETTING_CHUNK),
			schedule: this.runner.schedule.bind(this.runner),
			whenConnected: () => this.msgReceiver.connectedState.whenStateIsSet()
		};
	}

	private async getLayoutWithHeaderAndFirstSegs(msgId: string, objId: ObjId): Promise<InitDownloadParts> {
		const { header, segsChunk, segsTotalLen } = await this.msgReceiver.getObj(msgId, objId!, DOWNLOAD_START_CHUNK);
		const layout: Layout = {
			sections: [ { src: 'new', ofs: 0, len: segsTotalLen } ]
		};
		return { header, segs: segsChunk, layout };
	}

	private getSegs(msgId: string, objId: ObjId, start: number, end: number): Promise<Uint8Array> {
		return this.msgReceiver.getObjSegs(msgId, objId!, start, end);
	}
	
}
Object.freeze(MsgDownloader.prototype);
Object.freeze(MsgDownloader);


Object.freeze(exports);