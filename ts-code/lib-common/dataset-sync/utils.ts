/*
 Copyright (C) 2026 3NSoft Inc.
 
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

import { ConnectException } from "../exceptions/http";
import { SingleProc } from "../processes/synced";

/**
 * Returned promise resolves when action runs first time, successfully or not.
 * On disconnect action will be triggered again but outside of return promise.
 * @param action 
 * @param whenConnected 
 * @param changeProc when given, is used to chain action invocation
 */
export async function runRetryingButNotBlockingOnDisconnect(
	action: () => Promise<any>, whenConnected: () => Promise<void>, changeProc?: SingleProc
): Promise<void> {
	if (changeProc) {
		await changeProc.startOrChain(action).catch((exc: ConnectException) => {
			if (exc.type === 'connect') {
				whenConnected().then(() => runRetryingButNotBlockingOnDisconnect(
					() => changeProc.startOrChain(action), whenConnected, changeProc
				));
			}
		});
	} else {
		await action().catch((exc: ConnectException) => {
			if (exc.type === 'connect') {
				whenConnected().then(() => runRetryingButNotBlockingOnDisconnect(action, whenConnected));
			}
		});
	}
}

/**
 * Returned promise resolves when action ultimately runs or fails, after all possible disconnects.
 * @param action 
 * @param whenConnected 
 * @param changeProc when given, is used to chain action invocation
 */
export async function runRetryingOnDisconnectTillDone<T>(
	action: () => Promise<T>, whenConnected: () => Promise<void>, changeProc?: SingleProc
): Promise<T> {
	if (changeProc) {
		return await changeProc.startOrChain(action).catch((exc: ConnectException) => {
			if (exc.type === 'connect') {
				return whenConnected().then(() => runRetryingOnDisconnectTillDone(
					() => changeProc.startOrChain(action), whenConnected, changeProc
				));
			} else {
				throw exc;
			}
		});
	} else {
		return await action().catch((exc: ConnectException) => {
			if (exc.type === 'connect') {
				return whenConnected().then(() => runRetryingOnDisconnectTillDone(action, whenConnected));
			} else {
				throw exc;
			}
		});
	}
}


Object.freeze(exports);