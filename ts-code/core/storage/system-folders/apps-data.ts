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

import { Subscription, Observable } from "rxjs";
import { filter, mergeMap } from "rxjs/operators";
import { sysFolders } from ".";
import { assert } from "../../../lib-common/assert";
import { SingleProc } from "../../../lib-common/processes/synced";

type WritableFS = web3n.files.WritableFS;
type FileException = web3n.files.FileException;
type RemoteEvent = web3n.files.RemoteEvent;
type RemoteChangeEvent = web3n.files.RemoteChangeEvent;
type RemoteRemovalEvent = web3n.files.RemoteRemovalEvent;
type Observer<T> = web3n.Observer<T>;


export class AppDataFolders {

	private writingSync: SingleProc|undefined = undefined;
	private syncFolderProc: Subscription|undefined;

	private constructor(
		private readonly fs: WritableFS
	) {
		assert(!!this.fs.v?.sync);
		this.startSyncProc();
		Object.seal(this);
	}

	static async make(rootFS: WritableFS): Promise<AppDataFolders> {
		const fs = await rootFS.writableSubRoot(
			sysFolders.appData, { create: false });
		return new AppDataFolders(fs);
	}

	async getOrMake(folder: string): Promise<WritableFS> {
		if (this.fs.v?.sync) {
			try {
				return await this.fs.writableSubRoot(folder, { create: false });
			} catch (exc) {
				if (((exc as FileException).type === 'file')
				&& (exc as FileException).notFound) {
					return this.makeSyncedFolder(folder);
				} else {
					throw exc;
				}
			}	
		} else {
			return await this.fs.writableSubRoot(folder);
		}
	}

	private syncP(): SingleProc {
		if (!this.writingSync) {
			this.writingSync = new SingleProc();
		}
		return this.writingSync;
	}

	private makeSyncedFolder(folder: string): Promise<WritableFS> {
		return this.syncP().startOrChain(async () => {
			await this.syncBeforeChange();
			try {
				await this.fs.makeFolder(folder, true);
			} catch (exc) {
				if (((exc as FileException).type === 'file')
				&& (exc as FileException).alreadyExists) {
					return this.fs.writableSubRoot(folder, { create: false });
				} else {
					throw exc;
				}
			}
			const fs = await this.fs.writableSubRoot(folder, { create: false });
			await this.uploadAfterCreationOf(folder);
			return fs;
		});
	}

	private async syncBeforeChange(): Promise<void> {
		const { state } = await this.fs.v!.sync!.updateStatusInfo('');
		if (state === 'behind') {
			await this.fs.v!.sync!.adoptRemote('');
		}
	}

	private async uploadAfterCreationOf(folder: string): Promise<void> {
		// XXX must add work with not-online condition
		await this.fs.v!.sync!.upload(folder);
		await this.fs.v!.sync!.upload('');
	}

	private startSyncProc(): void {
		this.syncFolderProc = (new Observable(
			(obs: Observer<RemoteEvent>) => this.fs.watchFolder('', obs)
		))
		.pipe(
			filter(ev => (ev.type === 'remote-change')),
			mergeMap(() => this.syncP().startOrChain(
				() => this.fs.v!.sync!.adoptRemote('')
			), 1)
		)
		.subscribe();
	}

	stopSync(): void {
		if (this.syncFolderProc) {
			this.syncFolderProc.unsubscribe();
			this.syncFolderProc = undefined;
		}
	}

}
Object.freeze(AppDataFolders.prototype);
Object.freeze(AppDataFolders);


Object.freeze(exports);