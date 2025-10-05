/*
 Copyright (C) 2019 - 2020, 2022, 2025 3NSoft Inc.
 
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

import { Subscription, merge, Observable } from 'rxjs';
import { StorageOwner } from '../../../lib-client/3nstorage/storage-owner';
import { ObjFiles } from './obj-files';
import { Storage } from '../../../lib-client/xsp-fs/common';
import { ServerEvents } from '../../../lib-client/server-events';
import { events } from '../../../lib-common/service-api/3nstorage/owner';
import { mergeMap, filter } from 'rxjs/operators';
import { LogError } from '../../../lib-client/logging/log-to-file';

const SERVER_EVENTS_RESTART_WAIT_SECS = 5;


/**
 * Remote events are absorbed into objects' statuses, broadcasting respective
 * events. Someone down the stream can react to these changes from remote.
 */
export class RemoteEvents {

	constructor(
		private readonly remoteStorage: StorageOwner,
		private readonly files: ObjFiles,
		private readonly broadcastNodeEvent: Storage['broadcastNodeEvent'],
		private readonly logError: LogError
	) {
		Object.seal(this);
	}

	private absorbingRemoteEventsProc: Subscription|undefined = undefined;

	startAbsorbingRemoteEvents(): void {

		const serverEvents = new ServerEvents<
			events.EventNameType, events.AllTypes
		>(
			() => this.remoteStorage.openEventSource(this.logError)
		);

		this.absorbingRemoteEventsProc = merge(
			this.absorbObjChange(serverEvents),
			this.absorbObjRemoval(serverEvents),

			// XXX commenting out to see if unknownEvent exception goes away
			//     Is server doesn't know it?
			// this.absorbObjVersionArchival(serverEvents),

			this.absorbArchVersionRemoval(serverEvents)
		)
		.subscribe({
			next: noop,
			error: async err => {
				await this.logError(err);
				this.absorbingRemoteEventsProc = undefined;
			},
			complete: () => {
				this.absorbingRemoteEventsProc = undefined;
			}
		});
	}

	async close(): Promise<void> {
		if (this.absorbingRemoteEventsProc) {
			this.absorbingRemoteEventsProc.unsubscribe();
			this.absorbingRemoteEventsProc = undefined;
		}
	}

	private absorbObjChange(
		serverEvents: ServerEvents<events.EventNameType, events.AllTypes>
	): Observable<void> {
		return serverEvents.observe(events.objChanged.EVENT_NAME)
		.pipe(
			mergeMap(async ({ newVer, objId }: events.objChanged.Event) => {
				if (!Number.isInteger(newVer) || (newVer < 1)) { return; }
				const obj = await this.files.findObj(objId);
				if (!obj) { return; }
				obj.statusObj().recordRemoteChange(newVer);
				this.broadcastNodeEvent(obj.objId, undefined, undefined, {
					type: 'remote-change',
					path: '',
					newVersion: newVer
				});
			}, 1)
		);
	}

	private absorbObjRemoval(
		serverEvents: ServerEvents<events.EventNameType, events.AllTypes>
	): Observable<void> {
		return serverEvents.observe(events.objRemoved.EVENT_NAME)
		.pipe(
			filter((objRm: events.objRemoved.Event) => !!objRm.objId),
			mergeMap(async ({ objId }: events.objRemoved.Event) => {
				const obj = await this.files.findObj(objId);
				if (!obj) { return; }
				obj.statusObj().recordRemoteRemoval();
				this.broadcastNodeEvent(obj.objId, undefined, undefined, {
					type: 'remote-removal',
					path: ''
				});
			}, 1)
		);
	}

	private absorbObjVersionArchival(
		serverEvents: ServerEvents<events.EventNameType, events.AllTypes>
	): Observable<void> {
		return serverEvents.observe(events.objVersionArchived.EVENT_NAME)
		.pipe(
			mergeMap(async ({
				objId, archivedVer
			}: events.objVersionArchived.Event) => {
				const obj = await this.files.findObj(objId);
				if (!obj) { return; }
				obj.statusObj().recordVersionArchival(archivedVer);
				this.broadcastNodeEvent(obj.objId, undefined, undefined, {
					type: 'remote-version-archival',
					path: '',
					archivedVersion: archivedVer
				});
			}, 1)
		);
	}

	private absorbArchVersionRemoval(
		serverEvents: ServerEvents<events.EventNameType, events.AllTypes>
	): Observable<void> {
		return serverEvents.observe(
			events.objArchivedVersionRemoved.EVENT_NAME
		)
		.pipe(
			mergeMap(async ({
				objId, archivedVer
			}: events.objArchivedVersionRemoved.Event
			) => {
				const obj = await this.files.findObj(objId);
				if (!obj) { return; }
				obj.statusObj().recordArchVersionRemoval(archivedVer);
				this.broadcastNodeEvent(obj.objId, undefined, undefined, {
					type: 'remote-arch-ver-removal',
					path: '',
					removedArchVer: archivedVer
				});
			}, 1)
		);
	}

	suspendNetworkActivity(): void {
		// XXX
		// - set haveNetwork flag to false
		// - press breaks on events from server
	}

	resumeNetworkActivity(): void {
		// XXX
		// - set haveNetwork flag to true
		// - restart watching events from server
	}

}
Object.freeze(RemoteEvents.prototype);
Object.freeze(RemoteEvents);


function noop() {}


Object.freeze(exports);