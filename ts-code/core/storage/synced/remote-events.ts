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

import { Subscription, merge, Observable, Subject, from } from 'rxjs';
import { StorageOwner } from '../../../lib-client/3nstorage/storage-owner';
import { ObjFiles } from './obj-files';
import { Storage } from '../../../lib-client/xsp-fs/common';
import { events } from '../../../lib-common/service-api/3nstorage/owner';
import { mergeMap, filter, share, map } from 'rxjs/operators';
import { LogError } from '../../../lib-client/logging/log-to-file';
import { addToStatus, ConnectionStatus, SubscribingClient } from '../../../lib-common/ipc/ws-ipc';

export interface StorageConnectionStatus extends ConnectionStatus {
	service: 'storage';
}

function toStorageConnectionStatus(
	status: ConnectionStatus, params?: Partial<StorageConnectionStatus>
): StorageConnectionStatus {
	return addToStatus<StorageConnectionStatus>(status, {
		service: 'storage',
		...params
	});
}

const SERVER_EVENTS_RESTART_WAIT_SECS = 5;


/**
 * Remote events are absorbed into objects' statuses, broadcasting respective
 * events. Someone down the stream can react to these changes from remote.
 */
export class RemoteEvents {

	private readonly connectionEvents = new Subject<StorageConnectionStatus>();
	readonly connectionEvent$ = this.connectionEvents.asObservable().pipe(share());

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

		this.absorbingRemoteEventsProc = from(this.remoteStorage.openEventSource().then(({ client, heartbeat }) => {
			heartbeat.subscribe({
				next: ev => this.connectionEvents.next(toStorageConnectionStatus(ev))
			});
			return client;
		}))
		.pipe(
			map(client => merge(
				this.absorbObjChange(client),
				this.absorbObjRemoval(client),

				// XXX commenting out to see if unknownEvent exception goes away
				//     Is server doesn't know it?
				// this.absorbObjVersionArchival(client),

				this.absorbArchVersionRemoval(client)
			)),
			mergeMap(event$ => event$)
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

	private absorbObjChange(client: SubscribingClient): Observable<void> {
		return (new Observable<events.objChanged.Event>(
			obs => client.subscribe(events.objChanged.EVENT_NAME, obs)
		))
		.pipe(
			mergeMap(async ({ newVer, objId }) => {
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

	private absorbObjRemoval(client: SubscribingClient): Observable<void> {
		return (new Observable<events.objRemoved.Event>(
			obs => client.subscribe(events.objRemoved.EVENT_NAME, obs)
		))
		.pipe(
			filter(objRmEvent => !!objRmEvent.objId),
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

	private absorbObjVersionArchival(client: SubscribingClient): Observable<void> {
		return (new Observable<events.objVersionArchived.Event>(
			obs => client.subscribe(events.objVersionArchived.EVENT_NAME, obs)
		))
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

	private absorbArchVersionRemoval(client: SubscribingClient): Observable<void> {
		return (new Observable<events.objArchivedVersionRemoved.Event>(
			obs => client.subscribe(events.objArchivedVersionRemoved.EVENT_NAME, obs)
		))
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