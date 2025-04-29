/*
 Copyright (C) 2015 3NSoft Inc.
 
 This program is free software: you can redistribute it and/or modify it under
 the terms of the GNU General Public License as published by the Free Software
 Foundation, either version 3 of the License, or (at your option) any later
 version.
 
 This program is distributed in the hope that it will be useful, but
 WITHOUT ANY WARRANTY; without even the implied warranty of
 MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 See the GNU General Public License for more details.
 
 You should have received a copy of the GNU General Public License along with
 this program. If not, see <http://www.gnu.org/licenses/>. */

export type ConnectException = web3n.ConnectException;
export type HTTPException = web3n.HTTPException;

export function makeConnectionException(
	url: string|undefined, method: string|undefined, msg?: string, cause?: any
): ConnectException {
	const exc: ConnectException = {
		runtimeException: true,
		type: 'http-connect',
		url: url!,
		method: method!,
		cause
	};
	if (msg) {
		exc.message = msg;
	}
	return exc;
}

export function makeHTTPException(
	url: string, method: string, status: number, msg?: string, cause?: any
): HTTPException {
	const exc: HTTPException = {
		runtimeException: true,
		type: 'http-request',
		url: url,
		method: method,
		status: status,
		cause
	};
	if (msg) {
		exc.message = msg;
	}
	return exc;
}

Object.freeze(exports);