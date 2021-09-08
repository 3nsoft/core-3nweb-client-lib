/*
 Copyright (C) 2017, 2019 3NSoft Inc.
 
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

import { SubscribingClient } from '../lib-common/ipc/generic-ipc';
import { Observable, from, throwError } from 'rxjs';
import { SingleProc, sleep } from '../lib-common/processes';
import { catchError, mergeMap } from 'rxjs/operators';
import { WSException } from '../lib-common/ipc/ws-ipc';
import { ConnectException, HTTPException } from '../lib-common/exceptions/http';
import { stringifyErr } from '../lib-common/exceptions/error';

export class ServerEvents {

	private server: SubscribingClient|undefined = undefined;
	private openningServer = new SingleProc();
	
	constructor(
		private subscribeToServer: () => Promise<SubscribingClient>,
		private restartWaitSecs: number
	) {
		Object.seal(this);
	}

	/**
	 * This method creates an observable of server's events.
	 * @param serverEvent is an event on server, to which to subscribe.
	 */
	observe<T>(event: string): Observable<T> {
		const event$ = new Observable<T>(observer => {
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
				if (obs) {
					obs.error(err);
				}
				obs = undefined;
			});

			return () => {
				if (detach) {
					detach();
				} else {
					obs = undefined;
				}
			};
		})
		.pipe(
			catchError(err => {
				if (this.shouldRestartAfterErr(err)) {
					console.error(stringifyErr(err));
					return this.restartObservation<T>(event);
				} else {
					return throwError(err);
				}
			})
		);
		return event$;
	}

	private setServer(server: SubscribingClient): void {
		this.server = server;
		this.server.on('end', () => {
			if (this.server === server) {
				this.server = undefined;
			}
		});
	}

	private shouldRestartAfterErr(
		exc: WSException|ConnectException|HTTPException
	): boolean {
		if (!exc.runtimeException) { return false; }
		if (exc.type === 'http-connect') {
			return true;
		} else if (exc.type === 'http-request') {
			return false;
		} else if (exc.type === 'websocket') {
			return true;
		} else {
			return false;
		}
	}

	private restartObservation<T>(event: string): Observable<T> {
		return from(sleep(this.restartWaitSecs))
		.pipe(
			mergeMap(() => this.observe<T>(event))
		);
	}

}
Object.freeze(ServerEvents.prototype);
Object.freeze(ServerEvents);

Object.freeze(exports);