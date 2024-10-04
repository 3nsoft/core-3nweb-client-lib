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

import { Subject } from "rxjs";
import { Caller, EnvelopeBody } from "../../ipc-via-protobuf/connector";
import { deserializeArgs, serializeArgs } from "./json-n-binary";

type Observer<T> = web3n.Observer<T>;

interface PassedDatum {
	bytes?: Uint8Array;
	passedByReference?: any[];
}

export interface TransformOpts {
    unpackReply?: ((reply: PassedDatum | undefined) => any) | 'noop';
    packRequest?: ((args: any[]) => PassedDatum | undefined) | 'noop';
}

function replyFromPassedDatum(
	data: PassedDatum|undefined, unpack: TransformOpts['unpackReply']
): any {
	if (!data) { return; }
	if (unpack) {
		if (unpack === 'noop') {
			return [data.bytes];
		}
		else {
			return unpack(data);
		}
	}
	else {
		const { bytes, passedByReference } = data;
		return (bytes ? deserializeArgs(bytes, passedByReference)[0] : undefined);
	}
}

function argsToPassedDatum(
	args: any[], pack: TransformOpts['packRequest']
): PassedDatum|undefined {
	if (args === undefined) { return; }
	if (pack) {
		if (pack === 'noop') {
			if (!ArrayBuffer.isView(args[0])) {
				throw new Error(`Method returned non-binary, while no serialization is set`);
			}
			return { bytes: args[0] as Uint8Array };
		}
		return pack(args);
	}
	else {
		return serializeArgs(args);
	}
}

export function makeReqRepFuncCaller<F extends Function>(
	clientSide: Caller, path: string[], transforms?: TransformOpts
): F {
	return (async (...args: any[]) => {
		const req = argsToPassedDatum(args, transforms?.packRequest);
		if (req?.passedByReference) {
			throw new Error(`Passing by reference is notimplemented, yet.`);
		}
		const reply = await clientSide.startPromiseCall(
			path, req?.bytes as EnvelopeBody
		);
		return replyFromPassedDatum({
			bytes: reply as PassedDatum['bytes']
		}, transforms?.unpackReply);
	}) as any as F;
}

export function makeReqRepObjCaller<T, M extends keyof T>(
	clientSide: Caller, objPath: string[], method: M,
	transforms?: TransformOpts
): T[M] {
	return makeReqRepFuncCaller(
		clientSide, objPath.concat(method as string), transforms
	) as any as T[M];
}

export function makeObservableFuncCaller<TEvent>(
	clientSide: Caller, path: string[], transforms?: TransformOpts
): (obs: Observer<TEvent>, ...args: any[]) => (() => void) {
	return (obs, ...args) => {
		const req = argsToPassedDatum(args, transforms?.packRequest);
		const s = new Subject<EnvelopeBody>();
		const unsub = clientSide.startObservableCall(
			path, req?.bytes as EnvelopeBody, s
		);
		s.subscribe({
			next: data => {
					if (!obs.next) {
						return;
					}
					const ev = replyFromPassedDatum(
						{ bytes: data as PassedDatum['bytes'] },
						transforms?.unpackReply
					);
					obs.next(ev);
			},
			complete: () => obs.complete?.(),
			error: err => obs.error?.(err)
		});
		return unsub;
	};
}
