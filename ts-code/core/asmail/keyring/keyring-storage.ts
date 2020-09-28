/*
 Copyright (C) 2018 3NSoft Inc.
 
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

import { SingleProc } from "../../../lib-common/processes";

type WritableFS = web3n.files.WritableFS;
type FileException = web3n.files.FileException;

export interface KeyringStorage {
	load(): Promise<string|undefined>;
	save(serialForm: string): void;
	start(): Promise<void>;
	close(): Promise<void>;
}

const KEYRING_FNAME = 'keyring.json';

export function makeKeyringStorage(fs: WritableFS): KeyringStorage {
	const proc = new SingleProc();

	// initialization for code that works only with version 1
	proc.start(async () => {
		fs = await checkAndUpgradeDataToV1(fs);
	});

	const storage: KeyringStorage = {
		save: (serialForm: string) => proc.startOrChain(
			() => fs.writeTxtFile(KEYRING_FNAME, serialForm)),
		close: () => fs.close(),
		start: async () => {
			
			// XXX start watching keyring file

		},
		load: () => proc.startOrChain(
			() => fs.readTxtFile(KEYRING_FNAME).catch(notFoundOrReThrow))
	};
	return Object.freeze(storage);
}

/**
 * This is a catch callback, which returns undefined on file(folder) not found
 * exception, and re-throws all other exceptions/errors.
 */
function notFoundOrReThrow(exc: FileException): undefined {
	if (!exc.notFound) { throw exc; }
	return;
}

const VERSION_1_FOLDER_NAME = 'v1';
async function checkAndUpgradeDataToV1(krFS: WritableFS): Promise<WritableFS> {
	const v1FS = await krFS.writableSubRoot(VERSION_1_FOLDER_NAME);

	// XXX can we have an upgrade from no version to version 1 ?

	return v1FS;
}


Object.freeze(exports);