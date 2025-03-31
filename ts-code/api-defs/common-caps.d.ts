/*
 Copyright (C) 2017 - 2018, 2020 - 2022, 2025 3NSoft Inc.
 
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

declare namespace web3n.caps.common {

	interface StoragePolicy {
		canOpenAppFS(appFolder: string, type: 'local'|'synced'): boolean;
		canOpenUserFS?: FSChecker;
		canOpenSysFS?: FSChecker;
		canAccessDevicePath?: DevPathChecker;
	}

	type FSChecker = (type: web3n.storage.StorageType) => 'w'|'r'|false;

	type DevPathChecker = (path: string) => 'w'|'r'|false;

	interface RequestedCAPs {
		keyrings?: 'all';
		mail?: MailCAPSetting;
		storage?: StorageCAPSetting;
		mailerid?: true;
		logToPlatform?: true;
	}

	interface StorageCAPSetting {
		appFS: 'default' | AppFSSetting[];
		userFS?: 'all'|FSSetting[];
		sysFS?: 'all'|FSSetting[];

		// XXX make FilesOnDeviceSetting|FilesOnDeviceSetting[] and
		// ensure that '*' option is ignored in array
		filesOnDevice?: FilesOnDeviceSetting[];
	}

	interface AppFSSetting {
		domain: string;
		storage: 'synced' | 'local' | 'synced-n-local';
	}

	interface FSSetting {
		type: web3n.storage.StorageType;
		writable: boolean;
	}

	interface FilesOnDeviceSetting {
		path: string;
		writable: boolean;
	}

	interface MailCAPSetting {
		preflightsTo?: 'all' | { whitelist: string[]; };
		sendingTo?: 'all' | { whitelist: string[]; };
		receivingFrom?: 'all' | { whitelist: string[]; };
		config?: 'all';
	}

	interface W3N {
		log: Logger;
		mail?: asmail.Service;
		storage?: storage.Service;
		mailerid?: mailerid.Service;
		keyrings?: keys.Keyrings;
	}

	type Logger = (
		type: 'error'|'info'|'warning', msg: string, err?: any
	) => Promise<void>;

}