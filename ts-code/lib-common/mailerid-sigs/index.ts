/*
 Copyright (C) 2015 - 2017, 2025 3NSoft Inc.
 
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

import { makeRuntimeException } from "../exceptions/runtime";

type JsonKey = web3n.keys.JsonKey;
type Key = web3n.keys.Key;
type SignedLoad = web3n.keys.SignedLoad;
type MailerIdException = web3n.mailerid.MailerIdException;

/**
 * This enumerates MailerId's different use-roles of keys, involved in
 * establishing a trust.
 */
export const KEY_USE = {
	/**
	 * This is a MailerId trust root.
	 * It signs certificate for itself, and it signs certificates for provider
	 * keys, which have shorter life span, than the root.
	 * Root may revoke itself, and may revoke provider key.
	 */
	ROOT: "mid-root",
	/**
	 * This is a provider key, which is used to certify users' signing keys.
	 */
	PROVIDER: "mid-provider",
	/**
	 * With this key, MailerId user signs assertions and mail keys.
	 */
	SIGN: "mid-sign",
}
Object.freeze(KEY_USE);

export function makeMailerIdException(
	flags: Partial<MailerIdException>, params: Partial<MailerIdException>
): MailerIdException {
	return makeRuntimeException('mailerid', params, flags);
}

export function makeMalformedCertsException(message: string, cause?: any): MailerIdException {
	return makeMailerIdException({ certMalformed: true }, { message, cause } );
}

export interface Keypair {
	pkey: JsonKey;
	skey: Key;
}

export interface AssertionLoad {
	user: string;
	rpDomain: string;
	sessionId: string;
	issuedAt: number;
	expiresAt: number;
}

export interface CertsChain {
	user: SignedLoad;
	prov: SignedLoad;
	root: SignedLoad;
}
