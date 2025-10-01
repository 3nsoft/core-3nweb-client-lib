/*
 Copyright (C) 2020, 2025 3NSoft Inc.

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


declare namespace web3n.mailerid {

	interface Service {

		/**
		 * Returns MailerId/address of a current user.
		 */
		getUserId(): Promise<string>;

		/**
		 * Performs a MailerId-based login at a given url, returning session id.
		 * @param serviceUrl 
		 */
		login(serviceUrl: string): Promise<string>;

		/**
		 * Signs given payload with current identity, returning object with
		 * signature and a complete MailerId certificates' chain of a used key.
		 * @param payload 
		 */
		sign(payload: Uint8Array): Promise<MailerIdSignature>;

		/**
		 * Verifies given signature, returning true if it is ok.
		 * Since this is a check of MailerId signature, root certificate of a
		 * respective identity provider would have to be retrieved with a chance
		 * of related exceptions being thrown.
		 * @param midSignature 
		 */
		verifySignature(midSignature: MailerIdSignature): Promise<{
			cryptoCheck: boolean;
			midProviderCheck?: MailerIdProviderCheckResult;
		}>;

	}

	interface MailerIdAssertionLoad {
		user: string;
		rpDomain: string;
		sessionId: string;
		issuedAt: number;
		expiresAt: number;
	}

	interface MailerIdSignature {
		rootMidCert: keys.SignedLoad;
		provCert: keys.SignedLoad;
		signeeCert: keys.SignedLoad;
		signature: keys.SignedLoad;
	}

	type MailerIdProviderCheckResult =
		'all-ok'
		| 'unknown-root-cert'
		| 'not-current-provider'
		| 'dns-not-set'
		| 'offline-no-check'
		| 'other-fail';

	interface MailerIdException extends RuntimeException {
		type: 'mailerid';
		algMismatch?: true;
		timeMismatch?: true;
		certsMismatch?: true;
		certMalformed?: true;
		sigVerificationFails?: true;
	}

}