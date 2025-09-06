/*
 Copyright (C) 2022 - 2025 3NSoft Inc.
 
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

import { Subject, map } from "rxjs";
import { EnvelopeBody, ExposedFn } from "../../ipc-via-protobuf/connector";
import { deserializeArgs, FindObjectRef, FindReferencedObj, serializeArgs } from "./json-n-binary";

type Observer<T> = web3n.Observer<T>;

export type HandleObservingCall<TEvent> = (
	obs: Observer<TEvent>, ...requestArgs: any[]
) => (() => void);

export type HandleReqReplyCall = (...requestArgs: any[]) => Promise<any>;

export interface TransformOpts {
	unpackRequest?: ((req: EnvelopeBody) => any[]) | 'noop';
	packReply?: ((reply: any) => EnvelopeBody) | 'noop';
	findRefOf?: FindObjectRef;
	findReferencedObj?: FindReferencedObj;
}

export function wrapReqReplySrvMethod<T extends object, M extends keyof T>(
	srv: T, method: M, transforms?: TransformOpts
): ExposedFn {
	return wrapReqReplyFunc(srv, srv[method] as HandleReqReplyCall, transforms);
}

export function wrapReqReplyFunc(
	srv: object, func: HandleReqReplyCall, transforms?: TransformOpts
): ExposedFn;
export function wrapReqReplyFunc(
	func: HandleReqReplyCall, transforms?: TransformOpts
): ExposedFn;
export function wrapReqReplyFunc(
	srvOrFn: object|HandleReqReplyCall,
	funcOrTransforms: HandleReqReplyCall|TransformOpts|undefined,
	transforms?: TransformOpts
): ExposedFn {
	let srv: object|undefined;
	let func: HandleReqReplyCall;
	if (typeof srvOrFn === 'function') {
		srv = undefined;
		func = srvOrFn as HandleReqReplyCall;
		transforms = funcOrTransforms as TransformOpts|undefined;
	} else {
		srv = srvOrFn as object;
		func = funcOrTransforms as HandleReqReplyCall;
	}
	return buf => {
		const args = argsFromPassedDatum(buf, transforms);
		let promise = (args ?
			func.call(srv, ...args) :
			func.call(srv)
		);
		if (promise === undefined) {
			promise = Promise.resolve();
		} else if ((promise === null) || !promise.then) {
			promise = Promise.resolve(resultToBuffer(promise, transforms));
		} else {
			promise = promise.then(result => resultToBuffer(result, transforms));
		}
		return { promise }
	};
}

function argsFromPassedDatum(
	bytes: EnvelopeBody, transforms: TransformOpts|undefined
): (any[])|undefined {
	if (!bytes) { return; }
	if (transforms?.unpackRequest) {
		if (transforms.unpackRequest === 'noop') {
			return [ bytes ];
		} else {
			return transforms.unpackRequest(bytes);
		}
	} else {
		return (bytes ? deserializeArgs(bytes, transforms?.findReferencedObj) : undefined);
	}
}

function resultToBuffer(
	data: any, transforms: TransformOpts|undefined
): EnvelopeBody {
	if (data === undefined) { return; }
	if (transforms?.packReply) {
		if (transforms.packReply === 'noop') {
			if (!ArrayBuffer.isView(data)) { throw new Error(
				`Method returned non-binary, while no serialization is set`
			); }
			return data as Buffer;
		}
		return transforms.packReply(data);
	} else {
		return serializeArgs([ data ], transforms?.findRefOf);
	}
}

export function wrapObservingFunc<TEvent>(
	func: HandleObservingCall<TEvent>,
	transforms?: TransformOpts
): ExposedFn;
export function wrapObservingFunc<TEvent>(
	srv: object,
	func: HandleObservingCall<TEvent>,
	transforms?: TransformOpts
): ExposedFn;
export function wrapObservingFunc<TEvent>(
	srvOrFn: object|HandleObservingCall<TEvent>,
	funcOrTransforms: HandleObservingCall<TEvent>|TransformOpts|undefined,
	transforms?: TransformOpts
): ExposedFn {
	let srv: object|undefined;
	let func: HandleObservingCall<TEvent>;
	if (typeof srvOrFn === 'function') {
		srv = undefined;
		func = srvOrFn as HandleObservingCall<TEvent>;
		transforms = funcOrTransforms as TransformOpts|undefined;
	} else {
		srv = srvOrFn as object;
		func = funcOrTransforms as HandleObservingCall<TEvent>;
	}
	return buf => {
		const args = argsFromPassedDatum(buf, transforms);
		const s = new Subject<TEvent>();
		const obs = s.asObservable().pipe(
			map(ev => resultToBuffer(ev, transforms))
		);
		const onCancel = (args ?
			func.call(srv, s, ...args) :
			func.call(srv, s)
		);
		return { obs, onCancel };
	};
}

