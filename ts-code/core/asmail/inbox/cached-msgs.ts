/*
 Copyright (C) 2019 - 2020 3NSoft Inc.

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

import { MsgOnDisk } from "./msg-on-disk";
import { makeTimedCache } from "../../../lib-common/timed-cache";
import { ObjFolders } from "../../../lib-client/objs-on-disk/obj-folders";
import { MsgDownloader } from "./msg-downloader";
import { MsgMeta } from "../../../lib-common/service-api/asmail/retrieval";
import { NamedProcs } from "../../../lib-common/processes";
import { LogError } from "../../../lib-client/logging/log-to-file";

export class CachedMessages {

	private readonly syncProc = new NamedProcs();
	private readonly msgFiles = makeTimedCache<string, MsgOnDisk>(60*1000);

	private constructor(
		private readonly folders: ObjFolders,
		private readonly downloader: MsgDownloader
	) {
		Object.freeze(this);
	}

	static async makeFor(
		path: string, downloader: MsgDownloader, logError: LogError
	): Promise<CachedMessages> {
		const folders = await ObjFolders.makeWithGenerations(
			path, async msgId => !msgs.msgFiles.has(msgId), logError);
		const msgs = new CachedMessages(folders, downloader);
		return msgs;
	}

	async findMsg(msgId: string): Promise<MsgOnDisk|undefined> {
		let msg = this.msgFiles.get(msgId);
		if (msg) { return msg; }

		return this.syncProc.startOrChain(msgId, async () => {
			const msgFolder = await this.folders.getFolderAccessFor(msgId);
			if (!msgFolder) { return; }

			msg = await MsgOnDisk.forExistingMsg(
				msgId, msgFolder, this.downloader);
			this.msgFiles.set(msgId, msg);
			return msg;
		});
	}
	
	async deleteMsg(msgId: string): Promise<void> {
		this.msgFiles.delete(msgId);
		return this.syncProc.startOrChain(
			msgId, () => this.folders.removeFolderOf(msgId));
	}

	addMsg(msgId: string, meta: MsgMeta): Promise<MsgOnDisk> {
		return this.syncProc.startOrChain(msgId, async () => {
			const msgFolder = await this.folders.getFolderAccessFor(msgId, true);
			const msg = await MsgOnDisk.createOnDisk(
				msgFolder!, msgId, meta, this.downloader);
			this.msgFiles.set(msgId, msg);
			return msg;
		});
	}

}
Object.freeze(CachedMessages.prototype);
Object.freeze(CachedMessages);


Object.freeze(exports);