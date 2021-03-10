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
 this program. If not, see <http://www.gnu.org/licenses/>.
*/

/**
 * This defines interfaces for public key login routes.
 */

export const ERR_SC = {
	duplicate: 475,
	malformed: 400,
	needAuth: 401
};
Object.freeze(ERR_SC);

export namespace start {

	export const URL_END = 'start-login-exchange';

	export const method = 'POST';

	export interface Request {
		userId: string;
		kid?: string;
	}

	export interface Reply {
		sessionId: string;
		sessionKey: string;
		serverPubKey: string;
		keyDerivParams: any;
	}

	export interface RedirectReply {
		redirect: string;
	}

	export const SC = {
		unknownUser: 474,
		redirect: 373,
		ok: 200
	};
	Object.freeze(SC);

}
Object.freeze(start);

export namespace complete {

	export const URL_END = 'complete-login-exchange';

	export const method = 'POST';

	export const SC = {
		authFailed: 403,
		ok: 200
	};
	Object.freeze(SC);

}
Object.freeze(complete);

export interface ErrorReply {
	error: string;
}

Object.freeze(exports);