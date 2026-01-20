/*
 Copyright (C) 2015 - 2018, 2020, 2025 - 2026 3NSoft Inc.
 
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

import { makeHTTPException, makeConnectionException, HTTPException, makeMalformedReplyHTTPException } from '../lib-common/exceptions/http';
import { BytesFIFOBuffer } from '../lib-common/byte-streaming/bytes-fifo-buffer';
import * as https from 'https';
import { IncomingMessage, IncomingHttpHeaders, ClientRequest } from 'http';
import { fromEvent, lastValueFrom, merge } from 'rxjs';
import { toBuffer, utf8 } from '../lib-common/buffer-utils';
import { defer } from '../lib-common/processes/deferred';
import { take, map, takeUntil, mergeMap } from 'rxjs/operators';

export const SESSION_ID_HEADER = "X-Session-Id";
export const CONTENT_TYPE_HEADER = 'Content-Type';

export interface JSONHttpRequest extends XMLHttpRequest {
	sendJSON(json: any): void;
}

export interface Reply<T> {
	url: string;
	method: string;
	status: number;
	data: T;
	headers?: Headers;
}

export interface RequestOpts {
	method: 'GET' | 'POST' | 'PUT' | 'DELETE';
	url?: string;
	appPath?: string;
	responseType?: 'json' | 'arraybuffer' | 'text';
	sessionId?: string;
	responseHeaders?: string[];
	timeout?: number;
	timeoutRetries?: number;
}

export interface Headers {
	get(name: string): string|undefined;
}

export type ContentType = 'application/json' |
	'application/octet-stream' | 'text/plain';

export type RequestFn<T> = (
	opts: RequestOpts, contentType?: ContentType, reqBody?: Uint8Array
) => Promise<Reply<T>>;

export async function processRequest<T>(
	requester: (opts: https.RequestOptions) => ClientRequest,
	httpsOpts: https.RequestOptions, opts: RequestOpts,
	reqBody: Uint8Array|undefined, attempt = 0
): Promise<Reply<T>> {
	try {
		const req = requester(httpsOpts);
		const resPromise = attachRequestReaders(req, opts);
		req.end(reqBody ? toBuffer(reqBody) : undefined);
		const { res, resBody } = await resPromise;
		const rep = formReply<T>(res, resBody, opts);
		return rep;
	} catch (err) {
		const { isTimeout, canRetry } = isTimeoutErr(err, opts, attempt);
		if (isTimeout && canRetry) {
			return processRequest<T>(
				requester, httpsOpts, opts, reqBody, attempt + 1);
		}
		throw err;
	}
}

export function formHttpsReqOpts(
	opts: RequestOpts, contentType?: ContentType, reqBody?: Uint8Array
): https.RequestOptions {
	if (!opts.url) {
		throw new Error(`Cannot send net request, cause url is not set in given options.`);
	}
	if (reqBody && (opts.method !== 'POST') && (opts.method !== 'PUT')) {
		throw new Error(`Cannot have body in ${opts.method} request.`);
	}
	const url = new URL(opts.url);
	const netReqOpts: https.RequestOptions = {
		protocol: url.protocol,
		method: opts.method,
		hostname: url.hostname,
		port: url.port,
		path: url.pathname + url.search,
		headers: {}
	};
	if (reqBody) {
		netReqOpts.headers!['Content-Length'] = reqBody.length;
	}
	if (contentType) {
		netReqOpts.headers![CONTENT_TYPE_HEADER] = contentType;
	}
	if (opts.sessionId) {
		netReqOpts.headers![SESSION_ID_HEADER] = opts.sessionId;
	}
	return netReqOpts;
}

async function attachRequestReaders(
	clReq: ClientRequest, opts: RequestOpts
): Promise<{ res: IncomingMessage, resBody: Uint8Array|undefined }> {
	// XXX do something for timeouts, that doesn't break good long connections
	// const timeout = (opts.timeout ? opts.timeout : DEFAULT_TIMEOUT);

	// note that we attach reading of body to response as close as possible to
	// its appearance, so as not to miss any incoming data, which may happen if
	// next tick occurs in between.
	const response$ = fromEvent(
		clReq, 'response',
		(res: IncomingMessage) => ({res, resBodyPromise: readAllBytesFrom(res)})
	)
	.pipe(take(1));

	const err$ = fromEvent(
		clReq, 'error',
		e => makeConnectionException(opts.url, opts.method, 'Cannot connect', e)
	)
	.pipe(
		map(exc => { throw exc; }),
		takeUntil(response$)
	);
	
	try {
		const reply = await lastValueFrom(
			merge(response$, err$)
			.pipe(
				mergeMap(async resAndBodyProm => {
					const { res, resBodyPromise } = resAndBodyProm;
					const resBody = await resBodyPromise;
					return { res, resBody };
				}, 1)
			)
		);
		return reply;
	} catch (exc) {
		if ((exc as HTTPException).cause === TIMEOUT_FLAG) {
			clReq.abort();
		}
		throw exc;
	}
}

const TIMEOUT_FLAG = 'Request Timeout';

function isTimeoutErr(
	err: HTTPException, opts: RequestOpts, currentAttempt: number
): { isTimeout: boolean; canRetry: boolean; } {
	if (err.cause !== TIMEOUT_FLAG) {
		return { isTimeout: false, canRetry :false };
	}
	const maxRetries = (opts.timeoutRetries ? opts.timeoutRetries : 0);
	const canRetry = ((maxRetries - currentAttempt) > 0);
	return { isTimeout: true, canRetry };
}

async function readAllBytesFrom(stream: NodeJS.ReadableStream): Promise<Uint8Array|undefined> {
	const buf = new BytesFIFOBuffer();
	const deferred = defer<Uint8Array|undefined>();
	stream.on('error', e => deferred.reject(e));
	stream.on('data', chunk => buf.push(chunk));
	stream.on('end', () => deferred.resolve(buf.getBytes(undefined)));
	const bytes = await deferred.promise;
	stream.removeAllListeners();
	return bytes;
}

const EMPTY_ARR = new Uint8Array(0);

function formReply<T>(res: IncomingMessage, resBody: Uint8Array|undefined, reqOpts: RequestOpts): Reply<T> {
	const status = res.statusCode!;
	const resContentType =
		res.headers[CONTENT_TYPE_HEADER.toLowerCase()] as ContentType;
	let data: T = undefined as any;
	if (reqOpts.responseType === 'arraybuffer') {
		data = (resBody ? resBody : EMPTY_ARR) as any;
	} else if (reqOpts.responseType === 'json') {
		try {
			data = (resBody ? JSON.parse(utf8.open(resBody)) : undefined);
		} catch (err) {
			if (resContentType === 'application/json') {
				throw makeHTTPException(reqOpts.url!, reqOpts.method, status, {
					message: `Cannot parse received bytes as json`,
					cause: err,
					malformedResponse: true
				});
			}
		}
	}
	const rep: Reply<T> = {
		url: reqOpts.url!,
		method: reqOpts.method,
		status,
		data,
		headers: (reqOpts.responseHeaders ?
			makeHeaders(filterHeaders(res.headers, reqOpts.responseHeaders)) : undefined
		)
	};
	return rep;
}

function filterHeaders(resHeaders: IncomingHttpHeaders, responseHeaders: string[]): { [h:string]: string; } {
	const filteredHeaders: { [h:string]: string; } = {};
	for (const h of responseHeaders) {
		const hVal = resHeaders[h.toLocaleLowerCase()];
		if (!hVal) { continue; }
		filteredHeaders[h.toLowerCase()] = (Array.isArray(hVal) ?
			hVal.join('\n') : hVal);
	}
	return filteredHeaders;
}

function makeHeaders(headers: { [h:string]: string; }): Headers {
	return {
		get(name: string): string|undefined {
			return headers[name.toLowerCase()];
		}
	};
}

export function extractIntHeader(rep: Reply<any>, headerName: string): number {
	const intHeader = parseInt(rep.headers!.get(headerName)!);
	if (isNaN(intHeader)) {
		throw makeMalformedReplyHTTPException(rep, {
			message: `Malformed response: header ${headerName} is missing or malformed`
		}); }
	return intHeader;
}

export interface NetClient {

	/**
	 * This makes a 'Content-Type: application/json' request with given json,
	 * returning a promise, resolvable to reply object.
	 * @param opts
	 * @param json
	 */
	doJsonRequest<T>(opts: RequestOpts, json: any): Promise<Reply<T>>;

	/**
	 * This makes a 'Content-Type: application/octet-stream' request with given
	 * bytes, returning a promise, resolvable to reply object.
	 * @param opts
	 * @param bytes
	 */
	doBinaryRequest<T>(opts: RequestOpts, bytes: Uint8Array|Uint8Array[]): Promise<Reply<T>>;

	/**
	 * This makes a request without body, returning a promise, resolvable to
	 * reply object.
	 * @param opts
	 */
	doBodylessRequest<T>(opts: RequestOpts): Promise<Reply<T>>;

	reset(): void;

}

