/*
 Copyright (C) 2021 - 2022 3NSoft Inc.

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
import { signing } from 'ecma-nacl';
import { startWasmFrom } from './wasm-mp1-modules';
import { readFileSync } from 'fs';
import { join } from 'path';
import { ProtoType } from '../protobuf-type';
import { cryptor as pb } from '../../protos/cryptor.proto';
import { defer, Deferred } from '../../lib-common/processes/deferred';
import { assert } from '../../lib-common/assert';
import { errWithCause } from '../../lib-common/exceptions/error';
import { ExecCounter } from './cryptor-work-labels';

function wasmBytes(): Buffer {
	// There is a bug with electrons 12, 13, that doesn't let
	// worker_thread read this file from asar pack, even though main thread
	// makes call from here.
	// Therefore, in case this runs from asar pack, we should switch to
	// unpacked in path that is given to worker thread.
	// Of course, asarUnpack should be used in electron-builder.
	const asarInd = __dirname.indexOf('app.asar');
	const dirWithThis = ((asarInd < 0) ?
		__dirname : `${__dirname.substring(0, asarInd+8)}.unpacked${
			__dirname.substring(asarInd+8)}`
	);
	const wasmPath = join(dirWithThis, 'cryptor.wasm');
	try {
		return readFileSync(wasmPath);
	} catch (err) {
		// chances are that error is due to wasm file not being packaged, so, we
		// look for module with base64 form in a module, that must've been packed
		const str = require('./cryptor-wasm.js').wasm;
		return Buffer.from(str, 'base64');
	}
}

interface WasmScryptRequest {
	func: 1;
	scryptArgs: {
		passwd: Uint8Array;
		salt: Uint8Array;
		logN: number;
		r: number;
		p: number;
		dkLen: number;
	};
}

interface WasmBinArgsRequest {
	func: 2|3|4|5|6|7|8|9|10;
	byteArgs: ByteArg[];
}

interface ByteArg {
	val: Uint8Array;
}

function toArgs(...args: Uint8Array[]): ByteArg[] {
	return args.map(val => ({ val }));
}

type WasmRequest = WasmScryptRequest | WasmBinArgsRequest;

interface WasmReply {
	res?: ByteArg;
	interim?: ByteArg;
	err?: ReplyError;
}

interface ReplyError {
	condition: 'cipher-verification' | 'signature-verification' |
		'configuration-error' | 'message-passing-error';
	message: string;
}

function toLocalErr(
	replyErr: ReplyError
): Error|web3n.EncryptionException {
	if (replyErr.condition === 'cipher-verification') {
		return { failedCipherVerification: true };
	} else if (replyErr.condition === 'signature-verification') {
		return { failedSignatureVerification: true };
	} else {
		return new Error(
			`WASM cryptor ${replyErr.condition}: ${replyErr.message}`);
	}
}

const reqType = ProtoType.for<WasmRequest>(pb.Request);
const replyType = ProtoType.for<WasmReply>(pb.Reply);

const boolValType = ProtoType.for<{ val: boolean; }>(pb.BoolVal);
const kpairType = ProtoType.for<signing.Keypair>(pb.Keypair);

export function makeInProcessWasmCryptor(): Cryptor {

	const wasmInstance = startWasmFrom(wasmBytes());

	let deferred: Deferred<Uint8Array>|undefined = undefined;
	let interimSink: ((bytes: Uint8Array) => void)|undefined = undefined;
	const execCounter = new ExecCounter(() => (deferred ? 0 : 1));

	async function call(
		req: WasmRequest, interim?: (m: Uint8Array) => void
	): Promise<Uint8Array> {

		// In LiquidCore on iOS call was able to get before completion of
		// previous call, therefore, the following await loop is needed.
		while (!!deferred) {
			try {
				await deferred.promise;
			} catch (err) {}
		}
		
		deferred = defer();
		if (interim) {
			interimSink = interim;
		}
		process.nextTick(() => {
			try {
				wasmInstance.sendMsgIntoWASM(reqType.pack(req));
			} catch (err) {
				deferred?.reject(err);
			}
		});
		return deferred.promise;
	}

	wasmInstance.setMsgListener(msg => {
		assert(!!deferred,
			`Deferred is expected to be available for this output from wasm`);
		try {
			const reply = replyType.unpack(msg as Buffer);
			if (reply.res) {
				deferred!.resolve(reply.res.val);
				deferred = undefined;
				interimSink = undefined;
			} else if (reply.err) {
				deferred!.reject(errWithCause(
					toLocalErr(reply.err), `Error in cryptor`));
				deferred = undefined;
				interimSink = undefined;
			} else if (reply.interim) {
				interimSink!(reply.interim.val);
			}
		} catch (err) {
			deferred!.reject(err);
		}
	});

	return {

		scrypt: (passwd, salt, logN, r, p, dkLen, progressCB) => call({
				func: 1,
				scryptArgs: { passwd, salt, logN, r, p, dkLen }
			},
			bytes => progressCB(bytes[0])
		),

		box: {
			calc_dhshared_key: (pk, sk) => call({
				func: 2,
				byteArgs: toArgs( pk, sk )
			}),
			generate_pubkey: (sk) => call({
				func: 3,
				byteArgs: toArgs( sk )
			})
		},

		sbox: {
			canStartUnderWorkLabel: l => execCounter.canStartUnderWorkLabel(l),
			open: (c, n, k, workLabel) => execCounter.wrapOpPromise(
				workLabel,
				call({
					func: 4,
					byteArgs: toArgs( c, n, k )
				})
			),
			pack: (m, n, k, workLabel) => execCounter.wrapOpPromise(
				workLabel,
				call({
					func: 5,
					byteArgs: toArgs( m, n, k )
				})
			),
			formatWN: {
				open: (cn, k, workLabel) => execCounter.wrapOpPromise(
					workLabel,
					call({
						func: 6,
						byteArgs: toArgs( cn, k )
					})
				),
				pack: (m, n, k, workLabel) => execCounter.wrapOpPromise(
					workLabel,
					call({
						func: 7,
						byteArgs: toArgs( m, n, k )
					})
				)
			}
		},

		signing: {
			generate_keypair: async (seed) => {
				const rep = await call({
					func: 8,
					byteArgs: toArgs( seed )
				});
				return kpairType.unpack(rep as Buffer);
			},
			signature: (m, sk) => call({
				func: 9,
				byteArgs: toArgs( m, sk )
			}),
			verify: async (sig, m, pk) => {
				const rep = await call({
					func: 10,
					byteArgs: toArgs( sig, m, pk )
				});
				return boolValType.unpack(rep as Buffer).val;
			}
		}

	};
}


Object.freeze(exports);