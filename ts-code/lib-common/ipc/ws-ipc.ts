/*
 Copyright (C) 2017, 2025 3NSoft Inc.
 
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

import { Observable, share, Subject } from 'rxjs';
import { makeRuntimeException } from '../exceptions/runtime';
import { RawDuplex, SubscribingClient, makeSubscribingClient, Envelope, 	MultiObserverWrap } from './generic-ipc';
import * as WebSocket from 'ws';

export { RequestEnvelope, RequestHandler, EventfulServer, makeEventfulServer, SubscribingClient } from './generic-ipc';

export interface WSException extends web3n.RuntimeException {
	type: 'websocket',
	socketSlow?: true,
	socketClosed?: true
}

export function makeWSException(params: Partial<WSException>, flags?: Partial<WSException>): WSException {
	return makeRuntimeException('websocket', params, flags ?? {});
}

const MAX_TXT_BUFFER = 64*1024;

/**
 * This creates a json communication point on a given web socket.
 * Point may have many listeners, allowing for single parsing of incoming
 * messages.
 * @param ws 
 */
function makeJsonCommPoint(ws: WebSocket): {
	comm: RawDuplex<Envelope>; heartbeat: Observable<ConnectionStatus>;
 } {
	
	const observers = new MultiObserverWrap<Envelope>();

	const { heartbeat, healthyBeat, otherBeat } = makeHeartbeat(ws.url);

	ws.on('message', data => {
		if (observers.done) { return; }

		let env: Envelope;
		try {
			env = JSON.parse((data as Buffer).toString('utf8'));
		} catch (err) {
			ws.close();
			otherBeat(err, true);
			observers.error(err);
			return;
		}

		observers.next(env);
		healthyBeat();
	});

	ws.on('close', (code, reason) => {
		if (code === 1000) {
			otherBeat({ socketClosed: true }, true);
			observers.complete();
		} else {
			otherBeat({ error: { code, reason } }, true);
			observers.error(makeWSException({
				socketClosed: true,
				cause: { code, reason }
			}));
		}
	});

	ws.on('error', (err?: any): void => {
		otherBeat(err, true);
		observers.error(makeWSException({ cause: err }));
		ws.close();
	});

	ws.on('ping', () => {
		ws.pong();
		healthyBeat();
	});

	const comm: RawDuplex<Envelope> = {
		subscribe: obs => observers.add(obs),
		postMessage(env: Envelope): void {
			if ((ws as any).bufferedAmount > MAX_TXT_BUFFER) {
				otherBeat({ slowSocket: true });
				throw makeWSException({ socketSlow: true });
			}
			ws.send(JSON.stringify(env));
		}
	};

	return { comm, heartbeat };
}

function makeHeartbeat(url: string) {

	const status = new Subject<ConnectionStatus>();

	let lastInfo = Date.now();

	function healthyBeat(): void {
		const now = Date.now();
		status.next({
			url,
			ping: now - lastInfo
		});
		lastInfo = now;
	}

	function otherBeat(params: Partial<ConnectionStatus>, end = false): void {
		status.next({
			url,
			...params				
		});
		if (end) {
			status.complete();
		}
	}

	return {
		heartbeat: status.asObservable().pipe(share()),
		healthyBeat,
		otherBeat
	};
}

export interface ConnectionStatus {

	url: string;

	/**
	 * ping number is a number of millisecond between previous and current data receiving from server.
	 */
	ping?: number;

	/**
	 * This mirrors a "slow socket" exception, thrown to data sending process.
	 */
	slowSocket?: true;

	socketClosed?: true;

	error?: any;
}

export function makeSubscriber(
	ws: WebSocket, ipcChannel: string|undefined
): { client: SubscribingClient; heartbeat: Observable<ConnectionStatus>; } {
	const { comm, heartbeat } = makeJsonCommPoint(ws);
	return {
		client: makeSubscribingClient(ipcChannel, comm),
		heartbeat
	};
}

export function addToStatus<T extends ConnectionStatus>(status: ConnectionStatus, params: Partial<T>): T {
	for (const [ field, value ] of Object.entries(params)) {
		(status as T)[field] = value;
	}
	return status as T;
}

Object.freeze(exports);