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

/**
 * This library handles signing and verification of signatures, used
 * in MailerId.
 */

import { signing, GetRandom, arrays, compareVectors } from "ecma-nacl";
import { keyToJson, keyFromJson, getKeyCert } from "./jwkeys";
import { utf8, base64 } from "./buffer-utils";

type JsonKey = web3n.keys.JsonKey;
type Key = web3n.keys.Key;
type KeyCert = web3n.keys.KeyCert;
type SignedLoad = web3n.keys.SignedLoad;

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

export const exceptionType = 'mailerid';

export interface MidException extends web3n.RuntimeException {
	type: 'mailerid';
	msg: string;
	algMismatch?: true;
	timeMismatch?: true;
	certsMismatch?: true;
	certMalformed?: true;
	sigVerificationFails?: true;
}

function makeAlgMismatchException(msg: string): MidException {
	return {
		runtimeException: true,
		type: 'mailerid',
		msg,
		algMismatch: true
	}
}

function makeTimeMismatchException(msg: string): MidException {
	return {
		runtimeException: true,
		type: 'mailerid',
		msg,
		timeMismatch: true
	}
}

function makeCertsMismatchException(msg: string): MidException {
	return {
		runtimeException: true,
		type: 'mailerid',
		msg,
		certsMismatch: true
	}
}

export function makeMalformedCertsException(msg: string, cause?: any):
		MidException {
	return {
		runtimeException: true,
		type: 'mailerid',
		msg,
		certMalformed: true,
		cause
	}
}

function makeSigVerifException(msg: string): MidException {
	return {
		runtimeException: true,
		type: 'mailerid',
		msg,
		sigVerificationFails: true
	}
}

export interface Keypair {
	pkey: JsonKey;
	skey: Key;
}

