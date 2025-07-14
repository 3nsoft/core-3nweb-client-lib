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
import { keyFromJson, getKeyCert } from "../jwkeys";
import { utf8, base64 } from "../buffer-utils";
import { copy as jsonCopy } from "../json-utils";
import { genSignKeyPair, makeCert } from "./utils-NaCl-Ed";
import { AssertionLoad, KEY_USE, Keypair } from "./index";

type JsonKey = web3n.keys.JsonKey;
type Key = web3n.keys.Key;
type KeyCert = web3n.keys.KeyCert;
type SignedLoad = web3n.keys.SignedLoad;


function correlateSKeyWithItsCert(skey: Key, cert: KeyCert): void {
	const pkey = keyFromJson(
		cert.cert.publicKey, skey.use, signing.JWK_ALG_NAME, signing.PUBLIC_KEY_LENGTH
	);
	if ((pkey.kid !== skey.kid) || (pkey.use !== skey.use) || (pkey.alg !== skey.alg)
	|| !compareVectors(signing.extract_pkey(skey.k), pkey.k)) {
		throw new Error("Key does not correspond to certificate.");
	}
}

/**
 * This is used by user of MailerId to create assertion that prove user's
 * identity.
 */
export interface MailerIdSigner {
	address: string;
	userCert: SignedLoad;
	providerCert: SignedLoad;
	issuer: string;
	certExpiresAt: number;
	validityPeriod: number;

	/**
	 * @param rpDomain relying party domain. If there is an explicit port,
	 * this should domain:port, which is a hostname part of url parsing.
	 * @param sessionId
	 * @param validFor (optional)
	 * @returns signed assertion with a given sessionId string.
	 */
	generateAssertionFor(
		rpDomain: string, sessionId: string, validFor?: number
	): SignedLoad;

	/**
	 * @param pkey
	 * @param validFor
	 * @returns signed certificate with a given public key.
	 */
	certifyPublicKey(pkey: JsonKey, validFor: number): SignedLoad;

	/**
	 * Makes this AssertionSigner not usable by wiping its secret key.
	 */
	destroy(): void;

	/**
	 * @param payload 
	 * @returns  
	 */
	sign(payload: Uint8Array): {
		provCert: SignedLoad;
		signeeCert: SignedLoad;
		signature: SignedLoad;
	};
}

export const KID_BYTES_LENGTH = 9;

export const MAX_SIG_VALIDITY = 30*60;

export function generateSigningKeyPair(random: GetRandom, arrFactory?: arrays.Factory): Keypair {
	return genSignKeyPair(KEY_USE.SIGN, KID_BYTES_LENGTH, random, arrFactory);
}

/**
 * @param signKey which will be used to sign assertions/keys. Note that
 * this key shall be wiped, when signer is destroyed, as key is neither
 * long-living, nor should be shared.  
 * @param cert is user's certificate, signed by identity provider.
 * @param provCert is provider's certificate, signed by respective mid root.
 * @param assertionValidity is an assertion validity period in seconds
 * @param arrFactory is an optional array factory
 * @return signer for user of MailerId to generate assertions, and to sign
 * keys.
 */
export function makeMailerIdSigner(
	signKey: Key, userCert: SignedLoad, provCert: SignedLoad,
	assertionValidity = MAX_SIG_VALIDITY, arrFactory?: arrays.Factory
): MailerIdSigner {
	const certificate = getKeyCert(userCert);
	if (signKey.use !== KEY_USE.SIGN) {
		throw new Error(`Given key ${signKey.kid} has incorrect use: ${signKey.use}`);
	}
	correlateSKeyWithItsCert(signKey, certificate);
	if ((typeof assertionValidity !== 'number') || (assertionValidity < 1)
	|| (assertionValidity > MAX_SIG_VALIDITY)) {
		throw new Error(`Given assertion validity is illegal: ${assertionValidity}`);
	}
	if (!arrFactory) {
		arrFactory = arrays.makeFactory();
	}
	function ensureSignerCanBeUsed(): void {
		if (!signKey) { throw new Error("Signer is already destroyed."); }
	}

	const signer: MailerIdSigner = {

		address: certificate.cert.principal.address,
		userCert: userCert,
		providerCert: provCert,
		issuer: certificate.issuer,
		certExpiresAt: certificate.expiresAt,
		validityPeriod: assertionValidity,

		generateAssertionFor: (rpDomain, sessionId, validFor) => {
			ensureSignerCanBeUsed();
			if (typeof validFor === 'number') {
				if (validFor > assertionValidity) {
					validFor = assertionValidity;
				} else if (validFor < 0) {
					new Error(`Given assertion validity is illegal: ${validFor}`);
				}
			} else {
				validFor = assertionValidity;
			}
			let now = Math.floor(Date.now()/1000);
			if (now <= certificate.issuedAt) {
				now = certificate.issuedAt + 1;
			}
			if (now >= certificate.expiresAt) { throw new Error(`Signing key has already expiried at ${certificate.expiresAt} and now is ${now}`); }
			const assertion: AssertionLoad = {
				rpDomain: rpDomain,
				sessionId: sessionId,
				user: certificate.cert.principal.address,
				issuedAt: now,
				expiresAt: now+validFor
			}
			const assertionBytes = utf8.pack(JSON.stringify(assertion));
			const sigBytes = signing.signature(
				assertionBytes, signKey.k, arrFactory
			);
			return {
				alg: signKey.alg,
				kid: signKey.kid,
				sig: base64.pack(sigBytes),
				load: base64.pack(assertionBytes)
			}
		},

		certifyPublicKey: (pkey, validFor) => {
			ensureSignerCanBeUsed();
			if (validFor < 0) {
				new Error(`Given certificate validity is illegal: ${validFor}`);
			}
			const now = Math.floor(Date.now()/1000);
			if (now >= certificate.expiresAt) {
				throw new Error(`Signing key has already expiried at ${certificate.expiresAt} and now is ${now}`);
			}
			return makeCert(
				pkey, certificate.cert.principal.address,
				certificate.cert.principal.address,
				now, now+validFor, signKey, arrFactory
			);
		},

		destroy: () => {
			if (!signKey) { return; }
			arrays.wipe(signKey.k);
			signKey = (undefined as any);
			arrFactory!.wipeRecycled();
			arrFactory = (undefined as any);
		},

		sign: payload => {
			ensureSignerCanBeUsed();
			const sigBytes = signing.signature(payload, signKey.k, arrFactory);
			return {
				signature: {
					alg: signKey.alg,
					kid: signKey.kid,
					sig: base64.pack(sigBytes),
					load: base64.pack(payload)
				},
				provCert: jsonCopy(provCert),
				signeeCert: jsonCopy(userCert)
			};
		}

	};
	Object.freeze(signer);
	return signer;
}
