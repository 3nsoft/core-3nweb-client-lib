/*
 Copyright (C) 2015 - 2018, 2020 3NSoft Inc.

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

import { DeviceFS } from '../lib-client/local-files/device-fs';
import { stat, mkdir } from '../lib-common/async-fs-node';
import { utf8, base64urlSafe } from '../lib-common/buffer-utils';
import { FileException } from '../lib-common/exceptions/file';
import { errWithCause } from '../lib-common/exceptions/error';
import { join } from 'path';

type WritableFS = web3n.files.WritableFS;

function userIdToFolderName(userId: string): string {
	return base64urlSafe.pack(utf8.pack(userId));
}

function folderNameToUserId(folderName: string): string {
	return utf8.open(base64urlSafe.open(folderName));
}

export const UTIL_DIR = 'util';
const INBOX_DIR = 'inbox';
const STORAGE_DIR = 'storage';

export function appDirs(appDir: string) {

	function userDataPath(user: string): string {
		return join(appDir, userIdToFolderName(user));
	};

	async function appFS(): Promise<WritableFS> {
		await stat(appDir).catch(async (e: FileException) => {
			if (!e.notFound) { throw e; }
			await mkdir(appDir).catch((e: FileException) => {
				if (e.alreadyExists) { return; }
				throw errWithCause(e, `Cannot create app folder on the disk`);
			});
		});
		return DeviceFS.makeWritable(appDir);
	}
	
	return Object.freeze({

		getUtilFS(): string {
			return join(appDir, UTIL_DIR);
		},

		storagePathFor(user: string): string {
			return join(userDataPath(user), STORAGE_DIR);
		},

		inboxPathFor(user: string): string {
			return join(userDataPath(user), INBOX_DIR);
		},

		async getUsersOnDisk(): Promise<string[]> {
			const rootFS = await appFS();
			const lst = await rootFS.listFolder('');
			const users: string[] = [];
			for (const entry of lst) {
				if (!entry.isFolder || (entry.name === UTIL_DIR)) { continue; }
				try {
					users.push(folderNameToUserId(entry.name));
				} catch (e) { continue; }
			}
			return users;
		},
		
	});
}

export type AppDirs = ReturnType<typeof appDirs>;

export type GetUsersOnDisk = AppDirs['getUsersOnDisk'];

export type StoragePathForUser = AppDirs['storagePathFor'];

export type InboxPathForUser = AppDirs['inboxPathFor'];


Object.freeze(exports);