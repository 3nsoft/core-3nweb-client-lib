/*
 Copyright (C) 2017, 2019, 2022 3NSoft Inc.
 
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
import { Observable, from, throwError } from 'rxjs';
import { SingleProc } from '../lib-common/processes/synced';
import { sleep } from '../lib-common/processes/sleep';
import { catchError, mergeMap, tap } from 'rxjs/operators';
import { WSException } from '../lib-common/ipc/ws-ipc';
import { ConnectException, HTTPException } from '../lib-common/exceptions/http';
import { stringifyErr } from '../lib-common/exceptions/error';
import { LogError } from './logging/log-to-file';

export class ServerEvents<N extends string, T> {

	private server: SubscribingClient|undefined = undefined;
	private openningServer = new SingleProc();
	
	constructor(
		private readonly subscribeToServer: () => Promise<SubscribingClient>,
		private restartWaitSecs: number,
		private readonly logError: LogError
	) {
		Object.seal(this);
	}

	/**
	 * This method creates an observable of server's events.
	 * @param event is an event on server, to which to subscribe.
	 */
	observe(event: N): Observable<T> {
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
					detach = undefined;
				} else {
					obs = undefined;
				}
			};
		})
		.pipe(
			// XXX tap to log more details
			tap({
				complete: () => this.logError({}, `ServerEvents.observe stream completes`),
				error: err => this.logError(err, `ServerEvents.observe stream has error,
${stringifyErr(err)}`)
			}),
			catchError(err => {
				if (this.shouldRestartAfterErr(err)) {
					console.error(stringifyErr(err));
					return this.restartObservation(event);
				} else {
					return throwError(() => err);
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
		if (exc.type === 'connect') {
			return true;
		} else if (exc.type === 'http-request') {
			return false;
		} else if (exc.type === 'websocket') {
			return true;
		} else {
			return false;
		}
	}

	private restartObservation(event: N): Observable<T> {
		return from(sleep(this.restartWaitSecs * 1000))
		.pipe(
			// XXX tap to log more details
			tap({
				next: () => this.logError({}, `ServerEvents.restartObservation of ${event} events`)
			}),
			mergeMap(() => this.observe(event))
		);
	}

}
Object.freeze(ServerEvents.prototype);
Object.freeze(ServerEvents);

Object.freeze(exports);