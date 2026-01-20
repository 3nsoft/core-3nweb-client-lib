/*
 Copyright (C) 2019 - 2020, 2022, 2025 - 2026 3NSoft Inc.
 
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

import { Observable, Subject, from } from 'rxjs';
import { StorageOwner } from '../../../lib-client/3nstorage/storage-owner';
import { ObjFiles } from './obj-files';
import { Storage } from '../../../lib-client/xsp-fs/common';
import { events } from '../../../lib-common/service-api/3nstorage/owner';
import { mergeMap, filter, share } from 'rxjs/operators';
import { LogError } from '../../../lib-client/logging/log-to-file';
import { addToStatus, ConnectionStatus, SubscribingClient, WebSocketListening } from '../../../lib-common/ipc/ws-ipc';

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
	private readonly wsProc: WebSocketListening;

	constructor(
		private readonly remoteStorage: StorageOwner,
		private readonly files: ObjFiles,
		private readonly broadcastNodeEvent: Storage['broadcastNodeEvent'],
		private readonly logError: LogError
	) {
		this.wsProc = new WebSocketListening(
			SERVER_EVENTS_RESTART_WAIT_SECS,
			this.makeProc.bind(this)
		);
		Object.seal(this);
	}

	private makeProc(): Observable<void> {
		return from(this.remoteStorage.openEventSource().then(({ client, heartbeat }) => {
			this.remoteStorage.connectedState.setState();
			heartbeat.subscribe({
				next: ev => {
					this.connectionEvents.next(toStorageConnectionStatus(ev));
					if (ev.type === 'heartbeat') {
						this.remoteStorage.connectedState.setState();
					} else if ((ev.type === 'heartbeat-skip') || (ev.type === 'disconnected')) {
						this.remoteStorage.connectedState.clearState();
					}
				}
			});
			return [
				this.absorbObjChange(client),
				this.absorbObjRemoval(client),

				// XXX commenting out these for now, as server hasn't implemented these
				// this.absorbObjVersionArchival(client),
				// this.absorbArchVersionRemoval(client)
			];
		}))
		.pipe(
			mergeMap(event$ => event$),
			mergeMap(event$ => event$),
		);
	}

	startListening(): void {
		this.wsProc.startListening();
	}

	async close(): Promise<void> {
		this.connectionEvents.complete();
		this.wsProc.close();
	}

	whenConnected(): Promise<void> {
		return this.remoteStorage.connectedState.whenStateIsSet();
	}

	private absorbObjChange(client: SubscribingClient): Observable<void> {
		return (new Observable<events.objChanged.Event>(
			obs => client.subscribe(events.objChanged.EVENT_NAME, obs)
		))
		.pipe(
			mergeMap(async ({ newVer: newRemoteVersion, objId }) => {
				if (!Number.isInteger(newRemoteVersion) || (newRemoteVersion < 1)) { return; }
				const obj = await this.files.findObj(objId);
				if (!obj) { return; }
				const syncStatus = obj.syncStatus().syncStatus();
				if (!syncStatus.synced?.latest || (syncStatus.synced.latest >= newRemoteVersion)) { return; }
				obj.statusObj().recordRemoteChange(newRemoteVersion);
				this.broadcastNodeEvent(obj.objId, undefined, undefined, {
					type: 'remote-change',
					path: '',
					newRemoteVersion,
					syncStatus: obj.syncStatus().syncStatus()
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
					path: '',
					syncStatus: obj.syncStatus().syncStatus()
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
					archivedVersion: archivedVer,
					syncStatus: obj.syncStatus().syncStatus()
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
					removedArchVer: archivedVer,
					syncStatus: obj.syncStatus().syncStatus()
				});
			}, 1)
		);
	}

	// XXX we should go along:
	//  - last working connection and ping
	//  - may be have an expect suspending of network, with less aggressive attempts to reconnect
	//  - instead of talking about presence of network, expose methods to nudge restarting behaviour, as outside
	//    may have better clues and able to command behaviour switch

	suspendNetworkActivity(): void {
		// XXX
		// - ...
	}

	resumeNetworkActivity(): void {
		if (!this.wsProc.isListening) {
			this.wsProc.startListening();
		}
	}

}
Object.freeze(RemoteEvents.prototype);
Object.freeze(RemoteEvents);


Object.freeze(exports);