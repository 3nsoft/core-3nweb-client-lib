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

import { LogError } from '../../lib-client/logging/log-to-file';
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
function makeJsonCommPoint(ws: WebSocket, log: LogError): RawDuplex<Envelope> {
	
	const observers = new MultiObserverWrap<Envelope>();

	const resetTimer = makeSignalsTimeObserver(ws.url, log);

	ws.on('message', onTxtMessage(ws, observers, resetTimer));
	ws.on('close', onClose(observers, resetTimer));
	ws.on('error', onError(ws, observers, resetTimer));
	ws.on('ping', onPing(ws, resetTimer));

	const commPoint: RawDuplex<Envelope> = {
		subscribe: obs => observers.add(obs),
		postMessage(env: Envelope): void {
			if ((ws as any).bufferedAmount > MAX_TXT_BUFFER) {
				throw makeWSException({ socketSlow: true });
			}
			ws.send(JSON.stringify(env));
		}
	};
	return commPoint;
}

/**
 * This generates an on-message callback for text messages in a web socket.
 * @param ws 
 * @param observers 
 */
function onTxtMessage(
	ws: WebSocket, observers: MultiObserverWrap<Envelope>, resetTimer: () => void
): (data: any) => void {
	return (data: any): void => {
		if (typeof data !== 'string') { return; }
		if (observers.done) { return; }
		
		let env: Envelope;
		try {
			env = JSON.parse(data);
		} catch (err) {
			ws.close();
			observers.error(err);
			return;
		}

		observers.next(env);
		resetTimer();
	};
}

/**
 * This generates an on-close callback for a web socket.
 * @param observers 
 */
function onClose(
	observers: MultiObserverWrap<any>, resetTimer: (done: true, err?: any) => void
): (code: number, reason: string) => void {
	return (code, reason) => {
		if (code === 1000) {
			resetTimer(true);
			observers.complete();
		} else {
			resetTimer(true, { code, reason });
			observers.error(makeWSException({
				socketClosed: true,
				cause: { code, reason }
			}));
		}
	};
}

/**
 * This generates an on-error callback for a web socket.
 * @param ws 
 * @param observers 
 */
function onError(
	ws: WebSocket, observers: MultiObserverWrap<any>, closeTimer: (done: true, err: any) => void
): ((err: any) => void) {
	return (err?: any): void => {
		closeTimer(true, err);
		observers.error(makeWSException({ cause: err }));
		ws.close();
	};
}

function onPing(ws: WebSocket, resetTimer: () => void): () => void {
	return () => {
		resetTimer();
		ws.pong();
	};
}

function makeSignalsTimeObserver(
	url: string, log: LogError
): (done?: true, err?: any) => void {
	const serverPingSettings = 2*60*1000;
	let lastMoment = Date.now();
	let int: ReturnType<typeof setInterval>|undefined = undefined;
	function resetWait(setNew = true) {
		lastMoment = Date.now();
		if (int) {
			clearInterval(int);
			int = undefined;
		}
		if (setNew) {
			int = setInterval(() => {
				log(`Ping/data from ${url} is not observed in last ${Math.floor((Date.now() - lastMoment)/1000)} seconds`);
			}, serverPingSettings*1.5).unref();
		}
	}

	return (done, err) => {
		if (done) {
			if (err) {
				log(err, `WebSocket to ${url} closed with error`);
			} else {
				log(null, `WebSocket to ${url} closed`);
			}
			resetWait(false);
		} else {
			resetWait();
		}
	};
}

export function makeSubscriber(
	ws: WebSocket, ipcChannel: string|undefined, log: LogError
): SubscribingClient {
	const comm = makeJsonCommPoint(ws, log);
	return makeSubscribingClient(ipcChannel, comm);
}

Object.freeze(exports);