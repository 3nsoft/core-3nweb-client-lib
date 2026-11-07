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

import { Observable, Subject, merge } from 'rxjs';
import { StorageOwner } from '../../../lib-client/3nstorage/storage-owner';
import { ObjFiles } from './obj-files';
import { Storage } from '../../../lib-client/xsp-fs/common';
import { events } from '../../../lib-common/service-api/3nstorage/owner';
import { mergeMap, filter, share } from 'rxjs/operators';
import type { LogError } from '../../../lib-client/logging/log-to-file';
import { addToStatus, type ConnectionStatus } from '../../../lib-client/request-utils';
import { noop } from '../common/utils';
import { SubscribingClient } from '../../../lib-common/ipc/generic-ipc';
import { CancellableProcHolder } from '../../../lib-common/utils-for-observables';

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


/**
 * Remote events are absorbed into objects' statuses, broadcasting respective
 * events. Someone down the stream can react to these changes from remote.
 */
export class RemoteEvents {

	private readonly connectionEvents = new Subject<StorageConnectionStatus>();
	readonly connectionEvent$ = this.connectionEvents.asObservable().pipe(share());
	private listening = new CancellableProcHolder();

	constructor(
		private readonly remoteStorage: StorageOwner,
		private readonly files: ObjFiles,
		private readonly broadcastNodeEvent: Storage['broadcastNodeEvent'],
		private readonly logError: LogError
	) {
		Object.seal(this);
	}

	private async subscribeToEventSrcAndPassHeartbeats(): Promise<Observable<unknown>> {
		const { client, watchHeartbeat } = await this.remoteStorage.openEventSource();
		watchHeartbeat({
			next: ev => {
				this.connectionEvents.next(toStorageConnectionStatus(ev));
				if (ev.type === 'heartbeat') {
					this.remoteStorage.connectedState.setState();
				} else if ((ev.type === 'heartbeat-skip') || (ev.type === 'disconnected')) {
					this.remoteStorage.connectedState.clearState();
				}
			}
		});
		return merge(
			this.absorbObjChange(client),
			this.absorbObjRemoval(client),

			// XXX commenting out these for now, as server hasn't implemented these
			// this.absorbObjVersionArchival(client),
			// this.absorbArchVersionRemoval(client)
		);
	}

	async close(): Promise<void> {
		this.listening.stop();
		this.connectionEvents.complete();
	}

	whenConnected(): Promise<void> {
		return this.remoteStorage.connectedState.whenStateIsSet();
	}

	isConnected(): boolean {
		return this.remoteStorage.connectedState.isSet();
	}

	private absorbObjChange(client: SubscribingClient): Observable<events.objChanged.Event|undefined> {
		return (new Observable<events.objChanged.Event>(
			obs => client.subscribe(events.objChanged.EVENT_NAME, obs)
		))
		.pipe(
			mergeMap(async ev => {
				const { newVer: newRemoteVersion, objId } = ev;
				if (!Number.isInteger(newRemoteVersion) || (newRemoteVersion < 1)) { return; }
				const obj = await this.files.findObj(objId);
				if (!obj) { return; }
				const syncStatus = obj.syncStatus().syncStatus();
				if (!syncStatus.synced?.latest || (syncStatus.synced.latest >= newRemoteVersion)) { return; }
				obj.statusObj().recordRemoteChange(newRemoteVersion).catch(noop);
				this.broadcastNodeEvent(obj.objId, undefined, undefined, {
					type: 'remote-change',
					path: '',
					newRemoteVersion,
					syncStatus: obj.syncStatus().syncStatus()
				});
				return ev;
			}, 1)
		);
	}

	private absorbObjRemoval(client: SubscribingClient): Observable<events.objRemoved.Event|undefined> {
		return (new Observable<events.objRemoved.Event>(
			obs => client.subscribe(events.objRemoved.EVENT_NAME, obs)
		))
		.pipe(
			filter(objRmEvent => !!objRmEvent.objId),
			mergeMap(async ev => {
				const obj = await this.files.findObj(ev.objId);
				if (!obj) { return; }
				obj.statusObj().recordRemoteRemoval().catch(noop);
				this.broadcastNodeEvent(obj.objId, undefined, undefined, {
					type: 'remote-removal',
					path: '',
					syncStatus: obj.syncStatus().syncStatus()
				});
				return ev;
			}, 1)
		);
	}

	private absorbObjVersionArchival(
		client: SubscribingClient
	): Observable<events.objVersionArchived.Event|undefined> {
		return (new Observable<events.objVersionArchived.Event>(
			obs => client.subscribe(events.objVersionArchived.EVENT_NAME, obs)
		))
		.pipe(
			mergeMap(async ev => {
				const { objId, archivedVer } = ev;
				const obj = await this.files.findObj(objId);
				if (!obj) { return; }
				obj.statusObj().recordVersionArchival(archivedVer);
				this.broadcastNodeEvent(obj.objId, undefined, undefined, {
					type: 'remote-version-archival',
					path: '',
					archivedVersion: archivedVer,
					syncStatus: obj.syncStatus().syncStatus()
				});
				return ev;
			}, 1)
		);
	}

	private absorbArchVersionRemoval(
		client: SubscribingClient
	): Observable<events.objArchivedVersionRemoved.Event|undefined> {
		return (new Observable<events.objArchivedVersionRemoved.Event>(
			obs => client.subscribe(events.objArchivedVersionRemoved.EVENT_NAME, obs)
		))
		.pipe(
			mergeMap(async ev => {
				const { objId, archivedVer } = ev;
				const obj = await this.files.findObj(objId);
				if (!obj) { return; }
				obj.statusObj().recordArchVersionRemoval(archivedVer);
				this.broadcastNodeEvent(obj.objId, undefined, undefined, {
					type: 'remote-arch-ver-removal',
					path: '',
					removedArchVer: archivedVer,
					syncStatus: obj.syncStatus().syncStatus()
				});
				return ev;
			}, 1)
		);
	}

	stopNetworkActivity(): void {
		this.listening.stop();
	}

	resumeNetworkActivity(): void {
		if (this.listening.proc) {
			this.listening.startWith(
				this.listening.proc.completion.then(() => this.subscribeToEventSrcAndPassHeartbeats())
			);
		} else {
			this.listening.startWith(this.subscribeToEventSrcAndPassHeartbeats());
		}
	}

}
Object.freeze(RemoteEvents.prototype);
Object.freeze(RemoteEvents);


Object.freeze(exports);