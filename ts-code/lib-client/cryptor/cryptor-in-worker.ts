/*
 Copyright (C) 2020 - 2021 3NSoft Inc.

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

import { Cryptor, makeCryptor } from './cryptor';
import { LogWarning, LogError } from '../logging/log-to-file';
import { Worker } from 'worker_threads';
import { cpus } from 'os';
import { Deferred, defer } from '../../lib-common/processes';
import { errWithCause } from '../../lib-common/exceptions/error';
import { dirname, join } from 'path';
import { ProtoType } from '../protobuf-loader';
import { signing } from 'ecma-nacl';
import { assert } from '../../lib-common/assert';

const MAX_IDLE_MILLIS = 60*1000;

export interface RequestMsg {
	func: Func;
	args: any[];
}

export type Func = 'scrypt' |
	'box.calc_dhshared_key' | 'box.generate_pubkey' |
	'sbox.open' | 'sbox.pack' |
	'sbox.formatWN.open' | 'sbox.formatWN.pack' |
	'sign.generate_keypair' | 'sign.signature' | 'sign.verify';

export interface ReplyMsg {
	res?: any;
	interim?: any;
	err?: any;
}

export type Code = (args: any[]) => { res: any; trans?: ArrayBuffer[] };

type WorkerImpl = 'js' | 'wasm';

const jsWorkerFName = 'worker-js.js';
const wasmWorkerFName = 'worker-wasm.js';

function workerScriptFor(impl: WorkerImpl): string {
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
	if (impl === 'js') {
		return join(dirWithThis, jsWorkerFName);
	} else if (impl === 'wasm') {
		return join(dirWithThis, wasmWorkerFName);
	} else {
		throw new Error(`Unknown worker implementation ${impl}`);
	}
}

export interface WorkerData {
	loadDir: string;
}


abstract class Workers<Rep> {

	private readonly idleWorkers: { worker: Worker; since: number; }[] = [];
	private readonly allWorkers = new Set<Worker>();
	private readonly waitingForIdle: Deferred<Worker>[] = [];
	protected readonly replySinks = new Map<Worker, {
		res: Deferred<any>; interim?: (v: any) => void;
	}>();

	private readonly maxThreads: number;
	protected isClosed = false;

	private periodicIdleClean = setInterval(() => {
		if ((this.isClosed) || (this.idleWorkers.length <= 2)) { return; }
		const toClose = this.idleWorkers.splice(0, (this.idleWorkers.length - 2));
		const now = Date.now();
		for (const { worker, since } of toClose) {
			if ((now - since) > MAX_IDLE_MILLIS) {
				this.detachWorker(worker);
			}
		}
	}, MAX_IDLE_MILLIS).unref();

	constructor(
		private readonly workerScript: string,
		private readonly logErr: LogError,
		private readonly logWarning: LogWarning,
		maxThreads: number|undefined
	) {
		this.maxThreads = Math.max(1, ((typeof maxThreads === 'number') ?
			maxThreads : cpus().length - 1));
	}

	protected async getIdleWorker(): Promise<Worker> {
		const idle = this.idleWorkers.pop();
		if (idle) { return idle.worker; }
		if (this.allWorkers.size < this.maxThreads) {
			return this.makeWorker();
		} else {
			const deferred = defer<Worker>();
			this.waitingForIdle.push(deferred);
			const worker = await deferred.promise;
			return worker;
		}
	}

	protected async doRequest<In, Out>(
		request: In, trans: ArrayBuffer[]|undefined,
		d: { res: Deferred<Out>; interim?: (v: any) => void; }
	): Promise<Out> {
		if (this.isClosed) { new Error(`Async cryptor is already closed`); }
		const worker = await this.getIdleWorker();
		this.replySinks.set(worker, d);
		if (trans) {
			worker.postMessage(request, trans);
		} else {
			worker.postMessage(request);
		}
		return d.res.promise;

	}

	protected abstract processReply(reply: Rep): ReplyMsg;

	private async makeWorker(): Promise<Worker> {
		const workerData: WorkerData = {
			loadDir: dirname(this.workerScript)
		};
		const worker = new Worker(this.workerScript, { workerData });
		this.allWorkers.add(worker);

		worker.on('message', (reply: Rep) => {
			const sink = this.replySinks.get(worker);
			if (!sink) {
				if (this.allWorkers.has(worker)) {
					this.detachWorker(worker);
					worker.terminate();
					this.logWarning(
						`Got a message from cryptor worker with no related sink`);
					this.makeWorker();
				}
				return;
			}
			const { res, interim, err } = this.processReply(reply);
			if (res !== undefined) {
				this.replySinks.delete(worker);
				this.declareIdle(worker);
				sink.res.resolve(res);
			} else if (err !== undefined) {
				this.replySinks.delete(worker);
				this.declareIdle(worker);
				sink.res.reject(err);
			} else if (interim !== undefined) {
				if (sink.interim) {
					sink.interim(interim);
				}
			} else {
				this.logWarning(`Reply message from cryptor worker has no fields`);
				this.detachWorker(worker);
				worker.terminate();
				this.makeWorker();
			}
		});
		worker.on('error', err => {
			const sink = this.replySinks.get(worker);
			if (sink) {
				this.replySinks.delete(worker);
				const errWrapped = errWithCause(
					err, `Error in cryptor worker thread`);
				this.logErr(errWrapped);
				sink.res.reject(errWrapped);
			}
			this.detachWorker(worker);
			worker.terminate();
			this.makeWorker();
		});
		worker.on('exit', err => {
			if (err && !this.isClosed) {
				this.logErr(errWithCause(err, `Worker exited with error ${err}`));
			}
		});

		const workerReady = new Promise<void>((resolve, reject) => {
			const errOnStart = (err: any) => reject(errWithCause(err,
				`Failed to start cryptor worker in thread`));
			const earlyExit = (exitCode: number) => reject(new Error(
				`Thread with worker cryptor exited early with code ${exitCode}`));
			worker.on('error', errOnStart);
			worker.on('exit', earlyExit);
			worker.once('online', () => {
				resolve();
				worker.removeListener('error', errOnStart);
				worker.removeListener('exit', earlyExit);
			});
		})
		.catch(err => {
			this.detachWorker(worker);
			throw err;
		});

		await workerReady;
		return worker;
	}

	private detachWorker(worker: Worker): void {
		this.allWorkers.delete(worker);
		this.replySinks.delete(worker);
		worker.unref();
	}

	private declareIdle(worker: Worker): void {
		const deferred = this.waitingForIdle.shift();
		if (deferred) {
			deferred.resolve(worker);
		} else {
			const since = Date.now();
			this.idleWorkers.push({ worker, since });
		}
	}

	async close(): Promise<void> {
		if (this.isClosed) { return; }
		this.isClosed = true;
		clearInterval(this.periodicIdleClean);
		const exc = new Error(`Async cryptor is closing`);
		for (const defW of this.waitingForIdle) {
			defW.reject(exc);
		}
		for (const w of this.allWorkers.values()) {
			await w.terminate();
			w.unref();
		}
		this.allWorkers.clear();
	}

}
Object.freeze(Workers.prototype);
Object.freeze(Workers);


class JsWorkers extends Workers<ReplyMsg> {

	constructor(
		logErr: LogError, logWarning: LogWarning, maxThreads: number|undefined
	) {
		super(workerScriptFor('js'), logErr, logWarning, maxThreads);
	}

	call<T>(
		func: Func, args: any[], trans?: ArrayBuffer[], interim?: (v: any) => void
	): Promise<T> {
		return this.doRequest(
			{ func, args }, trans, { res: defer<T>(), interim }
		);
	}

	protected processReply(reply: ReplyMsg): ReplyMsg {
		return reply;
	}

}
Object.freeze(JsWorkers.prototype);
Object.freeze(JsWorkers);


// XXX can we have no-copy transfer to worker?
// function transfer(...arrs: Uint8Array[]): ArrayBuffer[]|undefined {
// 	const transferLst: ArrayBuffer[] = [];
// 	for (const arr of arrs) {
// 		const buffer = arr.buffer;
// 		if (!transferLst.includes(buffer)) {
// 			transferLst.push(buffer);
// 		}
// 	}
// 	return transferLst;
// }


export const makeInWorkerCryptor: makeCryptor = (
	logErr, logWarning, maxThreads
) => {
	assert(typeof logErr === 'function');
	assert(typeof logWarning === 'function');

	const workers = new JsWorkers(logErr, logWarning, maxThreads);
	const close = workers.close.bind(workers);

	const cryptor: Cryptor = {

		scrypt: (passwd, salt, logN, r, p, dkLen, progressCB) => workers.call(
				'scrypt',
				[ passwd, salt, logN, r, p, dkLen ],
				undefined,
				progressCB),

		box: {
			calc_dhshared_key: (pk, sk) => workers.call(
				'box.calc_dhshared_key',
				[ pk, sk ]),
			generate_pubkey: (sk) => workers.call(
				'box.generate_pubkey',
				[ sk ])
		},

		sbox: {
			open: (c, n, k) => workers.call(
				'sbox.open',
				[ c, n, k ]),
			pack: (m, n, k) => workers.call(
				'sbox.pack',
				[ m, n, k ]),
			formatWN: {
				open: (cn, k) => workers.call(
					'sbox.formatWN.open',
					[ cn, k ]),
				pack: (m, n, k) => workers.call(
					'sbox.formatWN.pack',
					[ m, n, k ])
			}
		},

		signing: {
			generate_keypair: (seed) => workers.call(
				'sign.generate_keypair',
				[ seed ]),
			signature: (m, sk) => workers.call(
				'sign.signature',
				[ m, sk ]),
			verify: (sig, m, pk) => workers.call(
				'sign.verify',
				[ sig, m, pk ])
		}

	};

	return { cryptor, close };
}


class WasmWorkers extends Workers<Uint8Array> {

	private readonly reqType = makeProtobufType<WasmRequest>('Request');
	private readonly replyType = makeProtobufType<WasmReply>('Reply');

	constructor(
		logErr: LogError, logWarning: LogWarning, maxThreads: number|undefined
	) {
		super(workerScriptFor('wasm'), logErr, logWarning, maxThreads);
	}

	call(req: WasmRequest, interim?: (v: any) => void): Promise<Uint8Array> {
		const msg = this.reqType.pack(req);
		return this.doRequest(
			msg, undefined, { res: defer<Uint8Array>(), interim }
		);
	}

	protected processReply(replyBytes: Uint8Array): ReplyMsg {
		const { res, interim, err } = this.replyType.unpack(replyBytes as Buffer);
		return {
			res: res ? res.val : undefined,
			interim: interim ? interim.val : undefined,
			err: err ? toLocalErr(err) : undefined,
		}
	}

}
Object.freeze(WasmWorkers.prototype);
Object.freeze(WasmWorkers);


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

function makeProtobufType<T extends object>(type: string): ProtoType<T> {
	const protoFile = 'cryptor.proto';
	const typeName = `cryptor.${type}`;
	try {
		// make sure to copy protos with compile step (use npm script)
		return ProtoType.makeFrom(__dirname, protoFile, typeName);
	} catch (err) {
		// we won't get here if referenced  module exists, but metro packager
		// in LiqudCore needs static path require
		const fallback = require('./proto-defs');
		return ProtoType.makeFrom(__dirname, protoFile, typeName, fallback);
	}
}

export const makeInWorkerWasmCryptor: makeCryptor = (
	logErr, logWarning, maxThreads
) => {
	assert(typeof logErr === 'function');
	assert(typeof logWarning === 'function');

	const workers = new WasmWorkers(logErr, logWarning, maxThreads);
	const close = workers.close.bind(workers);

	const boolValType = makeProtobufType<{ val: boolean; }>('BoolVal');
	const kpairType = makeProtobufType<signing.Keypair>('Keypair');

	const cryptor: Cryptor = {

		scrypt: (passwd, salt, logN, r, p, dkLen, progressCB) => workers.call({
			func: 1,
			scryptArgs: { passwd, salt, logN, r, p, dkLen }
		}, (bytes: Uint8Array) => progressCB(bytes[0])),

		box: {
			calc_dhshared_key: (pk, sk) => workers.call({
				func: 2,
				byteArgs: toArgs( pk, sk )
			}),
			generate_pubkey: (sk) => workers.call({
				func: 3,
				byteArgs: toArgs( sk )
			})
		},

		sbox: {
			open: (c, n, k) => workers.call({
				func: 4,
				byteArgs: toArgs( c, n, k )
			}),
			pack: (m, n, k) => workers.call({
				func: 5,
				byteArgs: toArgs( m, n, k )
			}),
			formatWN: {
				open: (cn, k) => workers.call({
					func: 6,
					byteArgs: toArgs( cn, k )
				}),
				pack: (m, n, k) => workers.call({
					func: 7,
					byteArgs: toArgs( m, n, k )
				})
			}
		},

		signing: {
			generate_keypair: async (seed) => {
				const rep = await workers.call({
					func: 8,
					byteArgs: toArgs( seed )
				});
				return kpairType.unpack(rep as Buffer);
			},
			signature: (m, sk) => workers.call({
				func: 9,
				byteArgs: toArgs( m, sk )
			}),
			verify: async (sig, m, pk) => {
				const rep = await workers.call({
					func: 10,
					byteArgs: toArgs( sig, m, pk )
				});
				return boolValType.unpack(rep as Buffer).val;
			}
		}

	};

	return { cryptor, close };
}


Object.freeze(exports);