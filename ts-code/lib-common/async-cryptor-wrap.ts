/*
 Copyright (C) 2017 3NSoft Inc.
 
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

import { AsyncSBoxCryptor, advanceNonce } from 'xsp-files';
import { box } from 'ecma-nacl';
import { makeUint8ArrayCopy } from './buffer-utils';

/**
 * This is an encryptor that packs bytes according to "with-nonce" format.
 */
export interface Encryptor {
	/**
	 * This encrypts given bytes using internally held nonce, which is
	 * advanced for every packing operation, ensuring that every call will
	 * have a different nonce.
	 * This function returns a promise, resolable to byte array with cipher
	 * formatted with nonce
	 * @param m is a byte array that should be encrypted
	 */
	pack(m: Uint8Array): Promise<Uint8Array>;
	/**
	 * This method securely wipes internal key, and drops resources, so that
	 * memory can be GC-ed.
	 */
	destroy(): void;
	/**
	 * @return an integer, by which nonce is advanced.
	 */
	getDelta(): number;
}

/**
 * This is a dencryptor that unpacks bytes from "with-nonce" format.
 */
export interface Decryptor {
	
	/**
	 * This returns a promise, resolvable to decrypted bytes.
	 * @param c is a byte array with cipher, formatted with nonce.
	 */
	open(c: Uint8Array): Promise<Uint8Array>;
	
	/**
	 * This method securely wipes internal key, and drops resources, so that
	 * memory can be GC-ed.
	 */
	destroy(): void;
	
}

/**
 * This returns an encryptor that packs bytes according to "with-nonce" format,
 * keeping track and automatically advancing nonce.
 * @param cryptor is an async cryptor that will be used by created encryptor.
 * @param workLabel
 * @param key for new encryptor.
 * Note that key will be copied, thus, if given array shall never be used
 * anywhere, it should be wiped after this call.
 * @param nextNonce is nonce, which should be used for the very first packing.
 * All further packing will be done with new nonce, as it is automatically
 * advanced.
 * Note that nextNonce will be copied.
 * @param delta is a number between 1 and 255 inclusive, used to advance nonce.
 * When missing, it defaults to one.
 */
export function makeEncryptor(
	cryptor: AsyncSBoxCryptor, workLabel: number,
	key: Uint8Array, nextNonce: Uint8Array, delta?: number
): Encryptor {
	if (!(nextNonce instanceof Uint8Array)) { throw new TypeError(
		"Nonce array nextNonce must be Uint8Array."); }
	if (nextNonce.length !== 24) { throw new Error(
		`Nonce array nextNonce should have 24 elements (bytes) in it, but it is ${nextNonce.length} elements long.`); }
	if (!(key instanceof Uint8Array)) { throw new TypeError(
		"Key array key must be Uint8Array."); }
	if (key.length !== 32) { throw new Error(
		`Key array key should have 32 elements (bytes) in it, but it is ${key.length} elements long.`); }
	if (typeof delta !== 'number') {
		delta = 1;
	} else if ((delta < 1) || (delta > 255)) {
		throw new Error("Given delta is out of bounds.");
	}
	
	key = makeUint8ArrayCopy(key);
	nextNonce = makeUint8ArrayCopy(nextNonce);
	let counter = 0;
	const counterMax = Math.floor(0xfffffffffffff / delta);
	
	const encryptor: Encryptor = {
		pack: async (m) => {
			if (!key) { throw new Error(
				`This encryptor cannot be used, as it had already been destroyed.`); }
			if (counter > counterMax) { throw new Error(
				`This encryptor has been used too many times. Further use may lead to duplication of nonces.`); }
			const c = await cryptor.formatWN.pack(m, nextNonce, key, workLabel);
			advanceNonce(nextNonce, delta!);
			counter += 1;
			return c;
		},
		destroy: () => {
			if (!key) { return; }
			key.fill(0);
			key = undefined as any;
			nextNonce.fill(0);
			nextNonce = undefined as any;
		},
		getDelta: () => {
			return delta!;
		}
	};
	
	return Object.freeze(encryptor);
}

/**
 * @param cryptor
 * @param workLabel
 * @param key for new decryptor.
 * Note that key will be copied, thus, if given array shall never be used
 * anywhere, it should be wiped after this call.
 * @return a frozen object with pack & open and destroy functions.
 */
export function makeDecryptor(
	cryptor: AsyncSBoxCryptor, workLabel: number, key: Uint8Array
): Decryptor {
	if (!(key instanceof Uint8Array)) { throw new TypeError(
		"Key array key must be Uint8Array."); }
	if (key.length !== 32) { throw new Error(
		`Key array key should have 32 elements (bytes) in it, but it is ${key.length} elements long.`); }
	
	key = makeUint8ArrayCopy(key);
	
	const decryptor = {
		open: (c) => {
			if (!key) {
				throw new Error(`This decryptor cannot be used, as it had already been destroyed.`);
			}
			return cryptor.formatWN.open(c, key, workLabel);
		},
		destroy: () => {
			if (!key) { return; }
			key.fill(0);
			key = undefined as any;
		}
	};
	
	return Object.freeze(decryptor);
}

export function makeDecryptorForKeyPair(
	cryptor: AsyncSBoxCryptor, workLabel: number,
	pkey: Uint8Array, skey: Uint8Array
): Decryptor {
	const dhSharedKey = box.calc_dhshared_key(pkey, skey);
	const decryptor = makeDecryptor(cryptor, workLabel, dhSharedKey);
	dhSharedKey.fill(0);
	return decryptor;
}

export function makeEncryptorWithKeyPair(
	cryptor: AsyncSBoxCryptor, workLabel: number,
	pkey: Uint8Array, skey: Uint8Array,
	nextNonce: Uint8Array, delta?: number
): Encryptor {
	const dhSharedKey = box.calc_dhshared_key(pkey, skey);
	const decryptor = makeEncryptor(
		cryptor, workLabel, dhSharedKey, nextNonce, delta
	);
	dhSharedKey.fill(0);
	return decryptor;
}

Object.freeze(exports);	