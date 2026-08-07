/*
 Copyright (C) 2022 3NSoft Inc.

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

import { makeFSCollection } from "../../../lib-client/fs-utils/fs-collection";
import { DeviceFS } from "../../../lib-index";

type WritableFS = web3n.files.WritableFS;
type FSItem = web3n.files.FSItem;


export const sysFolders = {
	appData: 'Apps Data',
	apps: 'Apps Code',
	packages: 'App&Lib Packs',
	sharedLibs: 'Shared Libs',
	userFiles: 'User Files'
};
Object.freeze(sysFolders);

/**
 * This function creates system folder structure in a given root.
 * Folder objects are uploaded, if it is a synced root.
 * @param root 
 */
export async function initSysFolders(root: WritableFS): Promise<void> {
	for (const sysFolder of Object.values(sysFolders)) {
		await root.makeFolder(sysFolder);
		if (root.v?.sync) {
			// XXX need not-online condition, but it runs only on first install, when network is required
			await root.v.sync.upload(sysFolder);
		}
	}
	if (root.v?.sync) {
		// XXX need not-online condition, but it runs only on first install, when network is required
		await root.v.sync.upload('.');
	}
}

export async function userFilesOnDevice(): Promise<FSItem> {
	if (process.platform === 'win32') {
		if (process.env.USERPROFILE) {
			return {
				isFolder: true,
				item: await DeviceFS.makeWritable(process.env.USERPROFILE)
			};
		}
	} else {
		if (process.env.HOME) {
			return {
				isFolder: true,
				item: await DeviceFS.makeWritable(process.env.HOME)
			};
		}
	}
	return {
		isCollection: true,
		item: makeFSCollection()
	};
}


Object.freeze(exports);