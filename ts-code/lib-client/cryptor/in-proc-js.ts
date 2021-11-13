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

import { Cryptor } from './cryptor';
import { scrypt, box, secret_box as sbox, signing as sign, arrays } from 'ecma-nacl';

function inNextTick<T>(f: () => T): Promise<T> {
	return new Promise((resolve, reject) => process.nextTick(() => {
		try {
			resolve(f());
		} catch (err) {
			reject(err);
		}
	}));
}

export function makeInProcessCryptor(): Cryptor {
	const arrFactory = arrays.makeFactory();
	return {

		scrypt: (passwd, salt, logN, r, p, dkLen, progressCB) => inNextTick(
			() => scrypt(passwd, salt, logN, r, p, dkLen, progressCB, arrFactory)),

		box: {
			calc_dhshared_key: (pk, sk) => inNextTick(
				() => box.calc_dhshared_key(pk, sk, arrFactory)),
			generate_pubkey: sk => inNextTick(
				() => box.generate_pubkey(sk, arrFactory))
		},

		sbox: {
			open: (c, n, k) => inNextTick(() => sbox.open(c, n, k, arrFactory)),
			pack: (m, n, k) => inNextTick(() => sbox.pack(m, n, k, arrFactory)),
			formatWN: {
				open: (cn, k) => inNextTick(
					() => sbox.formatWN.open(cn, k, arrFactory)),
				pack: (m, n, k) => inNextTick(
					() => sbox.formatWN.pack(m, n, k, arrFactory))
			}
		},

		signing: {
			generate_keypair: seed => inNextTick(
				() => sign.generate_keypair(seed, arrFactory)),
			signature: (m, sk) => inNextTick(
				() => sign.signature(m, sk, arrFactory)),
			verify: (sig, m, pk) => inNextTick(
				() => sign.verify(sig, m, pk, arrFactory))
		}

	};
}


Object.freeze(exports);