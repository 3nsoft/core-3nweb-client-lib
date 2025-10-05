/*
 Copyright (C) 2017, 2019, 2022, 2025 3NSoft Inc.
 
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

import { SubscribingClient } from '../lib-common/ipc/generic-ipc';
import { Observable } from 'rxjs';
import { SingleProc } from '../lib-common/processes/synced';

export class ServerEvents<N extends string, T> {

	private server: SubscribingClient|undefined = undefined;
	private openningServer = new SingleProc();
	
	constructor(
		private readonly subscribeToServer: () => Promise<SubscribingClient>,
	) {
		Object.seal(this);
	}

	/**
	 * This method creates an observable of server's events.
	 * @param event is an event on server, to which to subscribe.
	 */
	observe(event: N): Observable<T> {
		return new Observable<T>(observer => {
			// simple sync creation of detach function
			if (this.server) {
				return this.server.subscribe(event, observer);
			}

			// detach function that works around of async creation of event source
			let detach: (() => void)|undefined;
			let obs: (typeof observer)|undefined = observer;

			// open server, ensuring only one process running
			if (!this.openningServer.isProcessing()) {
				this.openningServer.addStarted(this.subscribeToServer());
			}
			this.openningServer.latestTaskAtThisMoment<SubscribingClient>()!
			.then((server) => {
				this.setServer(server);
				if (!obs) { return; }
				detach = this.server!.subscribe(event, obs);
				obs = undefined;
			})
			.catch(err => {
				obs?.error(err);
				obs = undefined;
			});

			return () => {
				if (detach) {
					detach();
					detach = undefined;
				} else {
					obs = undefined;
				}
			};
		});
	}

	private setServer(server: SubscribingClient): void {
		this.server = server;
		this.server.on('end', () => {
			if (this.server === server) {
				this.server = undefined;
			}
		});
	}

}
Object.freeze(ServerEvents.prototype);
Object.freeze(ServerEvents);

Object.freeze(exports);