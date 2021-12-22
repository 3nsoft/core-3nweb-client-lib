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

import { W3N_NAME, ExposedServices, Caller } from "../ipc-via-protobuf/connector";
import { exposeLogger, makeLogCaller } from "../ipc-via-protobuf/log-cap";
import { wrapSignInCAP, wrapSignUpCAP, makeSignInCaller, makeSignUpCaller } from "../ipc-via-protobuf/startup-cap";
import { CapExposer, exposeCAPs, MakeCapClient, makeClientSide } from "./generic";

type W3N = web3n.startup.W3N;

export function exposeStartupW3N<T extends W3N>(
	coreSide: ExposedServices, w3n: T,
	extraCAPs?: { [cap in keyof T]: CapExposer; }
): void {
	const startupCAPsExposures: { [cap in keyof W3N]: CapExposer; } = {
		signIn: wrapSignInCAP,
		signUp: wrapSignUpCAP,
		log: exposeLogger,
	};
	exposeCAPs(coreSide, w3n, startupCAPsExposures, extraCAPs);
}

// This is not used, but it ensures that some require runs, providing function
// for protobuf-something.
const unused = W3N_NAME;

export function makeStartupW3Nclient<T extends W3N>(
	clientSide: Caller, extraCAPs?: { [cap in keyof T]: MakeCapClient; }
): W3N {
	const mainCAPs: { [cap in keyof W3N]: MakeCapClient; } = {
		log: makeLogCaller,
		signIn: makeSignInCaller,
		signUp: makeSignUpCaller,
	};
	return makeClientSide(clientSide, mainCAPs, extraCAPs);
}


Object.freeze(exports);