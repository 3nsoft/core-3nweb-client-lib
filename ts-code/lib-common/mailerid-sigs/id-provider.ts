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

import { signing, GetRandom, arrays } from "ecma-nacl";
import { keyToJson, keyFromJson } from "../jwkeys";
import { utf8, base64 } from "../buffer-utils";
import { KEY_USE, Keypair, makeMailerIdException } from "./index";

type JsonKey = web3n.keys.JsonKey;
type Key = web3n.keys.Key;
type KeyCert = web3n.keys.KeyCert;
type SignedLoad = web3n.keys.SignedLoad;

function genSignKeyPair(
	use: string, kidLen: number, random: GetRandom, arrFactory?: arrays.Factory
): Keypair {
	const pair = signing.generate_keypair(random(32), arrFactory);
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
	return { pkey: pkey, skey: skey };
}

function makeCert(
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

export const KID_BYTES_LENGTH = 9;

export const MAX_USER_CERT_VALIDITY = 24*60*60;

export function makeSelfSignedCert(
	address: string, validityPeriod: number, sjkey: JsonKey,
	arrFactory?: arrays.Factory
): SignedLoad {
	const skey = keyFromJson(sjkey, KEY_USE.ROOT,
		signing.JWK_ALG_NAME, signing.SECRET_KEY_LENGTH);
	const pkey: JsonKey = {
		use: sjkey.use,
		alg: sjkey.alg,
		kid: sjkey.kid,
		k: base64.pack(signing.extract_pkey(skey.k))
	};
	const now = Math.floor(Date.now()/1000);
	return makeCert(pkey, address, address,
		now, now+validityPeriod, skey, arrFactory);
}

/**
 * One should keep MailerId root key offline, as this key is used only to
 * sign provider keys, which have to work online.
 * @param address is an address of an issuer
 * @param validityPeriod validity period of a generated self-signed
 * certificate in milliseconds
 * @param random
 * @param arrFactory optional array factory
 * @return Generated root key and a self-signed certificate for respective
 * public key.
 */
export function generateRootKey(
	address: string, validityPeriod: number, random: GetRandom,
	arrFactory?: arrays.Factory
): { cert: SignedLoad; skey: JsonKey } {
	if (validityPeriod < 1) { throw new Error(`Illegal validity period: ${validityPeriod}`); }
	const rootPair = genSignKeyPair(KEY_USE.ROOT,
			KID_BYTES_LENGTH, random, arrFactory);
	const now = Math.floor(Date.now()/1000);
	const rootCert = makeCert(rootPair.pkey, address, address,
			now, now+validityPeriod, rootPair.skey, arrFactory);
	return { cert: rootCert, skey: keyToJson(rootPair.skey) };
}

/**
 * @param address is an address of an issuer
 * @param validityPeriod validity period of a generated self-signed
 * certificate in seconds
 * @param rootJKey root key in json format
 * @param random
 * @param arrFactory optional array factory
 * @return Generated provider's key and a certificate for a respective
 * public key.
 */
export function generateProviderKey(
	address: string, validityPeriod: number, rootJKey: JsonKey,
	random: GetRandom, arrFactory?: arrays.Factory
): { cert: SignedLoad; skey: JsonKey } {
	if (validityPeriod < 1) { throw new Error(`Illegal validity period: ${validityPeriod}`); }
	const rootKey = keyFromJson(rootJKey, KEY_USE.ROOT,
			signing.JWK_ALG_NAME, signing.SECRET_KEY_LENGTH);
	const provPair = genSignKeyPair(KEY_USE.PROVIDER,
			KID_BYTES_LENGTH, random, arrFactory);
	const now = Math.floor(Date.now()/1000);
	const rootCert = makeCert(provPair.pkey, address, address,
			now, now+validityPeriod, rootKey, arrFactory);
	return { cert: rootCert, skey: keyToJson(provPair.skey) };
}

/**
 * MailerId providing service should use this object to generate certificates.
 */
export interface IdProviderCertifier {
	/**
	 * @param publicKey
	 * @param address
	 * @param validFor (optional)
	 * @return certificate for a given key
	 */
	certify(publicKey: JsonKey, address: string,
			validFor?: number): SignedLoad;
	/**
	 * This securely erases internal key.
	 * Call this function, when certifier is no longer needed.
	 */
	destroy(): void;
}

/**
 * @param issuer is a domain of certificate issuer, at which issuer's public
 * key can be found to check the signature
 * @param validityPeriod is a default validity period in seconds, for
 * which certifier shall be making certificates
 * @param signJKey is a certificates signing key
 * @param arrFactory is an optional array factory
 * @return MailerId certificates generator, which shall be used on identity
 * provider's side
 */
export function makeIdProviderCertifier(
	issuer: string, validityPeriod: number, signJKey: JsonKey,
	arrFactory?: arrays.Factory
): IdProviderCertifier {
	if (!issuer) { throw new Error(`Given issuer is illegal: ${issuer}`); } 
	if ((validityPeriod < 1) || (validityPeriod > MAX_USER_CERT_VALIDITY)) {
		throw new Error(`Given certificate validity is illegal: ${validityPeriod}`);
	}
	let signKey = keyFromJson(
		signJKey, KEY_USE.PROVIDER, signing.JWK_ALG_NAME, signing.SECRET_KEY_LENGTH
	);
	signJKey = (undefined as any);
	if (!arrFactory) {
		arrFactory = arrays.makeFactory();
	}
	return {
		certify: (publicKey, address, validFor) => {
			if (!signKey) { throw new Error(`Certifier is already destroyed.`); }
			if (publicKey.use !== KEY_USE.SIGN) {
				throw new Error(`Given public key has use ${publicKey.use} and cannot be used for signing.`);
			}
			if (typeof validFor === 'number') {
				if (validFor > validityPeriod) {
					validFor = validityPeriod;
				} else if (validFor < 0) {
					new Error(`Given certificate validity is illegal: ${validFor}`);
				}
			} else {
				validFor = validityPeriod;
			}
			const now = Math.floor(Date.now()/1000);
			return makeCert(
				publicKey, address, issuer, now, now+validFor, signKey, arrFactory
			);
		},
		destroy: (): void => {
			if (!signKey) { return; }
			arrays.wipe(signKey.k);
			signKey = (undefined as any);
			arrFactory!.wipeRecycled();
			arrFactory = undefined;
		}
	};
}


Object.freeze(exports);