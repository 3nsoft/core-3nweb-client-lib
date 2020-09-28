/*
 Copyright (C) 2015 - 2017, 2020 3NSoft Inc.
 
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

/**
 * This defines a base class for some service's client that logs in with
 * Public Key Login process and uses respectively authenticated session.
 */

import { makeException, NetClient } from './request-utils';
import { HTTPException } from '../lib-common/exceptions/http';
import { base64 } from '../lib-common/buffer-utils';
import { secret_box as sbox, box, nonce as nMod, arrays, compareVectors } from 'ecma-nacl';
import { SessionEncryptor, makeSessionEncryptor } from '../lib-common/session-encryptor';
import * as loginApi from '../lib-common/service-api/pub-key-login';
import { parse as parseUrl } from 'url';

export interface ICalcDHSharedKey {
	(): Uint8Array;
}

export interface LoginCompletion {
	keyParams: any;
	serverPKey: Uint8Array;
	complete(dhsharedKeyCalc: ICalcDHSharedKey): Promise<void>;
}

export interface PKLoginException extends HTTPException {
	serverNotTrusted: boolean;
	cryptoResponseNotAccepted: boolean;
	unknownUser: boolean;
}

export abstract class ServiceUser {
	
	sessionId: string = (undefined as any);
	
	private uri: string;
	get serviceURI(): string {
		return this.uri;
	}
	set serviceURI(uriString: string) {
		const u = parseUrl(uriString);
		if (u.protocol !== 'https:') {
			throw new Error("Url protocol must be https.");
		}
		if (!u.host) {
			throw new Error("Host name is missing.");
		}
		this.uri = `${u.protocol}//${u.host}${u.pathname}`;
		if (!this.uri.endsWith('/')) {
			this.uri += '/';
		}
	}
	
	private loginUrlPart: string;
	private logoutUrlEnd: string;
	private redirectedFrom: string = (undefined as any);
	private canBeRedirected: boolean;

	encryptor: SessionEncryptor = (undefined as any);
	private encChallenge: Uint8Array = (undefined as any);
	private serverPubKey: Uint8Array = (undefined as any);
	private serverVerificationBytes: Uint8Array = (undefined as any);
	
	/**
	 * This field will contain key derivation parameters from server for a
	 * default key. For non-default keys this field stays undefined.
	 */
	private keyDerivationParams: any = undefined;

	constructor(
		public readonly userId: string,
		opts: { login: string; logout: string; canBeRedirected?: boolean; },
		protected readonly net: NetClient
	) {
		this.loginUrlPart = opts.login;
		if ((this.loginUrlPart.length > 0) &&
				(this.loginUrlPart[this.loginUrlPart.length-1] !== '/')) {
			this.loginUrlPart += '/';
		}
		this.logoutUrlEnd = opts.logout;
		this.canBeRedirected = !!opts.canBeRedirected;
	}
	
	private async startSession(keyId: string|undefined): Promise<void> {
		const reqData: loginApi.start.Request = {
			userId: this.userId,
		};
		if (keyId !== undefined) {
			reqData.kid = keyId;
		}
		const rep = await this.net.doJsonRequest<loginApi.start.Reply>({
			url: `${this.serviceURI}${this.loginUrlPart}${loginApi.start.URL_END}`,
			method: 'POST',
			responseType: 'json'
		}, reqData);
		if (rep.status == loginApi.start.SC.ok) {
			// set sessionid
			if (!rep.data || (typeof rep.data.sessionId !== 'string')) {
				throw makeException(rep, 'Malformed reply to starting session');
			}
			this.sessionId = rep.data.sessionId;
			// set server public key
			if (typeof rep.data.serverPubKey !== 'string') {
				throw makeException(rep, 'Malformed reply: serverPubKey string is missing.');
			}
			try {
				this.serverPubKey = base64.open(rep.data.serverPubKey);
				if (this.serverPubKey.length !== box.KEY_LENGTH) {
					throw makeException(rep,
						'Malformed reply: server\'s key has a wrong size.');
				}
			} catch (err) {
				throw makeException(rep, `Malformed reply: bad serverPubKey string. Error: ${('string' === typeof err)? err : err.message}`);
			}
			// get encrypted session key from json body
			if (typeof rep.data.sessionKey !== 'string') {
				throw makeException(rep, 'Malformed reply: sessionKey string is missing.');
			}
			try {
				this.encChallenge = base64.open(rep.data.sessionKey);
				if (this.encChallenge.length !==
						(sbox.NONCE_LENGTH + sbox.KEY_LENGTH)) {
					throw makeException(rep, `Malformed reply: byte chunk with session key has a wrong size.`);
				}
			} catch (err) {
				throw makeException(rep, `Malformed reply: bad sessionKey string. Error: ${(typeof err === 'string') ? err : err.message}`);
			}
			// get key derivation parameters for a default key
			if (!keyId) {
				if (typeof rep.data.keyDerivParams !== 'object') {
					throw makeException(rep, `Malformed reply: keyDerivParams string is missing.`);
				}
				this.keyDerivationParams = rep.data.keyDerivParams;
			}
		} else if (this.canBeRedirected &&
				(rep.status === loginApi.start.SC.redirect)) {
			const rd: loginApi.start.RedirectReply = <any> rep.data;
			if (!rd || ('string' !== typeof rd.redirect)) {
				throw makeException(rep, 'Malformed reply');
			}
			// refuse second redirect
			if (this.redirectedFrom !== undefined) {
				throw makeException(rep,
					`Redirected too many times. First redirect was from ${this.redirectedFrom} to ${this.serviceURI}. Second and forbidden redirect is to ${rd.redirect}`);
			}
			// set params
			this.redirectedFrom = this.serviceURI;
			this.serviceURI = rd.redirect;
			// start redirect call
			return this.startSession(keyId);
		} else if (rep.status === loginApi.start.SC.unknownUser) {
			const exc = <PKLoginException> makeException(rep);
			exc.unknownUser = true;
			throw exc;
		} else {
			throw makeException(rep, 'Unexpected status');
		}
	}
	
