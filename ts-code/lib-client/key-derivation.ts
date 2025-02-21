/*
 Copyright (C) 2015 - 2016 3NSoft Inc.

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

import { keyToJson } from '../lib-common/jwkeys';
import { utf8, base64 } from '../lib-common/buffer-utils';
import { box, secret_box as sbox } from 'ecma-nacl';
import { Cryptor } from './cryptor/cryptor';

type JsonKey = web3n.keys.JsonKey;

export interface ScryptGenParams {
	logN: number;
	r: number;
	p: number;
	salt: string;
}

export function checkParams(params: ScryptGenParams): boolean {
	if (('object' !== typeof params) ||
			('number' !== typeof params.logN) ||
			('number' !== typeof params.r) ||
			('number' !== typeof params.p)) {
		return false;
	}
	try {
		base64.open(params.salt);
	} catch (err) {
		return false;
	}
	return true;
}

export function deriveStorageSKey(
	cryptor: Cryptor, pass: string, derivParams: ScryptGenParams,
	progressCB: (p: number) => void
): Promise<Uint8Array> {
	const passBytes = utf8.pack(pass);
	const saltBytes = base64.open(derivParams.salt);
	return cryptor.scrypt(passBytes, saltBytes,
		derivParams.logN, derivParams.r, derivParams.p,
		sbox.KEY_LENGTH, progressCB);
}

export async function deriveMidKeyPair(
	cryptor: Cryptor, pass: string, derivParams: ScryptGenParams,
	progressCB: (p: number) => void, use = '', kid = ''
): Promise<{ skey: Uint8Array; pkey: JsonKey; }> {
	const passBytes = utf8.pack(pass);
	const saltBytes = base64.open(derivParams.salt);
	const skey = await cryptor.scrypt(passBytes, saltBytes,
		derivParams.logN, derivParams.r, derivParams.p,
		box.KEY_LENGTH, progressCB);
	const pkey = await cryptor.box.generate_pubkey(skey);
	const pkeyJSON = keyToJson({
		k: pkey,
		alg: box.JWK_ALG_NAME,
		use: use,
		kid: kid
	});
	return {
		skey: skey,
		pkey: pkeyJSON
	};
}

Object.freeze(exports);