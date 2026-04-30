/*
 Copyright (C) 2017, 2019, 2025 3NSoft Inc.
 
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

import * as WebSocket from 'ws';
import type { IncomingMessage, OutgoingHttpHeaders } from 'http';
import { SESSION_ID_HEADER, Reply, ConnectionStatus, RequestOpts } from '../lib-client/request-utils';
import { defer, Deferred } from '../lib-common/processes/deferred';
import { makeConnectionException } from '../lib-common/exceptions/http';
import { globalAgent as agent } from 'https';
import { MultiObserverWrap, type Envelope, type RawDuplex } from '../lib-common/ipc/generic-ipc';
import { makeWSException } from '../lib-common/ipc/ws-ipc';
import { Observable, share, Subject } from 'rxjs';

type Observer<T> = web3n.Observer<T>;

export async function openServiceEventsSrcFromNode(req: RequestOpts): Promise<{
	status: number;
	data: {
		comm: RawDuplex<Envelope>;
		watch: (obs: Observer<ConnectionStatus>) => (() => void);
	};
}> {
	const { url, sessionId } = req;
	const rep = await openSocketFromNode(url!, sessionId!);
	if (rep.status !== 200) {
		return rep as any;
	}
	const { comm, heartbeat } = makeJsonCommPoint(rep.data);
	return {
		status: rep.status,
		data: {
			comm,
			watch: obs => {
				const sub = heartbeat.subscribe(obs);
				return () => sub.unsubscribe();
			}
		}
	};
}

const MAX_TXT_BUFFER = 64*1024;
const CLIENT_SIDE_PING_PERIOD = 10*1000;

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

	let outstandingPongs = 0;
	let closedByPingProc = false;
	const pingRepeat = setInterval(() => {
		if (outstandingPongs >= 2) {
			ws.close();
			closedByPingProc = true;
			clearInterval(pingRepeat);
			return;
		}
		if (outstandingPongs > 0) {
			otherBeat('heartbeat-skip', { missingPongsFromServer: outstandingPongs });
		}
		ws.ping();
		outstandingPongs += 1;
	}, CLIENT_SIDE_PING_PERIOD);

	ws.on('message', data => {
		if (observers.done) { return; }

		let env: Envelope;
		try {
			env = JSON.parse((data as Buffer).toString('utf8'));
		} catch (err) {
			ws.close();
			clearInterval(pingRepeat);
			otherBeat('disconnected', err, true);
			observers.error(err);
			return;
		}

		observers.next(env);
		healthyBeat();
	});

	ws.on('close', (code, reason) => {
		clearInterval(pingRepeat);
		if (code === 1000) {
			otherBeat('disconnected', { socketClosed: true }, true);
			observers.complete();
		} else {
			otherBeat('disconnected', { error: { code, reason } }, true);
			observers.error(makeWSException({
				socketClosed: true,
				cause: { code, reason }
			}));
		}
	});

	ws.on('error', (err?: any): void => {
		otherBeat('disconnected', err, true);
		observers.error(makeWSException({ cause: err }));
		clearInterval(pingRepeat);
		ws.close();
	});

	ws.on('ping', () => {
		ws.pong();
		healthyBeat();
	});

	ws.on('pong', () => {
		healthyBeat();
		outstandingPongs = 0;
	});

	const comm: RawDuplex<Envelope> = {
		subscribe: obs => observers.add(obs),
		postMessage(env: Envelope): void {
			if ((ws as any).bufferedAmount > MAX_TXT_BUFFER) {
				otherBeat('heartbeat', { slowSocket: true });
				throw makeWSException({ socketSlow: true });
			}
			ws.send(JSON.stringify(env));
		}
	};

	otherBeat('connected', {});

	return { comm, heartbeat };
}

function makeHeartbeat(url: string) {

	const status = new Subject<ConnectionStatus>();

	let lastInfo = Date.now();

	function healthyBeat(): void {
		const now = Date.now();
		status.next({
			type: 'heartbeat',
			url,
			ping: now - lastInfo
		});
		lastInfo = now;
	}

	function otherBeat(type: ConnectionStatus['type'], params: Partial<ConnectionStatus>, end = false): void {
		status.next({
			type,
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

function openSocketFromNode(url: string, sessionId: string): Promise<Reply<WebSocket>> {
	if (!url.startsWith('wss://')) {
		throw new Error(`Url protocol must be wss`);
	}
	const headers: OutgoingHttpHeaders = {};
	headers[SESSION_ID_HEADER] = sessionId;
	const ws = new WebSocket(url, { headers, agent });
	let opening: Deferred<Reply<WebSocket>>|undefined = defer<Reply<WebSocket>>();
	const initOnError = (err: any) => {
		opening?.reject(makeConnectionException(url, undefined, `WebSocket connection error: ${err.message}`));
		opening = undefined;
	};
	const onNonOkReply = (req, res: IncomingMessage) => {
		const errReply: Reply<WebSocket> = {
			url,
			method: 'GET',
			status: res.statusCode!,
			data: (undefined as any)
		};
		opening?.resolve(errReply);
		opening = undefined;
	};
	ws.on('error', initOnError);
	ws.on('unexpected-response', onNonOkReply);
	ws.once('open', () => {
		opening?.resolve({
			url,
			method: 'GET',
			status: 200,
			data: ws
		});
		opening = undefined;
		ws.removeListener('error', initOnError);
		ws.removeListener('unexpected-response', onNonOkReply);
	});
	return opening.promise;
}

Object.freeze(exports);