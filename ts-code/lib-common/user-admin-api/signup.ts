/*
 Copyright (C) 2015 - 2016, 2020 3NSoft Inc.
 
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
 * This defines interface for signup to 3NWeb services, but it is not part of
 * 3NWeb utility protocols, like ASMail.
 */

import { JsonKey } from '../jwkeys';

export const ERR_SC = {
	duplicate: 475,
	malformed: 400
};
Object.freeze(ERR_SC);

export namespace availableAddressesForName {

	export const URL_END = 'available-addresses-for-name';

	export const method = 'POST';

	export interface Request {
		name: string;
		signupToken?: string;
	}

	export const SC = {
		ok: 200
	};
	Object.freeze(SC);

}
Object.freeze(availableAddressesForName);

export interface UserMidParams {
	defaultPKey: {
		pkey: JsonKey;
		kdParams: any;
	};
	otherPKeys: JsonKey[];
}

export interface UserStorageParams {
	kdParams: any;
}

export namespace addUser {

	export const URL_END = 'add';

	export const method = 'POST';

	export interface Request {
		userId: string;
		mailerId: UserMidParams;
		storage: UserStorageParams;
		signupToken?: string;
	}

	export const SC = {
		ok: 200,
		userAlreadyExists: 473,
		unauthorized: 403
	};
	Object.freeze(SC);

}
Object.freeze(addUser);

export namespace isActivated {

	export const URL_END = 'is-active';

	export const method = 'POST';

	export interface Request {
		userId: string;
	}

	export const SC = {
		ok: 200,
		notActive: 274,
		userUnknown: 474
	};
	Object.freeze(SC);

}
Object.freeze(isActivated);


export interface ErrorReply {
	error: string;
}

Object.freeze(exports);