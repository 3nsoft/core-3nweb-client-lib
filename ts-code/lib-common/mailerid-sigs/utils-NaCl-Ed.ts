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

import { signing, GetRandom, arrays, compareVectors } from "ecma-nacl";
import { utf8, base64 } from "../buffer-utils";
import { Keypair, makeMailerIdException } from "./index";

type JsonKey = web3n.keys.JsonKey;
type Key = web3n.keys.Key;
type KeyCert = web3n.keys.KeyCert;
type SignedLoad = web3n.keys.SignedLoad;

export function genSignKeyPair(
	use: string, kidLen: number, random: GetRandom, arrFactory?: arrays.Factory
): Keypair {
	const pair = signing.generate_keypair(random(signing.SEED_LENGTH), arrFactory);
	const pkey: JsonKey = {
		use: use,
		alg: signing.JWK_ALG_NAME,
		kid: base64.pack(random(kidLen)),
		k: base64.pack(pair.pkey)
	};
	const skey: Key = {
		use: pkey.use,
		alg: pkey.alg,
		kid: pkey.kid,
		k: pair.skey
	}
	return { pkey, skey };
}

export function makeCert(
	pkey: JsonKey, principalAddr: string, issuer: string,
	issuedAt: number, expiresAt: number, signKey: Key,
	arrFactory?: arrays.Factory
): SignedLoad {
	if (signKey.alg !== signing.JWK_ALG_NAME) {
		throw makeMailerIdException(
			{ algMismatch: true },
			{ message: `Given signing key is used with unknown algorithm ${signKey.alg}` }
		);
	}
	const cert: KeyCert = {
		cert: {
			publicKey: pkey,
			principal: { address: principalAddr }
		},
		issuer: issuer,
		issuedAt: issuedAt,
		expiresAt: expiresAt
	};
	const certBytes = utf8.pack(JSON.stringify(cert));
	const sigBytes = signing.signature(certBytes, signKey.k, arrFactory);
	return {
		alg: signKey.alg,
		kid: signKey.kid,
		sig: base64.pack(sigBytes),
		load: base64.pack(certBytes)
	};
}
