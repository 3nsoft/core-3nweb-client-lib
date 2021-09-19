/*
 Copyright (C) 2016 - 2017, 2021 3NSoft Inc.

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

/**
 * This is a namespace for things used by storage and any file functionality.
 */
declare namespace web3n.storage {

	interface Service {

		/**
		 * This returns a promise of an app's fs in local storage.
		 * @param appName is a reversed domain. If omitted, this app's main
		 * domain is assumed.
		 */
		getAppLocalFS(appName?: string): Promise<files.WritableFS>;

		/**
		 * This returns a promise of an app's fs in synced storage.
		 * @param appName is a reversed domain. If omitted, this app's main
		 * domain is assumed.
		 */
		getAppSyncedFS(appName?: string): Promise<files.WritableFS>;

		/**
		 * This returns a promise, resolvable to user fs. It will be either
		 * writable or readonly, depending on app's manifest setting.
		 * @param type is a type of fs requested, like synced, local, or device.
		 * @param path is an optional to get more specific fs.
		 */
		getUserFS?: (type: StorageType, path?: string) => Promise<files.FSItem>;

		/**
		 * This returns a promise, resolvable to system fs. It will be either
		 * writable or readonly, depending on app's manifest setting.
		 * @param type is a type of fs requested, like synced, local, or device.
		 * @param path is an optional to get more specific fs.
		 */
		getSysFS?: (type: StorageType, path?: string) => Promise<files.FSItem>;

	}

	type StorageType = 'device'|'synced'|'local';
	type StorageUse = 'user'|'system'|'app';

	interface StorageException extends web3n.RuntimeException {
		type: 'storage';
		appName?: string;
		badAppName?: boolean;
		notAllowedToOpenFS?: boolean;
		storageType?: StorageType;
		storageSegment: StorageUse;
	}

}
