/*
 Copyright (C) 2022, 2025 - 2026 3NSoft Inc.

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

import { Observable } from "rxjs";
import { makeFSSyncException } from "../xsp-fs/exceptions";
import { assert } from "../../lib-common/assert";

type WritableFS = web3n.files.WritableFS;
type ReadonlyFS = web3n.files.ReadonlyFS;
type FSSyncException = web3n.files.FSSyncException;
type RemoteEvent = web3n.files.RemoteEvent;
type FileEvent = web3n.files.FileEvent;
type FolderEvent = web3n.files.FolderEvent;
type ConnectException = web3n.ConnectException;

export async function getRemoteFolderChanges(fs: WritableFS): Promise<void> {
	let { state } = await fs.v!.sync!.status('');
	if (state === 'behind') {
		await fs.v!.sync!.adoptRemote('');
	} else if (state === 'conflicting') {
		const path = ((typeof fs.name === 'string') ? fs.name : '');
		throw makeFSSyncException(path, {
			conflict: true,
			message: `Getting remote changes can't settle conflict in this function`
		});
	}
}

export async function getOrMakeDirOnInit(syncedFS: WritableFS, dir: string): Promise<WritableFS> {
	// Except for initial time, all folders exist and synced into parent, so, we shortcut sync check, if dir exists.
	// This allows to start while offline, when initialization has been done.
	if (await syncedFS.checkFolderPresence(dir)) {
		return await syncedFS.writableSubRoot(dir, { create: false });
	}
	await attemptToBringToSyncedState(syncedFS)
	.catch(exc => {
		console.error(`\n ------`, dir,exc);
	});
	if (await syncedFS.checkFolderPresence(dir)) {
		return await syncedFS.writableSubRoot(dir, { create: false });
	}
	try {
		const fs = await syncedFS.writableSubRoot(dir);
		await syncedFS.v!.sync!.upload(dir);
		await syncedFS.v!.sync!.upload('.');
		return fs;
	} catch (err) {
		await syncedFS.v!.sync!.adoptRemote('.').catch(noop);
		throw err;
	}
}

function noop() {}

async function attemptToBringToSyncedState(syncedFS: WritableFS): Promise<void> {
	const { existsInSyncedParent, state, remote } = await syncedFS.v!.sync!.status('');	
	if (state === 'behind') {
		await syncedFS.v!.sync!.adoptRemote('.');
	} else if (state === 'unsynced') {
		await syncedFS.v!.sync!.upload('.').catch(async (exc: FSSyncException) => {
			if (exc.type !== 'fs-sync') {
				throw exc;
			} else if (exc.childNeverUploaded) {
				await recursivelyUploadNewTreeItems(syncedFS, '.');
			}
		});
	} else if (state === 'conflicting') {
		await syncedFS.v!.sync!.absorbRemoteFolderChanges('.');
		await syncedFS.v!.sync!.upload('.', { uploadVersion: remote!.latest }).catch(async (exc: FSSyncException) => {
			if (exc.type !== 'fs-sync') {
				throw exc;
			} else if (exc.childNeverUploaded) {
				await recursivelyUploadNewTreeItems(syncedFS, '.', remote!.latest);
			}
		});
	} 
}

async function recursivelyUploadNewTreeItems(fs: WritableFS, path: string, uploadVersion?: number): Promise<void> {
	for (const item of await fs.listFolder(path)) {
		const { remote, synced } = await fs.v!.sync!.status(`${path}/${item.name}`);
		if (remote || synced) {
			continue;
		}
		if (item.isFolder) {
			await recursivelyUploadNewTreeItems(fs, `${path}/${item.name}`);
		}
		await fs.v!.sync!.upload(`${path}/${item.name}`);
	}
	await fs.v!.sync!.upload(path, { uploadVersion });
}

// export async function getOrMakeAndUploadFolderIn(fs: WritableFS, folder: string): Promise<WritableFS> {
// 	try {
// 		const childFolder = await fs.writableSubRoot(folder, { create: false });
// 		return childFolder;
// 	} catch (exc) {
// 		if (((exc as FileException).type === 'file') && (exc as FileException).notFound) {
// 			const childFolder = await fs.writableSubRoot(folder);
// 			await fs.v!.sync!.upload(folder);
// 			await fs.v!.sync!.upload('.');
// 			return childFolder;
// 		} else {
// 			throw exc;
// 		}
// 	}
// }

// XXX conflicts are app(let)-specific, hence, we can't have this "general" functionality.
export async function uploadFolderChangesIfAny(fs: WritableFS): Promise<void> {
	try {
		const { state } = await fs.v!.sync!.status('');
		if (state === 'unsynced') {
			await fs.v!.sync!.upload('');
		} else if (state === 'conflicting') {
			// XXX log conflicts error
			
		}
	} catch (exc) {
		if ((exc as ConnectException).type !== 'connect') {
			// XXX log generic error

		}
	}
}

export function observableFromTreeEvents(
	fs: ReadonlyFS, rootPath: string
): Observable<RemoteEvent|FileEvent|FolderEvent> {
	return new Observable(obs => fs.watchTree(rootPath, undefined, obs));
}


Object.freeze(exports);