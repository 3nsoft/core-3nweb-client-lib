/*
 Copyright (C) 2025 3NSoft Inc.
 
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

declare namespace web3n.keys {

	interface JsonKeyShort {
		/**
		 * This is a base64 representation of key's bytes.
		 */
		k: string;
		/**
		 * This is key's id.
		 */
		kid: string;
	}

	interface JsonKey extends JsonKeyShort {
		/**
		 * This field is indicates application's use of this key, for example,
		 * "private-mail-key". Notice that it has noting to do with crypto 
		 * primitives, and everything to do with how key should be used by
		 *  applications, that should check this field, so as to guard against
		 *  miss-use of key material. Such strictness makes key reuse (bad security
		 *  design) difficult. 
		 */
		use: string;
		/**
		 * This field indicates which crypto-box high level function should be used
		 * with this key, for example, "NaCl-xsp-box". Notice that, unlike initial
		 * JWK standard, alg is not for naming crypto primitive, because you,
		 * developer, should use complete functionality, like that provided by NaCl,
		 * and you should not be dealing with crypto primitives. Crypto primitives
		 * are for libs, that should be written by cryptographers. If cryptographer
		 * gives you only primitives, it is the same as car dealer giving you parts
		 * for the car instead of an actual car. Your would call dealer's bullshit,
		 * and you must call cryptographer's one as well. They, cryptographer, in a
		 * 2nd decade of the 21st centure have no excuse to give us, developers,
		 * incomplete libs with mere crypto primitives, which hurt, when assembled
		 * incorrectly.
		 */
		alg: string;
	}

	interface Key {
		/**
		 * This is key's bytes.
		 */
		k: Uint8Array;
		/**
		 * This is key's id.
		 */
		kid: string;
		/**
		 * This field is indicates application's use of this key, for example,
		 * "private-mail-key". Notice that it has noting to do with crypto 
		 * primitives, and everything to do with how key should be used by
		 *  applications, that should check this field, so as to guard against
		 *  miss-use of key material. Such strictness makes key reuse (bad security
		 *  design) difficult. 
		 */
		use: string;
		/**
		 * This field indicates which crypto-box high level function should be used
		 * with this key, for example, "NaCl-xsp-box". Notice that, unlike initial
		 * JWK standard, alg is not for naming crypto primitive, because you,
		 * developer, should use complete functionality, like that provided by NaCl,
		 * and you should not be dealing with crypto primitives. Crypto primitives
		 * are for libs, that should be written by cryptographers. If cryptographer
		 * gives you only primitives, it is the same as car dealer giving you parts
		 * for the car instead of an actual car. Your would call dealer's bullshit,
		 * and you must call cryptographer's one as well. They, cryptographer, in a
		 * 2nd decade of the 21st centure have no excuse to give us, developers,
		 * incomplete libs with mere crypto primitives, which hurt, when assembled
		 * incorrectly.
		 */
		alg: string;
	}

	interface SignedLoad {
		/**
		 * This is a function/algorithm, used to make signature.
		 */
		alg: string;
		/**
		 * This is an id of a key that did the signature.
		 */
		kid: string;
		/**
		 * This is signature bytes, packed into base64 string.
		 */
		sig: string;
		/**
		 * This is bytes (packed into base64 string), on which signature was done.
		 */
		load: string;
	}

	interface KeyCert {
		cert: {
			publicKey: JsonKey;
			principal: { address: string };
		};
		issuer: string;
		issuedAt: number;
		expiresAt: number;
	}

	interface Keyrings {

		introKeyOnASMailServer: IntroKeyOnASMailServer;

		getCorrespondentKeys: (
			correspondentAddr: string
		) => Promise<CorrespondentKeysInfo|undefined>;

	}

	interface IntroKeyOnASMailServer {

		/**
		 * Returns introductory key certificates chain that should be published on
		 * ASMail server, and null, if there should be nothing on the server.
		 */
		getCurrent(): Promise<PKeyCertChain|null>;

		remove(): Promise<void>;

		makeAndPublishNew(): Promise<PKeyCertChain>;

	}

	interface PKeyCertChain {
		pkeyCert: keys.SignedLoad;
		userCert: keys.SignedLoad;
		provCert: keys.SignedLoad;
	}

	interface MailerIdAssertion {
		assertion: keys.SignedLoad;
		userCert: keys.SignedLoad;
		provCert: keys.SignedLoad;
	}

	interface CorrespondentKeysInfo {
		sendingPair: IntroductorySendingPairInfo|RatchetedSendingPairInfo|null;
		receptionPairs: {
			suggested: ReceptionPairInfo|null;
			inUse: ReceptionPairInfo|null;
			old: ReceptionPairInfo|null;
		};
	}

	interface IntroductorySendingPairInfo {
		type: 'intro';
		recipientKId: string;
		alg: string;
	}

	interface RatchetedSendingPairInfo {
		type: 'ratcheted';
		pids: string[];
		timestamp: number;
		alg: string;
		senderKId: string;
		recipientKId: string;
		sentMsgs?: {
			count: number;
			lastTS: number;
		};
	}

	interface ReceptionPairInfo {
		pids: string[];
		alg: string;
		recipientKId: string;
		isSenderIntroKey?: boolean,
		senderKId: string;
		receivedMsgs?: {
			counts: number[][];
			lastTS: number;
		};
		timestamp: number;
	}

}