/*
 Copyright (C) 2020 - 2021, 2023 3NSoft Inc.
 
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

import { W3N_NAME, Caller, CoreSideServices } from "../ipc-via-protobuf/connector";
import { exposeLogger, makeLogCaller } from "./log-cap";
import { exposeASMailCAP, makeASMailCaller } from "../core/asmail/asmail-cap-ipc";
import { exposeStorageCAP, makeStorageCaller, promiseStorageCaller } from "../core/storage/storage-cap-ipc";
import { exposeMailerIdCAP, makeMailerIdCaller } from "../core/id-manager/mailerid-cap-ipc";
import { exposeCAPs, makeClientSide, ClientCAPsWraps, CAPsExposures, TypeDifference, promiseClientSide } from "./generic";

type W3N = web3n.caps.common.W3N;

export function exposeW3N<T extends W3N>(
	coreSide: CoreSideServices, w3n: T,
	extraCAPs?: CAPsExposures<TypeDifference<T, W3N>>
): void {
	const commonCAPsExposures: CAPsExposures<W3N> = {
		log: exposeLogger,
		mail: exposeASMailCAP,
		mailerid: exposeMailerIdCAP,
		storage: exposeStorageCAP,
	};
	exposeCAPs(coreSide, w3n, commonCAPsExposures, extraCAPs);
}

// This is not used, but it ensures that some require runs, providing function
// for protobuf-something.
const unused = W3N_NAME;

export function makeW3Nclient<T extends W3N>(
	clientSide: Caller, extraCAPs?: ClientCAPsWraps<TypeDifference<T, W3N>>
): T {
	const mainCAPs: ClientCAPsWraps<W3N> = {
		log: makeLogCaller,
		mail: makeASMailCaller,
		mailerid: makeMailerIdCaller,
		storage: makeStorageCaller,
	};
	const clientW3N = makeClientSide(clientSide, mainCAPs, extraCAPs);
	addLogToConsoleToLogCap(clientW3N);
	return clientW3N;
}

export async function promiseW3Nclient<T extends W3N>(
	clientSide: Caller, extraCAPs?: ClientCAPsWraps<TypeDifference<T, W3N>>
): Promise<T> {
	const mainCAPs: ClientCAPsWraps<W3N> = {
		log: makeLogCaller,
		mail: makeASMailCaller,
		mailerid: makeMailerIdCaller,
		storage: promiseStorageCaller,
	};
	const clientW3N = await promiseClientSide(clientSide, mainCAPs, extraCAPs);
	addLogToConsoleToLogCap(clientW3N);
	return clientW3N;
}

function addLogToConsoleToLogCap(clientW3N: W3N): void {
	const logCap = clientW3N.log as  W3N['log']|undefined;
	clientW3N.log = async (type, msg, err) => {
		if (type === 'error') {
			if (err === undefined) {
				console.error(msg);
			} else {
				console.error(msg, err);
			}
		} else if (type === 'warning') {
			if (err === undefined) {
				console.warn(msg);
			} else {
				console.warn(msg, err);
			}
		} else {
			if (err === undefined) {
				console.log(msg);
			} else {
				console.log(msg, err);
			}
		}
		await logCap?.(type, msg, err);
	};
}


Object.freeze(exports);