function genSignKeyPair(use: string, kidLen: number, random: GetRandom,
		arrFactory?: arrays.Factory): Keypair {
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

function makeCert(pkey: JsonKey, principalAddr: string,
		issuer: string, issuedAt: number, expiresAt: number,
		signKey: Key, arrFactory?: arrays.Factory): SignedLoad {
	if (signKey.alg !== signing.JWK_ALG_NAME) { throw makeAlgMismatchException(
		`Given signing key is used with unknown algorithm ${signKey.alg}`); }
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

export module idProvider {

	export const KID_BYTES_LENGTH = 9;

	export const MAX_USER_CERT_VALIDITY = 24*60*60;

	export function makeSelfSignedCert(address: string, validityPeriod: number,
			sjkey: JsonKey, arrFactory?: arrays.Factory):
			SignedLoad {
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
	export function generateRootKey(address: string, validityPeriod: number,
			random: GetRandom, arrFactory?: arrays.Factory):
			{ cert: SignedLoad; skey: JsonKey } {
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
	export function generateProviderKey(address: string, validityPeriod: number,
			rootJKey: JsonKey, random: GetRandom,
			arrFactory?: arrays.Factory):
			{ cert: SignedLoad; skey: JsonKey } {
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
	export function makeIdProviderCertifier(issuer: string,
			validityPeriod: number, signJKey: JsonKey,
			arrFactory?: arrays.Factory): IdProviderCertifier {
		if (!issuer) { throw new Error(`Given issuer is illegal: ${issuer}`); } 
		if ((validityPeriod < 1) || (validityPeriod > MAX_USER_CERT_VALIDITY)) {
			throw new Error(`Given certificate validity is illegal: ${validityPeriod}`);
		}
		let signKey = keyFromJson(signJKey, KEY_USE.PROVIDER,
				signing.JWK_ALG_NAME, signing.SECRET_KEY_LENGTH);
		signJKey = (undefined as any);
		if (!arrFactory) {
			arrFactory = arrays.makeFactory();
		}
		return {
			certify: (publicKey: JsonKey, address: string,
					validFor?: number): SignedLoad => {
				if (!signKey) { throw new Error(`Certifier is already destroyed.`); }
				if (publicKey.use !== KEY_USE.SIGN) { throw new Error(
						`Given public key has use ${publicKey.use} and cannot be used for signing.`); }
				if ('number' === typeof validFor) {
					if (validFor > validityPeriod) {
						validFor = validityPeriod;
					} else if (validFor < 0) {
						new Error(`Given certificate validity is illegal: ${validFor}`);
					}
				} else {
					validFor = validityPeriod;
				}
				const now = Math.floor(Date.now()/1000);
				return makeCert(publicKey, address, issuer,
						now, now+validFor, signKey, arrFactory);
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

}
Object.freeze(idProvider);

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

export module relyingParty {

	const minValidityPeriodForCert = 20*60;

	function verifyCertAndGetPubKey(signedCert: SignedLoad, use: string,
			validAt: number, arrFactory: arrays.Factory|undefined,
			issuer?: string, issuerPKey?: Key):
			{ pkey: Key; address:string; } {
		const cert = getKeyCert(signedCert);
		if ((validAt < (cert.issuedAt - minValidityPeriodForCert))
		|| (cert.expiresAt <= validAt)) {
			throw makeTimeMismatchException(`Certificate is not valid at a given moment ${validAt}, cause it is issued at ${cert.issuedAt}, and expires at ${cert.expiresAt}`);
		}
		if (issuer) {
			if (!issuerPKey) { throw new Error(`No issuer key given.`); }
			if ((cert.issuer !== issuer) ||
					(signedCert.kid !== issuerPKey.kid)) {
				throw makeCertsMismatchException(`Certificate is not signed by issuer key.`);
			}
		}
		let pkey: Key;
		let sig: Uint8Array;
		let load: Uint8Array;
		try {
			pkey = keyFromJson(cert.cert.publicKey, use,
				signing.JWK_ALG_NAME, signing.PUBLIC_KEY_LENGTH);
			sig = base64.open(signedCert.sig);
			load = base64.open(signedCert.load);
		} catch (err) {
			throw makeMalformedCertsException(`Cannot read certificate`, err);
		}
		const pk = (issuer ? issuerPKey!.k : pkey.k);
		const certOK = signing.verify(sig, load, pk, arrFactory);
		if (!certOK) { throw makeSigVerifException(`Certificate ${use} failed validation.`); }
		return { pkey: pkey, address: cert.cert.principal.address };
	}

	/**
	 * @param certs is a chain of certificate to be verified.
	 * @param rootAddr is MailerId service's domain.
	 * @param validAt is an epoch time moment (in second), at which user
	 * certificate must be valid. Provider certificate must be valid at
	 * creation of user's certificate. Root certificate must be valid at
	 * creation of provider's certificate.
	 * @return user's MailerId signing key with user's address.
	 */
	export function verifyChainAndGetUserKey(certs: CertsChain,
			rootAddr: string, validAt: number, arrFactory?: arrays.Factory):
			{ pkey: Key; address:string; } {
		// root certificate must be valid when provider's certificate was issued
		let rootValidityMoment: number;
		try {
			rootValidityMoment = getKeyCert(certs.prov).issuedAt;
		} catch (err) {
			throw makeMalformedCertsException(`Provider's certificate is malformed`, err);
		}

		// check root and get the key
		const root = verifyCertAndGetPubKey(
			certs.root, KEY_USE.ROOT, rootValidityMoment, arrFactory);
		if (rootAddr !== root.address) { throw makeCertsMismatchException(`Root certificate address ${root.address} doesn't match expected address ${rootAddr}`); }

		// provider's certificate must be valid when user's certificate was issued
		let provValidityMoment: number;
		try {
			provValidityMoment = getKeyCert(certs.user).issuedAt;
		} catch (err) {
			throw makeMalformedCertsException(`User's certificate is malformed`, err);
		}
		
		// check provider and get the key
		const provider = verifyCertAndGetPubKey(certs.prov, KEY_USE.PROVIDER,
			provValidityMoment, arrFactory, root.address, root.pkey);
		
		// check that provider cert comes from the same issuer as root
		if (root.address !== provider.address) { throw makeCertsMismatchException(`Provider's certificate address ${provider.address} doesn't match expected address ${root.address}.`); }
		
		// check user certificate and get the key
		return verifyCertAndGetPubKey(certs.user, KEY_USE.SIGN,
				validAt, arrFactory, provider.address, provider.pkey);
	}

	export interface AssertionInfo {
		relyingPartyDomain: string;
		sessionId: string;
		user: string;
	}

	export function verifyAssertion(midAssertion: SignedLoad,
			certChain: CertsChain, rootAddr: string,
			validAt: number, arrFactory?: arrays.Factory): AssertionInfo {
		const userInfo = verifyChainAndGetUserKey(
			certChain, rootAddr, validAt, arrFactory);
		let loadBytes: Uint8Array;
		let sigBytes: Uint8Array;
		let assertion: AssertionLoad;
		try {
			loadBytes = base64.open(midAssertion.load);
			sigBytes = base64.open(midAssertion.sig);
			assertion = JSON.parse(utf8.open(loadBytes));
		} catch (err) {
			throw makeMalformedCertsException(`Cannot read assertion`, err);
		}
		if (!signing.verify(sigBytes, loadBytes, userInfo.pkey.k, arrFactory)) {
			throw makeSigVerifException(`Assertion fails verification.`);
		}
		if (assertion.user !== userInfo.address) {
			throw makeMalformedCertsException(
				`Assertion is for one user, while chain is for another.`);
		}
		if (!assertion.sessionId) {throw makeMalformedCertsException(
			`Assertion doesn't have session id.`); }
		// Note that assertion can be valid before issue time, to counter
		// some mis-synchronization of clocks.
		// It can be some fixed value, like minimum validity period of certs.
		if (Math.abs(validAt - assertion.issuedAt) >
				(assertion.expiresAt - assertion.issuedAt)) {
			throw makeTimeMismatchException(`Assertion is not valid at ${validAt}, being issued at ${assertion.expiresAt} and expiring at ${assertion.expiresAt}.`);
		}
		return {
			sessionId: assertion.sessionId,
			relyingPartyDomain: assertion.rpDomain,
			user: userInfo.address
		};
	}

	/**
	 * This function does verification of a single certificate with known
	 * signing key.
	 * If your task requires verification starting with principal's MailerId,
	 * use verifyPubKey function that also accepts and checks MailerId
	 * certificates chain.
	 * @param keyCert is a certificate that should be checked
	 * @param principalAddress is an expected principal's address in a given
	 * certificate. Exception is thrown, if certificate does not match this
	 * expectation.
	 * @param signingKey is a public key, with which given certificate is
	 * validated cryptographically. Exception is thrown, if crypto-verification
	 * fails.
	 * @param validAt is an epoch time moment (in second), for which verification
	 * should be done.
	 * @param arrFactory is an optional array factory.
	 * @return a key from a given certificate.
	 */
	export function verifyKeyCert(keyCert: SignedLoad,
			principalAddress: string, signingKey: Key, validAt: number,
			arrFactory?: arrays.Factory): JsonKey {
		let sigBytes: Uint8Array;
		let loadBytes: Uint8Array;
		try {
			sigBytes = base64.open(keyCert.sig);
			loadBytes = base64.open(keyCert.load);
		} catch (err) {
			throw makeMalformedCertsException(`Cannot read certificate`, err);
		}
		if (!signing.verify(sigBytes, loadBytes, signingKey.k, arrFactory)) {
			throw makeSigVerifException(`Key certificate fails verification.`);
		}
		let cert: KeyCert;
		try {
			cert = getKeyCert(keyCert);
		} catch (err) {
			throw makeMalformedCertsException(`Cannot read certificate`, err);
		}
		if (cert.cert.principal.address !== principalAddress) {
			throw makeCertsMismatchException(`Key certificate is for user ${cert.cert.principal.address}, while expected address is ${principalAddress}`);
		}
		if ((cert.expiresAt - cert.issuedAt) <= minValidityPeriodForCert) {
			if (Math.abs(cert.issuedAt - validAt) > minValidityPeriodForCert) {
				throw makeTimeMismatchException(`Certificate is not valid at ${validAt} being issued at ${cert.issuedAt} and applying minimum validity period window of ${minValidityPeriodForCert} seconds`);
			}
		} else {
			if ((validAt < (cert.issuedAt - minValidityPeriodForCert))
			|| (cert.expiresAt <= validAt)) {
				throw makeTimeMismatchException(`Certificate is not valid at ${validAt} being issued at ${cert.issuedAt} and expiring at ${cert.expiresAt}`);
			}
		}
		return cert.cert.publicKey;
	}

	/**
	 * @param pubKeyCert certificate with a public key, that needs to be
	 * verified.
	 * @param principalAddress is an expected principal's address in both key
	 * certificate, and in MailerId certificate chain. Exception is thrown,
	 * if certificate does not match this expectation.
	 * @param certChain is MailerId certificate chain for named principal.
	 * @param rootAddr is MailerId root's domain.
	 * @param validAt is an epoch time moment (in second), for which key
	 * certificate verification should be done.
	 * @param arrFactory is an optional array factory.
	 * @return a key from a given certificate.
	 */
	export function verifyPubKey(pubKeyCert: SignedLoad,
			principalAddress: string, certChain: CertsChain, rootAddr: string,
			validAt: number, arrFactory?: arrays.Factory): JsonKey {
		// time moment, for which user's certificate chain must be valid
		let chainValidityMoment: number;
		try {
			chainValidityMoment = getKeyCert(pubKeyCert).issuedAt;
		} catch (err) {
			throw makeMalformedCertsException(`Cannot read certificate`, err);			
		}
		
		const principalInfo = verifyChainAndGetUserKey(
			certChain, rootAddr, chainValidityMoment, arrFactory);
		if (principalInfo.address !== principalAddress) { throw makeCertsMismatchException(`MailerId certificate chain is for user ${principalInfo.address}, while expected address is ${principalAddress}`); }
		
		return verifyKeyCert(pubKeyCert, principalAddress,
			principalInfo.pkey, validAt, arrFactory);
	}

}
Object.freeze(relyingParty);


function correlateSKeyWithItsCert(skey: Key, cert: KeyCert): void {
	const pkey = keyFromJson(cert.cert.publicKey, skey.use,
			signing.JWK_ALG_NAME, signing.PUBLIC_KEY_LENGTH);
	if ( ! ((pkey.kid === skey.kid)
	&& (pkey.use === skey.use)
	&& (pkey.alg === skey.alg)
	&& compareVectors(signing.extract_pkey(skey.k), pkey.k))) {
		throw new Error("Key does not correspond to certificate.");
	}
}

export module user {

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
		 * @return signed assertion with a given sessionId string.
		 */
		generateAssertionFor(
			rpDomain: string, sessionId: string, validFor?: number
		): SignedLoad;
		/**
		 * @param pkey
		 * @param validFor
		 * @return signed certificate with a given public key.
		 */
		certifyPublicKey(pkey: JsonKey, validFor: number): SignedLoad;
		/**
		 * Makes this AssertionSigner not usable by wiping its secret key.
		 */
		destroy(): void;
	}

	export const KID_BYTES_LENGTH = 9;

	export const MAX_SIG_VALIDITY = 30*60;

	export function generateSigningKeyPair(random: GetRandom,
			arrFactory?: arrays.Factory): Keypair {
		return genSignKeyPair(KEY_USE.SIGN, KID_BYTES_LENGTH,
				random, arrFactory);
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
	export function makeMailerIdSigner(signKey: Key,
			userCert: SignedLoad, provCert: SignedLoad,
			assertionValidity = user.MAX_SIG_VALIDITY,
			arrFactory?: arrays.Factory): MailerIdSigner {
		const certificate = getKeyCert(userCert);
		if (signKey.use !== KEY_USE.SIGN) { throw new Error(
				`Given key ${signKey.kid} has incorrect use: ${signKey.use}`); }
		correlateSKeyWithItsCert(signKey, certificate);
		if (('number' !== typeof assertionValidity) || (assertionValidity < 1) ||
				(assertionValidity > user.MAX_SIG_VALIDITY)) {
			throw new Error(`Given assertion validity is illegal: ${assertionValidity}`);
		}
		if (!arrFactory) {
			arrFactory = arrays.makeFactory();
		}
		const signer: MailerIdSigner = {
			address: certificate.cert.principal.address,
			userCert: userCert,
			providerCert: provCert,
			issuer: certificate.issuer,
			certExpiresAt: certificate.expiresAt,
			validityPeriod: assertionValidity,
			generateAssertionFor: (
				rpDomain: string, sessionId: string, validFor?: number
			): SignedLoad => {
				if (!signKey) { throw new Error("Signer is already destroyed."); }
				if ('number' === typeof validFor) {
					if (validFor > assertionValidity) {
						validFor = assertionValidity;
					} else if (validFor < 0) {
						new Error(`Given certificate validity is illegal: ${validFor}`);
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
			certifyPublicKey: (pkey: JsonKey, validFor: number):
					SignedLoad => {
				if (!signKey) { throw new Error("Signer is already destroyed."); }
				if (validFor < 0) { new Error(`Given certificate validity is illegal: ${validFor}`); }
				const now = Math.floor(Date.now()/1000);
				if (now >= certificate.expiresAt) { throw new Error(`Signing key has already expiried at ${certificate.expiresAt} and now is ${now}`); }
				return makeCert(
					pkey, certificate.cert.principal.address,
					certificate.cert.principal.address,
					now, now+validFor, signKey, arrFactory
				);
			},
			destroy: (): void => {
				if (!signKey) { return; }
				arrays.wipe(signKey.k);
				signKey = (undefined as any);
				arrFactory!.wipeRecycled();
				arrFactory = (undefined as any);
			}
		};
		Object.freeze(signer);
		return signer;
	}

}
Object.freeze(user);

Object.freeze(exports);