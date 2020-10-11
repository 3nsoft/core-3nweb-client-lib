/*
 Copyright (C) 2020 3NSoft Inc.
 
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

import { ExposedObj, W3N_NAME, Caller, ExposedServices } from "../ipc-via-protobuf/connector";
import { exposeLogger, makeLogCaller } from "../ipc-via-protobuf/log-cap";
import { exposeASMailCAP, makeASMailCaller } from "../ipc-via-protobuf/asmail-cap";
import { exposeStorageCAP, makeStorageCaller } from "../ipc-via-protobuf/storage-cap";

type W3N = web3n.caps.common.W3N;

export function exposeW3N(coreSide: ExposedServices, w3n: W3N): void {
	const expW3N: ExposedObj<W3N> = {};
	if (w3n.log) {
		expW3N.log = exposeLogger(w3n.log);
	}
	if (w3n.mail) {
		expW3N.mail = exposeASMailCAP(w3n.mail, coreSide);
	}
	if (w3n.storage) {
		expW3N.storage = exposeStorageCAP(w3n.storage, coreSide);
	}
	coreSide.exposeW3NService(expW3N);
}

export async function makeW3Nclient(clientSide: Caller): Promise<W3N> {
	const objPath = [ W3N_NAME ];
	const lstOfCAPs = await clientSide.listObj(objPath) as (keyof W3N)[];
	const w3n: W3N = {};
	for (const cap of lstOfCAPs) {
		if (cap === 'log') {
			w3n.log = makeLogCaller(clientSide, objPath.concat('log'));
		} else if (cap === 'mail') {
			w3n.mail = makeASMailCaller(clientSide, objPath.concat('mail'));
		} else if (cap === 'storage') {
			const storePath = objPath.concat('storage');
			const lstStorageCAP = await clientSide.listObj(
				storePath) as (keyof NonNullable<W3N['storage']>)[];
			const sysFS = lstStorageCAP.includes('getSysFS');
			const userFS = lstStorageCAP.includes('getUserFS');
			w3n.storage = makeStorageCaller(clientSide, storePath, sysFS, userFS);
		}
	}
	return w3n;
}


Object.freeze(exports);