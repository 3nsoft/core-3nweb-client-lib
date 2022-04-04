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

import { Subject } from "rxjs";
import { map, delay } from "rxjs/operators";
import { exposeStartupW3N, makeStartupW3Nclient, exposeW3N, makeW3Nclient, Envelope, msgProtoType, ObjectsConnector, Caller, makeIPCException } from "../../lib-index";

type StartupW3N = web3n.startup.W3N;
type CommonW3N = web3n.caps.common.W3N;

function makePipe() {
	const fromCore = new Subject<Envelope>();
	const toClient = fromCore.asObservable().pipe(
		map(msg => msgProtoType.pack(msg)),
		delay(1),
		map(buf => msgProtoType.unpack(buf))
	);
	const fromClient = new Subject<Envelope>();
	const toCore = fromClient.asObservable().pipe(
		map(msg => msgProtoType.pack(msg)),
		delay(1),
		map(buf => msgProtoType.unpack(buf))
	);
	const coreSide = new ObjectsConnector(fromCore, toCore, 'services');
	const listObjInCore: Caller['listObj'] = path => {
		const lst = coreSide.exposedServices.listObj(path);
		if (lst) { return lst; }
		else { throw makeIPCException({ objectNotFound: true }); }
	};
	const clientSide = new ObjectsConnector(
		fromClient, toClient, 'clients', listObjInCore);
	return { coreSide, clientSide };
}

export function wrapStartupW3N(
	coreW3N: StartupW3N
): { clientW3N: StartupW3N; close: () => void; } {
	const { clientSide, coreSide } = makePipe();
	exposeStartupW3N(coreSide.exposedServices, coreW3N);
	const clientW3N = makeStartupW3Nclient(clientSide.caller);
	const close = () => coreSide.close();
	return { clientW3N, close };
}

export function wrapCommonW3N(
	coreW3N: CommonW3N
): { clientW3N: CommonW3N; close: () => void; } {
	const { clientSide, coreSide } = makePipe();
	exposeW3N(coreSide.exposedServices, coreW3N);
	const clientW3N = makeW3Nclient(clientSide.caller);
	const close = () => coreSide.close();
	return { clientW3N, close };
}