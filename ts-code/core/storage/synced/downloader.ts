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

import { StorageOwner } from '../../../lib-client/3nstorage/service';
import { NamedProcs } from '../../../lib-common/processes';
import { ObjId } from '../../../lib-client/3nstorage/xsp-fs/common';
import { ObjDownloader, InitDownloadParts } from '../../../lib-client/objs-on-disk/obj-on-disk';
import { Layout } from 'xsp-files';
import { joinByteArrs } from '../../../lib-common/buffer-utils';

const MAX_GETTING_CHUNK = 512*1024;
const DOWNLOAD_START_CHUNK = 128*1024;

export class Downloader implements ObjDownloader {

	/**
	 * Per-object chained downloads.
	 * When it comes to the download start, if chain exists, it means that
	 * process has already started.
	 */
	private downloadProcs = new NamedProcs();
	
	constructor(
		private remoteStorage: StorageOwner
	) {
		Object.seal(this);
	}

	private async sync<T>(
		objId: ObjId, version: number, action: () => Promise<T>
	): Promise<T> {
		const id = `${objId}/${version}`;
		return this.downloadProcs.startOrChain(id, action);
	}

	getLayoutWithHeaderAndFirstSegs(
		objId: ObjId, version: number
	): Promise<{ layout: Layout, header: Uint8Array; segs?: Uint8Array; }> {
		return this.sync(objId, version, async () => {

			// XXX this gets current version, but it will have to change to getting
			// just version. It will be seen, if version's state needs passing.

			const { header, segsTotalLen, version, segsChunk } =
				await this.remoteStorage.getCurrentObj(objId, DOWNLOAD_START_CHUNK);
			const layout: Layout = {
				sections: [ { src: 'new', ofs: 0, len: segsTotalLen } ]
			};
			return { header, segs: segsChunk, layout };
		});
	}

	getSegs(
		objId: ObjId, version: number, start: number, end: number
	): Promise<Uint8Array> {

		// XXX this gets current version, but it will have to change to getting
		// just version. It will be seen, if version's state needs passing.

		return this.sync(objId, version, async () => {
			if ((end - start) < MAX_GETTING_CHUNK) {
				const allBytes = await this.remoteStorage.getCurrentObjSegs(
					objId, version, start, end);
				return allBytes;
			} else {
				const chunks: Uint8Array[] = [];
				let ofs=start;
				while (ofs<end) {
					const len = Math.min(end-ofs, MAX_GETTING_CHUNK);
					const chunk = await this.remoteStorage.getCurrentObjSegs(
						objId, version, ofs, ofs+len);
					chunks.push(chunk);
					ofs += chunk.length;
				}
				return joinByteArrs(chunks);
			}
		});
	}

	getCurrentObjVersion(
		objId: ObjId
	): Promise<{ version: number, parts: InitDownloadParts; }> {
		return this.sync(objId, -1, async () => {
			const { header, segsTotalLen, version, segsChunk } =
				await this.remoteStorage.getCurrentObj(objId, DOWNLOAD_START_CHUNK);
			const layout: Layout = {
				sections: [ { src: 'new', ofs: 0, len: segsTotalLen } ]
			};
			return { version, parts: { header, segs: segsChunk, layout } };
		});
	}

}
Object.freeze(Downloader.prototype);
Object.freeze(Downloader);

Object.freeze(exports);