/*
 Copyright (C) 2016 - 2019, 2025 3NSoft Inc.
 
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

import { StorageOwner } from '../../../lib-client/3nstorage/storage-owner';
import { ObjId } from '../../../lib-client/xsp-fs/common';
import { ObjDownloader, InitDownloadParts, Section, splitSegsDownloads, Download, DownloadsRunner } from '../../../lib-client/objs-on-disk/obj-on-disk';
import { Layout } from 'xsp-files';

const MAX_GETTING_CHUNK = 512*1024;
const DOWNLOAD_START_CHUNK = 128*1024;

export class Downloader implements ObjDownloader {

	private readonly runner = new DownloadsRunner();

	constructor(
		private readonly remoteStorage: StorageOwner
	) {
		Object.seal(this);
	}

	async getLayoutWithHeaderAndFirstSegs(objId: ObjId, version: number): Promise<InitDownloadParts> {
		const {
			header, segsTotalLen, version: currentVersion, segsChunk
		} = await this.remoteStorage.getCurrentObj(objId, DOWNLOAD_START_CHUNK);

		// XXX this gets current version, but it will have to change to getting
		// just version. It will be seen, if version's state needs passing.
		if (currentVersion !== version) {
			throw new Error(`Current version on server is ${currentVersion} while request was for ${version}`);
		}

		const layout: Layout = {
			sections: [ { src: 'new', ofs: 0, len: segsTotalLen } ]
		};
		return { header, segs: segsChunk, layout };
	}

	schedule(download: Download): void {
		this.runner.schedule(download);
	}

	getSegs(objId: ObjId, version: number, start: number, end: number): Promise<Uint8Array> {
		return this.remoteStorage.getCurrentObjSegs(objId, version, start, end);
	}

	async getCurrentObjVersion(objId: ObjId): Promise<{ version: number; parts: InitDownloadParts; }> {
		const {
			header, segsTotalLen, version, segsChunk: segs
		} = await this.remoteStorage.getCurrentObj(objId, DOWNLOAD_START_CHUNK);
		const layout: Layout = {
			sections: [ { src: 'new', ofs: 0, len: segsTotalLen } ]
		};
		return { version, parts: { header, segs, layout } };
	}

	splitSegsDownloads(start: number, end: number): Section[] {
		return splitSegsDownloads(start, end, MAX_GETTING_CHUNK);
	}

}
Object.freeze(Downloader.prototype);
Object.freeze(Downloader);


Object.freeze(exports);