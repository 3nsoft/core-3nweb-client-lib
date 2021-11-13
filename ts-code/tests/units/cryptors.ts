/*
 Copyright (C) 2020 3NSoft Inc.
 
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

import { itCond, beforeAllWithTimeoutLog, afterAllCond } from '../libs-for-tests/jasmine-utils';
import { box, scrypt } from 'ecma-nacl';
import { bytesSync as randomBytes } from '../../lib-common/random-node';
import { bytesEqual } from '../libs-for-tests/bytes-equal';
import { Cryptor, makeCryptor, makeInProcessWasmCryptor, makeInWorkerCryptor, makeInWorkerWasmCryptor, makeInProcessCryptor } from '../../lib-client/cryptor/cryptor';

const sk1 = randomBytes(box.KEY_LENGTH);
const sk2 = randomBytes(box.KEY_LENGTH);
const pk1 = box.generate_pubkey(sk1);
const dhshare = box.calc_dhshared_key(pk1, sk2);
const logN = 17;
const r = 3;
const p = 1;
const pass = randomBytes(16);
const salt = randomBytes(32);

function cryptorTests(makeCryptor: makeCryptor): void {

	let cryptor: Cryptor;
	let closeCryptor: () => Promise<void>;

	beforeAllWithTimeoutLog(async () => {
		({ cryptor, close: closeCryptor} = makeCryptor(
			async (err) => {
				fail(err);
			},
			async (msg, err) => {
				fail(err ? err : msg);
			}
		));
	});

	afterAllCond(() => closeCryptor());

	itCond(`box.generate_pubkey`, async () => {
		const pkey = await cryptor.box.generate_pubkey(sk1);
		expect(bytesEqual(pkey, pk1)).toBe(true);
	});

	itCond(`box.calc_dhshared_key`, async () => {
		const dhsharedKey = await cryptor.box.calc_dhshared_key(pk1, sk2);
		expect(bytesEqual(dhsharedKey, dhshare)).toBe(true);
	});

	itCond(`scrypt`, async () => {
		const hashExpected = scrypt(pass, salt, logN, r, p, box.KEY_LENGTH, noop);
		const hash = await cryptor.scrypt(
			pass, salt, logN, r, p, box.KEY_LENGTH, noop
		);
		expect(bytesEqual(hash, hashExpected)).toBe(true);
	}, 60000);

}

function noop() {}

describe('Cryptor, JS in process,', () => {

	cryptorTests(makeInProcessCryptor);

});

describe('Cryptor, WASM in process,', () => {

	cryptorTests(makeInProcessWasmCryptor);

});

describe('Cryptor, JS in worker,', () => {

	cryptorTests(makeInWorkerCryptor);

});

describe('Cryptor, WASM in worker,', () => {

	cryptorTests(makeInWorkerWasmCryptor);

});