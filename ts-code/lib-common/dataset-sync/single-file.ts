/*
 Copyright (C) 2026 3NSoft Inc.
 
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

import { SingleProc } from "../processes/synced";
import { runRetryingButNotBlockingOnDisconnect } from "./utils";

type WritableFS = web3n.files.WritableFS;
type WritableFile = web3n.files.WritableFile;

export async function initSyncedFile(
	syncedFS: WritableFS, fName: string, initNewFile: (newFile: WritableFile) => Promise<void>
): Promise<{ file: WritableFile; changeProc: SingleProc; }> {
	const changeProc = new SingleProc();
	const file = await syncedFS.writableFile(fName);

	if (file.isNew) {
		await initNewFile(file);
	}

	await runRetryingButNotBlockingOnDisconnect(
		async function ensureFileIsInFSTree() {
			const { existsInSyncedParent, synced } = await file.v!.sync!.status(false);
			if (!synced) {
				await file.v!.sync!.upload();
			}
			if (!existsInSyncedParent) {
				await syncedFS.v!.sync!.upload('.');
			}
		},
		() => file.v!.sync!.whenConnected(),
		changeProc
	);

	return { file, changeProc };
}

export function watchAndApplyChangesFromOtherDevices(
	file: WritableFile, changeProc: SingleProc,
	onChangeFromOtherDevices: (fileVersion: number, changeProc: SingleProc, file: WritableFile) => Promise<void>,
	onConflictingChangeFromOtherDevices: (changeProc: SingleProc, file: WritableFile) => Promise<void>,
) {

	function whenConnected() {
		return file.v!.sync!.whenConnected();
	}

	const stopFileWatching = file.watch({
		next: ev => {
			if (ev.type === 'remote-change') {
				runRetryingButNotBlockingOnDisconnect(
					() => checkStatusAndSyncFile(true),
					whenConnected, changeProc
				);
			} else if ((ev.type === 'file-change') && (ev.src === 'sync')) {
				onChangeFromOtherDevices(ev.newVersion!, changeProc, file);
			}
		}
	});

	function triggerUpload() {
		runRetryingButNotBlockingOnDisconnect(
			() => file.v!.sync!.upload(),
			whenConnected, changeProc
		);
	}

	async function checkStatusAndSyncFile(skipServerCheck?: true) {
		const { state } = await file.v!.sync!.status(skipServerCheck);
		if (state === 'behind') {
			await file.v!.sync!.adoptRemote();
		} else if (state === 'conflicting') {
			onConflictingChangeFromOtherDevices(changeProc, file);
		} else if (state === 'unsynced') {
			triggerUpload();
		}
	}

	// starting initial check with changeProc, without waiting here
	runRetryingButNotBlockingOnDisconnect(
		checkStatusAndSyncFile,
		whenConnected
	);

	return { stopFileWatching, triggerUpload };
}


Object.freeze(exports);