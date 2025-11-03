/*
 Copyright (C) 2022, 2025 3NSoft Inc.

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

type WritableFS = web3n.files.WritableFS;
type ReadonlyFS = web3n.files.ReadonlyFS;
type FileException = web3n.files.FileException;
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

export async function getOrMakeAndUploadFolderIn(
	fs: WritableFS, folder: string
): Promise<WritableFS> {
	try {
		const childFolder = await fs.writableSubRoot(folder, { create: false });
		return childFolder;
	} catch (exc) {
		if (((exc as FileException).type === 'file')
		&& (exc as FileException).notFound) {
			const childFolder = await fs.writableSubRoot(folder);
			await fs.v!.sync!.upload(folder);
			return childFolder;
		} else {
			throw exc;
		}
	}
}

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