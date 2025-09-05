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

import { Subject } from "rxjs";
import { Caller, EnvelopeBody } from "../../ipc-via-protobuf/connector";
import { deserializeArgs, FindObjectRef, FindReferencedObj, serializeArgs } from "./json-n-binary";

type Observer<T> = web3n.Observer<T>;

export interface TransformOpts {
    unpackReply?: ((reply: EnvelopeBody) => any) | 'noop';
    packRequest?: ((args: any[]) => EnvelopeBody) | 'noop';
	 findRefOf?: FindObjectRef;
	 findReferencedObj?: FindReferencedObj;
}

function replyFromPassedDatum(
	bytes: EnvelopeBody, transforms?: TransformOpts
): any {
	if (!bytes) { return; }
	if (transforms?.unpackReply) {
		if (transforms.unpackReply === 'noop') {
			return [bytes];
		}
		else {
			return transforms.unpackReply(bytes);
		}
	}
	else {
		return (bytes ? deserializeArgs(bytes, transforms?.findReferencedObj)[0] : undefined);
	}
}

function argsToPassedDatum(
	args: any[], transforms?: TransformOpts
): EnvelopeBody {
	if (args === undefined) { return; }
	if (transforms?.packRequest) {
		if (transforms.packRequest === 'noop') {
			if (!ArrayBuffer.isView(args[0])) {
				throw new Error(`Method returned non-binary, while no serialization is set`);
			}
			return args[0] as Buffer;
		}
		return transforms.packRequest(args);
	} else {
		return serializeArgs(args, transforms?.findRefOf);
	}
}

export function makeReqRepFuncCaller<F extends Function>(
	clientSide: Caller, path: string[], transforms?: TransformOpts
): F {
	return (async (...args: any[]) => {
		const bytes = argsToPassedDatum(args, transforms);
		const reply = await clientSide.startPromiseCall(path, bytes);
		return replyFromPassedDatum(reply, transforms);
	}) as any as F;
}

export function makeReqRepObjCaller<T, M extends keyof T>(
	clientSide: Caller, objPath: string[], method: M, transforms?: TransformOpts
): T[M] {
	return makeReqRepFuncCaller(
		clientSide, objPath.concat(method as string), transforms
	) as any as T[M];
}

export function makeObservableFuncCaller<TEvent>(
	clientSide: Caller, path: string[], transforms?: TransformOpts
): (obs: Observer<TEvent>, ...args: any[]) => (() => void) {
	return (obs, ...args) => {
		const bytes = argsToPassedDatum(args, transforms);
		const s = new Subject<EnvelopeBody>();
		const unsub = clientSide.startObservableCall(path, bytes, s);
		s.subscribe({
			next: data => {
					if (!obs.next) {
						return;
					}
					const ev = replyFromPassedDatum(data, transforms);
					obs.next(ev);
			},
			complete: () => obs.complete?.(),
			error: err => obs.error?.(err)
		});
		return unsub;
	};
}