function makeNodeRequest<T>(): RequestFn<T> {
	const nodeRequest = (opts: https.RequestOptions) => https.request(opts);
	return (opts, contentType, reqBody) => {
		const httpsOpts = formHttpsReqOpts(opts, contentType, reqBody);
		return processRequest<T>(nodeRequest, httpsOpts, opts, reqBody);
	}
}

export function makeNetClient(
	request = makeNodeRequest(),
	reset = () => {}
): NetClient {

	const client: NetClient = {
	
		doBinaryRequest<T>(opts: RequestOpts, bytes: Uint8Array|Uint8Array[]): Promise<Reply<T>> {
			let reqBody: Uint8Array|undefined;
			if (Array.isArray(bytes)) {
				const fifo = new BytesFIFOBuffer();
				for (const arr of bytes) {
					fifo.push(arr);
				}
				reqBody = fifo.getBytes(undefined);
			} else {
				reqBody = bytes;
			}
			return (request as RequestFn<T>)(opts, 'application/octet-stream', reqBody);
		},

		doBodylessRequest<T>(opts: RequestOpts): Promise<Reply<T>> {
			return (request as RequestFn<T>)(opts);
		},

		doJsonRequest<T>(opts: RequestOpts, json: any): Promise<Reply<T>> {
			const reqBody = ((json === undefined) ? new Uint8Array(0) : utf8.pack(JSON.stringify(json)));
			return (request as RequestFn<T>)(opts, 'application/json', reqBody);
		},

		reset

	};

	return Object.freeze(client);
}

Object.freeze(exports);