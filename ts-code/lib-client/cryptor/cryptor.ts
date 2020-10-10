/*
 Copyright (C) 2016 - 2020 3NSoft Inc.

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

import { signing } from 'ecma-nacl';
import { LogWarning } from '../logging/log-to-file';
import { AsyncSBoxCryptor } from 'xsp-files';
import { makeInProcessCryptor } from './cryptor-in-proc';

export interface Cryptor {
	
	scrypt(passwd: Uint8Array, salt: Uint8Array, logN: number, r: number,
		p: number, dkLen: number, progressCB: (p: number) => void):
		Promise<Uint8Array>;
	
	sbox: AsyncSBoxCryptor;
	
	box: {
		generate_pubkey(sk: Uint8Array): Promise<Uint8Array>;
		calc_dhshared_key(pk: Uint8Array, sk: Uint8Array): Promise<Uint8Array>;
	}
	
	signing: {
		signature(m: Uint8Array, sk: Uint8Array): Promise<Uint8Array>;
		verify(sig: Uint8Array, m: Uint8Array, pk: Uint8Array): Promise<boolean>;
		generate_keypair(seed: Uint8Array): Promise<signing.Keypair>;
	}
	
}

const impl = (function choosingImplementation(): typeof makeCryptor {
	try {
		const { makeInWorkerCryptor } = require('./cryptor-in-worker');
		return makeInWorkerCryptor;
	} catch (err) {
		return () => ({ cryptor: makeInProcessCryptor(), close: () => {} });
	}
})();

export function makeCryptor(
	logWarning: LogWarning, maxThreads?: number
): { cryptor: Cryptor; close: () => void; } {
	return impl(logWarning, maxThreads);
}

type RuntimeException = web3n.RuntimeException;

export interface CryptorException extends RuntimeException {
	type: 'cryptor';
	failedCipherVerification?: true;
}

Object.freeze(exports);