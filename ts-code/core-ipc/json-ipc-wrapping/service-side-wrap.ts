/*
 Copyright (C) 2022 - 2024 3NSoft Inc.
 
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
import { deserializeArgs, serializeArgs } from "./json-n-binary";

type Observer<T> = web3n.Observer<T>;

interface PassedDatum {
	bytes?: Uint8Array;
	passedByReference?: any[];
}

export type HandleObservingCall<TEvent> = (
	obs: Observer<TEvent>, ...requestArgs: any[]
) => (() => void);

export type HandleReqReplyCall = (...requestArgs: any[]) => Promise<any>;

export interface TransformOpts {
	unpackRequest?: ((req: PassedDatum|undefined) => any[]) | 'noop';
	packReply?: ((reply: any) => PassedDatum|undefined) | 'noop';
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
		const args = argsFromBuffer(buf, transforms);
		let promise = (args ?
			func.call(srv, ...args) :
			func.call(srv)
		);
		promise = promise?.then(result => resultToBuffer(result, transforms));
		return { promise }
	};
}

function argsFromBuffer(
	buf: EnvelopeBody, transforms: TransformOpts|undefined
): any[]|undefined {
	return argsFromPassedDatum(
		{ bytes: buf as PassedDatum['bytes'] },
		transforms?.unpackRequest
	);
}

function resultToBuffer<T>(
	data: T, transforms: TransformOpts|undefined
): EnvelopeBody {
	const sequencePack = toPassedDatum(data, transforms?.packReply);
	return sequencePack?.bytes as EnvelopeBody;
}

function argsFromPassedDatum(
	data: PassedDatum|undefined, unpack: TransformOpts['unpackRequest']
): (any[])|undefined {
	if (!data) { return; }
	if (unpack) {
		if (unpack === 'noop') {
			return [ data.bytes ];
		} else {
			return unpack(data);
		}
	} else {
		const { bytes, passedByReference } = data;
		return (bytes ? deserializeArgs(bytes, passedByReference) : undefined);
	}
}

function toPassedDatum(
	data: any, pack: TransformOpts['packReply']
): PassedDatum|undefined {
	if (data === undefined) { return; }
	if (pack) {
		if (pack === 'noop') {
			if (!ArrayBuffer.isView(data)) { throw new Error(
				`Method returned non-binary, while no serialization is set`
			); }
			return { bytes: data as Uint8Array };
		}
		return pack(data);
	} else {
		return serializeArgs([ data ]);
	}
}

export function wrapObservingFunc<TEvent>(
	srv: object|undefined, func: HandleObservingCall<TEvent>,
	transforms?: TransformOpts
): ExposedFn {
	return buf => {
		const args = argsFromBuffer(buf, transforms);
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

