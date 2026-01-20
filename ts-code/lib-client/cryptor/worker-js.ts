/*
 Copyright (C) 2020, 2026 3NSoft Inc.

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

import { parentPort } from 'worker_threads';
import { scrypt, box, secret_box as sbox, signing as sign, arrays } from 'ecma-nacl';
import { Code, Func, ReplyMsg, RequestMsg } from './cryptor-in-worker';
import { stringifyErr } from '../../lib-common/exceptions/error';
import { CryptorException } from './cryptor';
import { getStackHere } from '../../lib-common/exceptions/runtime';


if (!parentPort) {
	throw new Error(`Missing expected parentPort. Is this called within WebWorker process?`);
}

const arrFactory = arrays.makeFactory();
const wipe = arrays.wipe;

const funcs: { [key in Func]: Code; } = {

	'scrypt': args => {
		const progressCB = (n: number): void => {
			const reply: ReplyMsg = { interim: n };
			parentPort!.postMessage(reply);
		};
		const res = scrypt(
			args[0], args[1], args[2], args[3], args[4], args[5],
			progressCB, arrFactory);
		wipe(args[0]);
		return { res };
		// electron v.11.0.3 worker thread fails on memory move
		// return { res, trans: transfer(res) };
	},

	'box.calc_dhshared_key': args => {
		const res = box.calc_dhshared_key(args[0], args[1], arrFactory);
		wipe(args[0], args[1]);
		return { res };
		// electron v.11.0.3 worker thread fails on memory move
		// return { res, trans: transfer(res) };
	},
	'box.generate_pubkey': args => {
		const res = box.generate_pubkey(args[0], arrFactory);
		wipe(args[0]);
		return { res };
		// electron v.11.0.3 worker thread fails on memory move
		// return { res, trans: transfer(res) };
	},

	'sbox.open': args => {
		const res = sbox.open(args[0], args[1], args[2], arrFactory);
		wipe(args[2]);
		return { res };
		// electron v.11.0.3 worker thread fails on memory move
		// return { res, trans: transfer(res) };
	},
	'sbox.pack': args => {
		const res = sbox.pack(args[0], args[1], args[2], arrFactory);
		wipe(args[2]);
		return { res };
		// electron v.11.0.3 worker thread fails on memory move
		// return { res, trans: transfer(res) };
	},
	'sbox.formatWN.open': args => {
		const res = sbox.formatWN.open(args[0], args[1], arrFactory);
		wipe(args[1]);
		return { res };
		// electron v.11.0.3 worker thread fails on memory move
		// return { res, trans: transfer(res) };
	},
	'sbox.formatWN.pack': args => {
		const res = sbox.formatWN.pack(args[0], args[1], args[2], arrFactory);
		wipe(args[2]);
		return { res };
		// electron v.11.0.3 worker thread fails on memory move
		// return { res, trans: transfer(res) };
	},

	'sign.generate_keypair': args => {
		const pair = sign.generate_keypair(args[0], arrFactory);
		wipe(args[0]);
		return { res: pair };
		// electron v.11.0.3 worker thread fails on memory move
		// return { res: pair, trans: transfer(pair.pkey, pair.skey) };
	},
	'sign.signature': args => {
		const res = sign.signature(args[0], args[1], arrFactory);
		wipe(args[1]);
		return { res };
		// electron v.11.0.3 worker thread fails on memory move
		// return { res, trans: transfer(res) };
	},
	'sign.verify': args => {
		const ok = sign.verify(args[0], args[1], args[2], arrFactory);
		return { res: ok };
	}

};

function wrapError(err: any): CryptorException {
	const exc: CryptorException = {
		runtimeException: true,
		type: 'cryptor',
		stack: getStackHere(1)
	};
	if ((err as web3n.EncryptionException).failedCipherVerification) {
		exc.failedCipherVerification = true;
	} else {
		exc.message = `Error occured in cryptor worker thread`;
		exc.cause = stringifyErr(err);
	}
	return exc;
}

parentPort.on('message', (msg: RequestMsg) => {
	const { args, func } = msg;
	const code = funcs[func];
	if (!code) { throw new Error(`Function ${func} is unknown`); }
	try {
		const { res, trans } = code(args);
		const reply: ReplyMsg = { res };
		parentPort!.postMessage(reply, trans);
	} catch (err) {
		const reply: ReplyMsg = { err: wrapError(err) };
		parentPort!.postMessage(reply);
	}
});
