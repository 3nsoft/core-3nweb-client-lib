/*
 Copyright (C) 2019 - 2020 3NSoft Inc.
 
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

import { Subscription, merge } from 'rxjs';
import { StorageOwner } from '../../../lib-client/3nstorage/service';
import { ObjFiles } from './obj-files';
import { Node, ObjId } from '../../../lib-client/3nstorage/xsp-fs/common';
import { ServerEvents } from '../../../lib-client/server-events';
import { objChanged, objRemoved } from '../../../lib-common/service-api/3nstorage/owner';
import { flatMap, filter } from 'rxjs/operators';
import { LogError } from '../../../lib-client/logging/log-to-file';

export type GetFSNode = (objId: ObjId) => Node|undefined;

const SERVER_EVENTS_RESTART_WAIT_SECS = 30;

export class RemoteEvents {

	constructor(
		private readonly remoteStorage: StorageOwner,
		private readonly files: ObjFiles,
		private readonly fsNodes: GetFSNode,
		private readonly logError: LogError
	) {
		Object.seal(this);
	}

	private absorbingRemoteEventsProc: Subscription|undefined = undefined;

	startAbsorbingRemoteEvents(): void {

		const serverEvents = new ServerEvents(
			() => this.remoteStorage.openEventSource(),
			SERVER_EVENTS_RESTART_WAIT_SECS);

		const objChange$ = serverEvents.observe<objChanged.Event>(
			objChanged.EVENT_NAME)
		.pipe(
			filter(objChange =>
				Number.isInteger(objChange.newVer) && (objChange.newVer > 1)),
			flatMap(objChange => this.remoteChange(objChange))
		);

		const objRemoval$ = serverEvents.observe<objRemoved.Event>(
			objRemoved.EVENT_NAME)
		.pipe(
			filter(objRm => !!objRm.objId),
			flatMap(objRm => this.remoteRemoval(objRm))
		);

		this.absorbingRemoteEventsProc = merge(objChange$, objRemoval$)
		.subscribe(undefined,
			err => this.logError(err),
			() => { this.absorbingRemoteEventsProc = undefined; });
	}

	async close(): Promise<void> {
		if (this.absorbingRemoteEventsProc) {
			this.absorbingRemoteEventsProc.unsubscribe();
		}
	}

	/**
	 * Information about external event is recorded into obj status before
	 * main processing takes place. This allows to synchronize all obj changes,
	 * while informing already scheduled processes.
	 * @param objChange 
	 */
	private async remoteChange(objChange: objChanged.Event): Promise<void> {
		const obj = await this.files.findObj(objChange.objId);
		if (!obj) { return; }

		if (obj.isRemoteVersionGreaterOrEqualTo(objChange.newVer)) { return; }

		await obj.setRemoteVersion(objChange.newVer);

		try {
			const nodeInFS = this.fsNodes(objChange.objId);
			if (nodeInFS) {
				await nodeInFS.processRemoteEvent({
					type: 'remote-change',
					newVer: objChange.newVer,
					objId: objChange.objId
				});
			}
		} catch (err) {
			this.logError(err, `Error in processing remote change event`);
		}
	}

	private async remoteRemoval(objRm: objRemoved.Event): Promise<void> {
		const obj = await this.files.findObj(objRm.objId);
		if (!obj) { return; }

		if (obj.isArchived() || obj.isDeletedOnRemote()) { return; }

		await obj.setDeletedOnRemote();

		try {
			const nodeInFS = this.fsNodes(objRm.objId);
			if (nodeInFS) {
				await nodeInFS.processRemoteEvent({
					type: 'remote-delete',
					objId: objRm.objId
				});
			}
		} catch (err) {
			this.logError(err, `Error in processing remote change event`);
		}
	}

}
Object.freeze(RemoteEvents.prototype);
Object.freeze(RemoteEvents);


Object.freeze(exports);