/*
 Copyright (C) 2015 - 2018 3NSoft Inc.
 
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
 * This file contains common functions used by parts of a keyring.
 */

import { box, secret_box as sbox } from 'ecma-nacl';
import { base64 } from '../../lib-common/buffer-utils';
import { bytes as randomBytes, stringOfB64Chars as randomB64String } from '../../lib-common/random-node';

type JsonKey = web3n.keys.JsonKey;
type JsonKeyShort = web3n.keys.JsonKeyShort;

export type MsgKeyRole = 'suggested' | 'in_use' | 'old' |
	'published_intro' | 'prev_published_intro' | 'introductory';

export const KID_LENGTH = 16;
export const PID_LENGTH = 2;

export interface JWKeyPair {
	skey: JsonKey;
	pkey: JsonKey;
	createdAt?: number;
	retiredAt?: number;
}

export interface ASMailKeyPair {
	pid?: string;
	senderPKey?: JsonKey;
	recipientKid?: string;
}

export interface KeyPairInfo {
	role: string;
	pair: JWKeyPair;
	replacedAt?: number;
}

export const KEY_USE = {
		PUBLIC: 'asmail-pub-key',
		SECRET: 'asmail-sec-key',
		SYMMETRIC: 'asmail-sym-key'
};
Object.freeze(KEY_USE);

/**
 * This returns an object with two fields: skey & pkey, holding JWK form of
 * secret and public keys respectively.
 * These are to be used with NaCl's box (Curve+XSalsa+Poly encryption).
 * Key ids are the same in this intimate pair.
 */
export async function generateKeyPair(): Promise<JWKeyPair> {
	const skeyBytes = await randomBytes(box.KEY_LENGTH);
	const pkeyBytes = box.generate_pubkey(skeyBytes);
	const kid = await randomB64String(KID_LENGTH);
	const skey: JsonKey = {
		use: KEY_USE.SECRET,
		alg: box.JWK_ALG_NAME,
		kid,
		k: base64.pack(skeyBytes),
	};
	const pkey: JsonKey = {
		use: KEY_USE.PUBLIC,
		alg: box.JWK_ALG_NAME,
		kid,
		k: base64.pack(pkeyBytes)
	};
	return { skey: skey, pkey: pkey };
};

/**
 * We have this function for future use by a keyring, that takes symmetric key.
 * This keyring, is specifically tailored to handle short-lived public keys.
 * Therefore, this function is not used at the moment.
 * This returns a JWK form of a key for NaCl's secret box (XSalsa+Poly
 * encryption).
 */
export async function generateSymmetricKey(): Promise<JsonKey> {
	return {
		use: KEY_USE.SYMMETRIC,
		k: base64.pack(await randomBytes(sbox.KEY_LENGTH)),
		alg: sbox.JWK_ALG_NAME,
		kid: await randomB64String(KID_LENGTH)
	};
};

function getKeyBytesFrom(
	key: JsonKey, use: string, alg: string, klen: number
): Uint8Array {
	if (key.use === use) {
		if (key.alg === alg) {
			const bytes = base64.open(key.k);
			if (bytes.length !== klen) { throw new Error(
				`Key ${key.kid} has a wrong number of bytes`
			); }
			return bytes;
		} else {
			throw new Error(`Key ${key.kid}, should be used with unsupported algorithm '${key.alg}'`);
		}
	} else {
		throw new Error(`Key ${key.kid} has incorrect use '${key.use}', instead of '${use}'`);
	}
}

/**
 * This returns bytes of from a given secret key's JWK form
 * @param key is a JWK form of a key
 */
export function extractSKeyBytes(key: JsonKey): Uint8Array {
	return getKeyBytesFrom(
		key, KEY_USE.SECRET, box.JWK_ALG_NAME, box.KEY_LENGTH
	);
}

/**
 * This returns bytes of from a given public key's JWK form
 * @param key is a JWK form of a key
 */
export function extractPKeyBytes(key: JsonKey): Uint8Array {
	return getKeyBytesFrom(
		key, KEY_USE.PUBLIC, box.JWK_ALG_NAME, box.KEY_LENGTH
	);
}

/**
 * This returns bytes of a given public key's short JWK form
 * @param key is a short JWK form of a key
 */
export function extractKeyBytes(key: JsonKeyShort): Uint8Array {
	const bytes = base64.open(key.k);
	if (bytes.length !== box.KEY_LENGTH) { throw new Error(
		`Key ${key.kid} has a wrong number of bytes`); }
	return bytes;
}

/**
 * This returns a length of a message key pack, used with a given public key
 * crypt-algorithms assembly.
 * @param alg 
 */
export function msgKeyPackSizeFor(alg: string): number {
	if (alg === box.JWK_ALG_NAME) {
		return 72;
	} else {
		throw new Error(`Encryption algorithm ${alg} is not known.`);
	}
}


Object.freeze(exports);