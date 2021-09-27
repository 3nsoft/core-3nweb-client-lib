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

import { ExposedObj, W3N_NAME, ExposedServices, Caller } from "../ipc-via-protobuf/connector";
import { exposeLogger, makeLogCaller } from "../ipc-via-protobuf/log-cap";
import { wrapSignInCAP, wrapSignUpCAP, makeSignInCaller, makeSignUpCaller } from "../ipc-via-protobuf/startup-cap";

type W3N = web3n.startup.W3N;

export function exposeStartupW3N(coreSide: ExposedServices, w3n: W3N): void {
	const expW3N: ExposedObj<W3N> = {
		signIn: wrapSignInCAP(w3n.signIn),
		signUp: wrapSignUpCAP(w3n.signUp)
	};
	if (w3n.log) {
		expW3N.log = exposeLogger(w3n.log);
	}
	coreSide.exposeW3NService(expW3N);
}

export function makeStartupW3Nclient(clientSide: Caller): W3N {
	const objPath = [ W3N_NAME ];
	const lstOfCAPs = clientSide.listObj(objPath) as (keyof W3N)[];
	const w3n: W3N = {
		signIn: makeSignInCaller(clientSide, objPath.concat('signIn')),
		signUp: makeSignUpCaller(clientSide, objPath.concat('signUp'))
	};
	if (lstOfCAPs.includes('log')) {
		w3n.log = makeLogCaller(clientSide, objPath.concat('log'));
	}
	return w3n;
}


Object.freeze(exports);