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

import { LogError, LogWarning } from "../../lib-client/logging/log-to-file";
import { assert } from "../../lib-common/assert";
import { errWithCause } from "../../lib-common/exceptions/error";
import { JsonKey } from "../../lib-common/jwkeys";

type WritableFS = web3n.files.WritableFS;
type FileException = web3n.files.FileException;

const LOGIN_KEY_FILE_NAME = 'login-keys';

export interface LoginKeysJSON {
	address: string;
	keys: JsonKey[];
}


export class IdKeysStorage {

	private fs: WritableFS|undefined = undefined;

	private constructor(
		private readonly logError: LogError,
		private readonly logWarning: LogWarning,
		fs?: WritableFS
	) {
		if (fs) {
			assert(fs.type === 'synced');
			this.fs = fs;
		}
		Object.seal(this);
	}

	static makeWithStorage(
		fs: WritableFS, logError: LogError, logWarning: LogWarning
	): IdKeysStorage {
		return new IdKeysStorage(logError, logWarning, fs);
	}

	static makeWithoutStorage(logError: LogError, logWarning: LogWarning): {
		store: IdKeysStorage;
		setupManagerStorage: (
			fs: WritableFS, keysToSave?: LoginKeysJSON
		) => Promise<void>;
	} {
		const store = new IdKeysStorage(logError, logWarning);
		return {
			store,
			setupManagerStorage: (fs, keys) => store.setStorageFS(fs, keys)
		};
	}

	async getSavedKey(): Promise<JsonKey|undefined> {
		if (!this.fs?.v?.sync) {
			throw new Error(`Id manager's storages are not set.`);
		}
		try {
			const json = await this.fs.readJSONFile<LoginKeysJSON>(
				LOGIN_KEY_FILE_NAME
			);
			return json.keys[0];
		} catch (exc) {
			if (!(exc as FileException).notFound) { throw exc; }
			await this.fs.v.sync.updateStatusInfo('');
			await this.fs.v.sync.adoptRemote('');
			if (await this.fs.checkFilePresence(LOGIN_KEY_FILE_NAME)) {
				return this.getSavedKey();
			} else {
				await this.logWarning(`IdManager: no saved login MailerId keys`);
				return;
			}
		}
	}

	private async setStorageFS(
		fs: WritableFS, keysToSave?: LoginKeysJSON
	): Promise<void> {
		assert(!this.fs)
		assert(fs.type === 'synced');
		this.fs = fs;
		if (keysToSave) {
			await this.fs.writeJSONFile(LOGIN_KEY_FILE_NAME, keysToSave);

			// XXX must add work with not-online condition

			await this.fs.v!.sync!.upload(LOGIN_KEY_FILE_NAME);
			await this.fs.v!.sync!.upload('');
		} else {
			try {
				await this.fs.readJSONFile(LOGIN_KEY_FILE_NAME);
			} catch (exc) {
				throw errWithCause(exc, `Fail expection read of login MailerId keys from the storage`);
			}
		}
	}

}
Object.freeze(IdKeysStorage.prototype);
Object.freeze(IdKeysStorage);


function notFoundOrReThrow(exc: FileException): void {
	if (!exc.notFound) { throw exc; }
}


Object.freeze(exports);