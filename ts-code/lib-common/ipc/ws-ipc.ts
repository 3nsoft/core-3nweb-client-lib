/*
 Copyright (C) 2017 3NSoft Inc.
 
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

import { RawDuplex, SubscribingClient, makeSubscribingClient, Envelope, 	MultiObserverWrap } from './generic-ipc';
import * as WebSocket from 'ws';

export { RequestEnvelope, RequestHandler, EventfulServer, makeEventfulServer, SubscribingClient } from './generic-ipc';

export interface WSException extends web3n.RuntimeException {
	type: 'websocket',
	socketSlow?: true,
	socketClosed?: true
}

const MAX_TXT_BUFFER = 64*1024;

/**
 * This creates a json communication point on a given web socket.
 * Point may have many listeners, allowing for single parsing of incoming
 * messages.
 * @param ws 
 */
function makeJsonCommPoint(ws: WebSocket): RawDuplex<Envelope> {
	
	const observers = new MultiObserverWrap<Envelope>();

	ws.on('message', onTxtMessage(ws, observers));
	ws.on('close', onClose(observers));
	ws.on('error', onError(ws, observers));
	ws.on('ping', () => ws.pong());

	const commPoint: RawDuplex<Envelope> = {
		subscribe: obs => observers.add(obs),
		postMessage(env: Envelope): void {
			if ((ws as any).bufferedAmount > MAX_TXT_BUFFER) {
				const exc: WSException = {
					runtimeException: true,
					type: 'websocket',
					socketSlow: true
				};
				throw exc;
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
	ws: WebSocket, observers: MultiObserverWrap<Envelope>
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
	};
}

/**
 * This generates an on-close callback for a web socket.
 * @param observers 
 */
function onClose(
	observers: MultiObserverWrap<any>
): (code: number, reason: string) => void {
	return (code, reason) => {
		if (code === 1000) {
			observers.complete();
		} else {
			const exc: WSException = {
				runtimeException: true,
				type: 'websocket',
				socketClosed: true,
				cause: { code, reason }
			};
			observers.error(exc);
		}
	};
}

/**
 * This generates an on-error callback for a web socket.
 * @param ws 
 * @param observers 
 */
function onError(
	ws: WebSocket, observers: MultiObserverWrap<any>
): ((err: any) => void) {
	return (err?: any): void => {
		const exc: WSException = {
			runtimeException: true,
			type: 'websocket',
			cause: err
		};
		observers.error(exc);
		ws.close();
	};
}

export function makeSubscriber(
	ws: WebSocket, ipcChannel: string|undefined
): SubscribingClient {
	const comm = makeJsonCommPoint(ws);
	return makeSubscribingClient(ipcChannel, comm);
}

Object.freeze(exports);