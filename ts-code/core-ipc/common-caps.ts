/*
 Copyright (C) 2020 - 2021 3NSoft Inc.
 
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

import { ExposedObj, W3N_NAME, Caller, ExposedServices, ExposedFn } from "../ipc-via-protobuf/connector";
import { exposeLogger, makeLogCaller } from "../ipc-via-protobuf/log-cap";
import { exposeASMailCAP, makeASMailCaller } from "../ipc-via-protobuf/asmail-cap";
import { exposeStorageCAP, makeStorageCaller } from "../ipc-via-protobuf/storage-cap";
import { exposeMailerIdCAP, makeMailerIdCaller } from "../ipc-via-protobuf/mailerid";
import { assert } from "../lib-common/assert";

type W3N = web3n.caps.common.W3N;

export type CapExposer = (
	cap: any, coreSide: ExposedServices
) => ExposedObj<any>|ExposedFn;

export type MakeCapClient = (
	clientSide: Caller, objPath: string[]
) => any;

export function exposeW3N<T extends W3N>(
	coreSide: ExposedServices, w3n: T,
	extraCAPs?: { [cap in keyof T]: CapExposer; }
): void {
	const expW3N = {} as ExposedObj<T>;
	if (w3n.log) {
		expW3N.log = exposeLogger(w3n.log);
	}
	if (w3n.mailerid) {
		expW3N.mailerid = exposeMailerIdCAP(w3n.mailerid);
	}
	if (w3n.mail) {
		expW3N.mail = exposeASMailCAP(w3n.mail, coreSide);
	}
	if (w3n.storage) {
		expW3N.storage = exposeStorageCAP(w3n.storage, coreSide);
	}
	if (extraCAPs) {
		for (const [ capName, expose ] of Object.entries(extraCAPs)) {
			assert(typeof expose === 'function');
			const cap = w3n[capName];
			if (cap) {
				w3n[capName] = expose!(cap, coreSide);
			}
		}
	}
	coreSide.exposeW3NService(expW3N);
}

export function makeW3Nclient<T extends W3N>(
	clientSide: Caller, extraCAPs?: { [cap in keyof T]: MakeCapClient; }
): T {
	const objPath = [ W3N_NAME ];
	const lstOfCAPs = clientSide.listObj(objPath) as (keyof T)[];
	const w3n = {} as T;
	for (const cap of lstOfCAPs) {
		const capObjPath = objPath.concat(cap as string);
		if (cap === 'log') {
			w3n.log = makeLogCaller(clientSide, capObjPath);
		} else if (cap === 'mailerid') {
			w3n.mailerid = makeMailerIdCaller(clientSide, capObjPath);
		} else if (cap === 'mail') {
			w3n.mail = makeASMailCaller(clientSide, capObjPath);
		} else if (cap === 'storage') {
			w3n.storage = makeStorageCaller(clientSide, capObjPath);
		} else if (extraCAPs && extraCAPs[cap]) {
			const makeCap = extraCAPs[cap];
			assert(typeof makeCap === 'function');
			w3n[cap] = makeCap(clientSide, capObjPath);
		}
	}
	return w3n;
}


Object.freeze(exports);