	private openSessionKey(dhsharedKeyCalc: ICalcDHSharedKey): void {
		const dhsharedKey = dhsharedKeyCalc();
		const nonce = new Uint8Array(
			this.encChallenge.subarray(0, sbox.NONCE_LENGTH));
		const sessionKey = new Uint8Array(
			this.encChallenge.subarray(sbox.NONCE_LENGTH));
		// encrypted challenge has session key packaged into WN format, with
		// poly part cut out. Therefore, usual open method will not do as it
		// does poly check. We should recall that cipher is a stream with data
		// xor-ed into it. Encrypting zeros gives us stream bytes, which can
		// be xor-ed into the data part of challenge bytes to produce a key.
		const zeros = new Uint8Array(sbox.KEY_LENGTH);
		let streamBytes = sbox.pack(zeros, nonce, dhsharedKey);
		streamBytes = streamBytes.subarray(streamBytes.length - sbox.KEY_LENGTH);
		for (let i=0; i < sbox.KEY_LENGTH; i+=1) {
			sessionKey[i] ^= streamBytes[i];
		}
		// since there was no poly, we are not sure, if we are talking to server
		// that knows our public key. Server shall give us these bytes, and we
		// should prepare ours for comparison.
		this.serverVerificationBytes = sbox.pack(sessionKey, nonce, dhsharedKey);
		this.serverVerificationBytes =
			this.serverVerificationBytes.subarray(0, sbox.POLY_LENGTH);
		nMod.advanceOddly(nonce);
		this.encryptor = makeSessionEncryptor(sessionKey, nonce);
		// encrypt session key for completion of login exchange
		this.encChallenge = this.encryptor.pack(sessionKey);
		// cleanup arrays
		arrays.wipe(dhsharedKey, nonce, sessionKey);
	}
	
	private async completeLoginExchange(): Promise<void> {
		const rep = await this.net.doBinaryRequest<Uint8Array>({
			url: `${this.serviceURI}${this.loginUrlPart}${loginApi.complete.URL_END}`,
			method: 'POST',
			sessionId: this.sessionId,
			responseType: 'arraybuffer'
		}, this.encChallenge);
		this.encChallenge = (undefined as any);
		if (rep.status === loginApi.complete.SC.ok) {
			// compare bytes to check, if server can be trusted
			if (compareVectors(
					rep.data, this.serverVerificationBytes)) {
				this.serverVerificationBytes = (undefined as any);
			} else {
				const exc = <PKLoginException> makeException(rep);
				exc.serverNotTrusted = true;
				throw exc;
			}
		} else if (rep.status === loginApi.complete.SC.authFailed) {
				const exc = <PKLoginException> makeException(rep);
				exc.cryptoResponseNotAccepted = true;
				throw exc;
		} else {
			throw makeException(rep, 'Unexpected status');
		}
	}
	
	/**
	 * This method starts login as a two-step process.
	 * In particular, it does a first call, that does not need keys, producing
	 * a function, that will take shared key calculator, and will complete
	 * second phase of the login.
	 * This method returns a promise, resolvable to an object with a function,
	 * that performs second and last phase of the login. 
	 * @param keyId is a key id of a key that should be used in the login.
	 * Undefined value means that a default key should be used.
	 */
	async login(keyId: string|undefined): Promise<LoginCompletion> {
		await this.startSession(keyId);
		const thisPKL = this;
		async function complete(dhsharedKeyCalc: ICalcDHSharedKey) {
			thisPKL.openSessionKey(dhsharedKeyCalc)
			await thisPKL.completeLoginExchange();
		};
		return {
			keyParams: this.keyDerivationParams,
			serverPKey: this.serverPubKey,
			complete: complete
		};
	}
	
	/**
	 * This method closes current session.
	 * @return a promise for request completion.
	 */
	async logout(): Promise<void> {
		const rep = await this.net.doBodylessRequest<void>({
			url: `${this.serviceURI}${this.logoutUrlEnd}`,
			method: 'POST',
			sessionId: this.sessionId
		})
		if (rep.status !== 200) {
			throw makeException(rep, 'Unexpected status');
		}
		this.sessionId = (undefined as any);
		this.encryptor.destroy();
		this.encryptor = (undefined as any);
	}
	
}

Object.freeze(exports);