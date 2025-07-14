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

import { signing, arrays } from "ecma-nacl";
import { keyFromJson, getKeyCert } from "../jwkeys";
import { utf8, base64 } from "../buffer-utils";
import { AssertionLoad, CertsChain, KEY_USE, makeMailerIdException, makeMalformedCertsException } from "./index";

type JsonKey = web3n.keys.JsonKey;
type Key = web3n.keys.Key;
type KeyCert = web3n.keys.KeyCert;
type SignedLoad = web3n.keys.SignedLoad;
type MailerIdException = web3n.mailerid.MailerIdException;

function makeTimeMismatchException(message: string): MailerIdException {
	return makeMailerIdException({ timeMismatch: true }, { message } );
}

function makeCertsMismatchException(message: string): MailerIdException {
	return makeMailerIdException({ certsMismatch: true }, { message } );
}

function makeSigVerifException(message: string): MailerIdException {
	return makeMailerIdException({ sigVerificationFails: true }, { message } );
}

const minValidityPeriodForCert = 20*60;

function verifyCertAndGetPubKey(
	signedCert: SignedLoad, use: string, validAt: number,
	arrFactory: arrays.Factory|undefined, issuer?: string, issuerPKey?: Key
): { pkey: Key; address:string; } {
	const cert = getKeyCert(signedCert);
	if ((validAt < (cert.issuedAt - minValidityPeriodForCert))
	|| (cert.expiresAt <= validAt)) {
		throw makeMailerIdException(
			{ timeMismatch: true },
			{ message: `Certificate is not valid at a given moment ${validAt}, cause it is issued at ${cert.issuedAt}, and expires at ${cert.expiresAt}` }
		);
	}
	if (issuer) {
		if (!issuerPKey) { throw new Error(`No issuer key given.`); }
		if ((cert.issuer !== issuer) || (signedCert.kid !== issuerPKey.kid)) {
			throw makeCertsMismatchException(`Certificate is not signed by issuer key.`);
		}
	}
	let pkey: Key;
	let sig: Uint8Array;
	let load: Uint8Array;
	try {
		pkey = keyFromJson(
			cert.cert.publicKey, use, signing.JWK_ALG_NAME, signing.PUBLIC_KEY_LENGTH
		);
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
export function verifyChainAndGetUserKey(
	certs: CertsChain, rootAddr: string, validAt: number, arrFactory?: arrays.Factory
): { pkey: Key; address:string; } {
	// root certificate must be valid when provider's certificate was issued
	let rootValidityMoment: number;
	try {
		rootValidityMoment = getKeyCert(certs.prov).issuedAt;
	} catch (err) {
		throw makeMalformedCertsException(`Provider's certificate is malformed`, err);
	}

	// check root and get the key
	const root = verifyCertAndGetPubKey(
		certs.root, KEY_USE.ROOT, rootValidityMoment, arrFactory
	);
	if (rootAddr !== root.address) {
		throw makeCertsMismatchException(`Root certificate address ${root.address} doesn't match expected address ${rootAddr}`);
	}

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
	if (root.address !== provider.address) {
		throw makeCertsMismatchException(`Provider's certificate address ${provider.address} doesn't match expected address ${root.address}.`);
	}
	
	// check user certificate and get the key
	return verifyCertAndGetPubKey(
		certs.user, KEY_USE.SIGN, validAt, arrFactory, provider.address, provider.pkey
	);
}

export interface AssertionInfo {
	relyingPartyDomain: string;
	sessionId: string;
	user: string;
}

export function verifyAssertion(
	midAssertion: SignedLoad, certChain: CertsChain, rootAddr: string,
	validAt: number, arrFactory?: arrays.Factory
): AssertionInfo {
	const userInfo = verifyChainAndGetUserKey(
		certChain, rootAddr, validAt, arrFactory
	);
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
		throw makeMalformedCertsException(`Assertion is for one user, while chain is for another.`);
	}
	if (!assertion.sessionId) {throw makeMalformedCertsException(
		`Assertion doesn't have session id.`); }
	// Note that assertion can be valid before issue time, to counter
	// some mis-synchronization of clocks.
	// It can be some fixed value, like minimum validity period of certs.
	if (Math.abs(validAt - assertion.issuedAt) > (assertion.expiresAt - assertion.issuedAt)) {
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
export function verifyKeyCert(
	keyCert: SignedLoad, principalAddress: string, signingKey: Key,
	validAt: number, arrFactory?: arrays.Factory
): JsonKey {
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
		if ((validAt < (cert.issuedAt - minValidityPeriodForCert)) || (cert.expiresAt <= validAt)) {
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
export function verifyPubKey(
	pubKeyCert: SignedLoad, principalAddress: string, certChain: CertsChain,
	rootAddr: string, validAt: number, arrFactory?: arrays.Factory
): JsonKey {
	// time moment, for which user's certificate chain must be valid
	let chainValidityMoment: number;
	try {
		chainValidityMoment = getKeyCert(pubKeyCert).issuedAt;
	} catch (err) {
		throw makeMalformedCertsException(`Cannot read certificate`, err);			
	}
	
	const principalInfo = verifyChainAndGetUserKey(
		certChain, rootAddr, chainValidityMoment, arrFactory
	);
	if (principalInfo.address !== principalAddress) {
		throw makeCertsMismatchException(`MailerId certificate chain is for user ${principalInfo.address}, while expected address is ${principalAddress}`);
	}
	
	return verifyKeyCert(
		pubKeyCert, principalAddress, principalInfo.pkey, validAt, arrFactory
	);
}

export function verifySignature(
	root: SignedLoad, prov: SignedLoad, user: SignedLoad, signature: SignedLoad, arrFactory?: arrays.Factory
): boolean {
	try {
		const rootAddr = getKeyCert(root).cert.principal.address;
		const validAt = getKeyCert(user).issuedAt+60;
		const signee = verifyChainAndGetUserKey({ prov, root, user }, rootAddr, validAt, arrFactory);

		const sigBytes = base64.open(signature.sig);
		const loadBytes = base64.open(signature.load);
		return signing.verify(sigBytes, loadBytes, signee.pkey.k, arrFactory);
	} catch (err) {
		return false;
	}
}
