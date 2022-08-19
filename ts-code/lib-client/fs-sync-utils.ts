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

import { makeFSSyncException } from "./3nstorage/exceptions";

type WritableFS = web3n.files.WritableFS;
type FileException = web3n.files.FileException;


export async function getRemoteFolderChanges(fs: WritableFS): Promise<void> {
	const { state } = await fs.v!.sync!.updateStatusInfo('');
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

export async function uploadFolderChangesIfAny(fs: WritableFS): Promise<void> {
	const { state } = await fs.v!.sync!.updateStatusInfo('');
	if ((state === 'synced') || (state === 'behind')) { return; }
	await fs.v!.sync!.upload('');
}


Object.freeze(exports);