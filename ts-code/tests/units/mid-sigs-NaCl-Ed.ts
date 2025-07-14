/*
 Copyright (C) 2015, 2025 3NSoft Inc.
 
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

/*
 * Testing MailerId signing module.
 */

import { bytesSync as getRandom } from "../../lib-common/random-node";
import { base64, utf8 } from "../../lib-common/buffer-utils";
import { isLikeSignedLoad, keyToJson } from "../../lib-common/jwkeys";
import { deepEqual } from '../libs-for-tests/json-equal';
import { generateProviderKey, generateRootKey, IdProviderCertifier, makeIdProviderCertifier } from "../../lib-common/mailerid-sigs/id-provider";
import { CertsChain, Keypair } from "../../lib-common/mailerid-sigs";
import { generateSigningKeyPair, makeMailerIdSigner } from "../../lib-common/mailerid-sigs/user";
import { verifyAssertion, verifyChainAndGetUserKey, verifyKeyCert, verifySignature } from "../../lib-common/mailerid-sigs/relying-party";

type JsonKey = web3n.keys.JsonKey;
type SignedLoad = web3n.keys.SignedLoad;

describe(`MailerId utility library`, () => {

	const issuer = "test.co/mailerId";
	let midRoot: { cert: SignedLoad; skey: JsonKey; };
	let provider: { cert: SignedLoad; skey: JsonKey; };
	let certifier: IdProviderCertifier;
	// XXX test things with address that is not in a canonical form
	const user = "user@some.com";
	let userKeys: Keypair;
	let userKeyCert: SignedLoad;
	const rpDomain = "relying.party.domain";
	let certChain: CertsChain;

	beforeEach(() => {

		// provider's setup functions
		midRoot = generateRootKey(issuer, 90*24*60*60, getRandom);
		provider = generateProviderKey(issuer, 10*24*60*60, midRoot.skey, getRandom);
		certifier = makeIdProviderCertifier(issuer, 24*60*60, provider.skey);

		// user's provisioning its certificate, using provider's service
		// user generates its signing key
		userKeys = generateSigningKeyPair(getRandom);
		// provider certifies user's key
		userKeyCert = certifier.certify(userKeys.pkey, user, 3*60*60);
		// certs' chain
		certChain = {
			user: userKeyCert,
			prov: provider.cert,
			root: midRoot.cert
		};

	});

	it(`allows relying party to check certificates' chain from user to root`, () => {

		const nowSecs = Math.floor(Date.now()/1000);

		// relying party verifies user's certificate all way to root certificate
		const certInfo = verifyChainAndGetUserKey(certChain, issuer, nowSecs);
		expect(certInfo.address).toBe(user);
		expect(deepEqual(keyToJson(certInfo.pkey), userKeys.pkey)).toBe(true);

		// certificate can be checked for a particular moment in time
		verifyChainAndGetUserKey(certChain, issuer, nowSecs+60*60);
		expect(() => verifyChainAndGetUserKey(certChain, issuer, nowSecs+4*60*60)).toThrow();

	});

	function checkAssertion(rpDomain: string, sessionId: string, assertion: SignedLoad): void {

		const nowSecs = Math.floor(Date.now()/1000);

		// relying party verifies an assertion
		const assertInfo = verifyAssertion(assertion, certChain, issuer, nowSecs);
		expect(assertInfo.user).toBe(user);
		expect(assertInfo.sessionId).toBe(sessionId);
		expect(assertInfo.relyingPartyDomain).toBe(rpDomain);
		// assertion can be checked for a particular moment in time
		verifyAssertion(assertion, certChain, issuer, nowSecs+1);
		expect(() => verifyAssertion(assertion, certChain, issuer, nowSecs+60*60)).toThrow();
	}

	it(`allows to create and to check assertions, used for logins`, () => {

		const signer = makeMailerIdSigner(userKeys.skey, userKeyCert, provider.cert, 20*60);

		// service (relying party) generates session id
		const sessionId = base64.pack(getRandom(24));

		// user creates signed assertion with given session id inside
		let assertion = signer.generateAssertionFor(rpDomain, sessionId, 10*60);
		checkAssertion(rpDomain, sessionId, assertion);

		assertion = signer.generateAssertionFor(rpDomain, sessionId);
		checkAssertion(rpDomain, sessionId, assertion);

	});
	
	function checkKeyCert(certForPKey: SignedLoad, pkey: JsonKey): void {

		const nowSecs = Math.floor(Date.now()/1000);

		const certInfo = verifyChainAndGetUserKey(certChain, issuer, nowSecs);

		// peer (relying party) verifies signed key
		const pkeyFromCert = verifyKeyCert(certForPKey, certInfo.address, certInfo.pkey, nowSecs);
		expect(deepEqual(pkeyFromCert, pkey));
		// certificate can be checked for a particular moment in time
		verifyKeyCert(certForPKey, certInfo.address, certInfo.pkey, nowSecs+9*60);
		expect(() => verifyKeyCert(
			certForPKey, certInfo.address, certInfo.pkey, nowSecs+(30*24*60*60)+(20*60)
		)).toThrow();
	}

	it(`signs keys, and checks resulting certificates`, () => {

		const signer = makeMailerIdSigner(userKeys.skey, userKeyCert, provider.cert, 20*60);

		// user signes its public key
		const pkey: JsonKey = {
			use: 'some use',
			alg: 'some NaCl alg',
			k: 'RkYr4Rf48Z5NOcHEi6mvtiCVFO4bBZsy9LyHQCFjyuw=',
			kid: '12345'
		}
		const certForPKey = signer.certifyPublicKey(pkey, 30*24*60*60);
		checkKeyCert(certForPKey, pkey);
		
	});

	it(`makes signatures and check them`, () => {

		const signer = makeMailerIdSigner(userKeys.skey, userKeyCert, provider.cert);
		const payload = getRandom(200);

		const sig = signer.sign(payload);
		expect(isLikeSignedLoad(sig.signature));
		expect(sig.signature.load).toBe(base64.pack(payload));
		expect(deepEqual(sig.signeeCert, userKeyCert)).toBeTrue();
		expect(sig.signeeCert).not.toBe(userKeyCert);
		expect(deepEqual(sig.provCert, provider.cert)).toBeTrue();
		expect(sig.provCert).not.toBe(provider.cert);

		expect(
			verifySignature(midRoot.cert, sig.provCert, sig.signeeCert, sig.signature)
		).toBeTrue();
		sig.signature.load = sig.signature.load.substring(4);
		expect(
			verifySignature(midRoot.cert, sig.provCert, sig.signeeCert, sig.signature)
		).toBeFalse();
	});

});
