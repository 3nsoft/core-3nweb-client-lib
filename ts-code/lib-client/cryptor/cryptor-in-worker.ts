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

import { Cryptor, CryptorException } from './cryptor';
import { LogWarning } from '../logging/log-to-file';
import { Worker, workerData, parentPort } from 'worker_threads';
import { scrypt, box, secret_box as sbox, signing as sign, arrays } from 'ecma-nacl';
import { cpus } from 'os';
import { Deferred, defer } from '../../lib-common/processes';
import { errWithCause, stringifyErr } from '../../lib-common/exceptions/error';

const WORKER_MARKER = 'crypto worker';

const MAX_IDLE_MILLIS = 60*1000;

interface RequestMsg {
	func: Func;
	args: any[];
}

type Func = 'scrypt' |
	'box.calc_dhshared_key' | 'box.generate_pubkey' |
	'sbox.open' | 'sbox.pack' |
	'sbox.formatWN.open' | 'sbox.formatWN.pack' |
	'sign.generate_keypair' | 'sign.signature' | 'sign.verify';

interface ReplyMsg {
	res?: any;
	interim?: any;
	err?: any;
}

type Code = (args: any[]) => { res: any; trans?: ArrayBuffer[] };


class Workers {

	private readonly idleWorkers: { worker: Worker; since: number; }[] = [];
	private readonly allWorkers = new Set<Worker>();
	private readonly waitingForIdle: Deferred<Worker>[] = [];
	private readonly replySinks = new Map<Worker, {
		res: Deferred<any>; interim?: (v: any) => void;
	}>();

	private readonly maxThreads: number;
	private isClosed = false;

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
		private logWarning: LogWarning,
		maxThreads: number|undefined
	) {
		this.maxThreads = Math.max(1, ((typeof maxThreads === 'number') ?
			maxThreads : cpus().length - 1));
	}

	private async getIdleWorker(): Promise<Worker> {
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

	private async makeWorker(): Promise<Worker> {
		// There is a bug with electrons 12, 13, that doesn't let
		// worker_thread read this file from asar pack, even though main thread
		// makes call from here.
		// Therefore, in case this runs from asar pack, we should switch to
		// unpacked in path that is given to worker thread.
		// Of course, asarUnpack should be used in electron-builder.
		const asarInd = __filename.indexOf('app.asar');
		const pathOfThis = ((asarInd < 0) ?
			__filename : `${__filename.substring(0, asarInd+8)}.unpacked${
				__filename.substring(asarInd+8)}`
		);

		const worker = new Worker(pathOfThis, {
			workerData: WORKER_MARKER
		});
		this.allWorkers.add(worker);

		worker.on('message', (reply: ReplyMsg) => {
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
			const { res, interim, err } = reply;
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
				sink.res.reject(errWithCause(err,
					`Error in cryptor worker thread`));
			}
			this.detachWorker(worker);
			worker.terminate();
			this.makeWorker();
		});
		worker.on('exit', err => {});

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

	async call<T>(
		func: Func, args: any[], trans?: ArrayBuffer[], interim?: (v: any) => void
	): Promise<T> {
		if (this.isClosed) { new Error(`Async cryptor is already closed`); }
		const worker = await this.getIdleWorker();
		const request: RequestMsg = { func, args };
		const res = defer<T>();
		this.replySinks.set(worker, { res, interim });
		if (trans) {
			worker.postMessage(request, trans);
		} else {
			worker.postMessage(request);
		}
		return res.promise;
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
			await w.terminate().catch(() => {});
			w.unref();
		}
		this.allWorkers.clear();
	}

}
Object.freeze(Workers.prototype);
Object.freeze(Workers);


function transfer(...arrs: Uint8Array[]): ArrayBuffer[]|undefined {
	const transferLst: ArrayBuffer[] = [];
	for (const arr of arrs) {
		const buffer = arr.buffer;
		if (!transferLst.includes(buffer)) {
			transferLst.push(buffer);
		}
	}
	return transferLst;
}


export function makeInWorkerCryptor(
	logWarning: LogWarning, maxThreads: number|undefined
): { cryptor: Cryptor; close: () => void; } {
	if (workerData === WORKER_MARKER) {
		throw new Error(`This method can't be called in crypto worker thread`);
	}

	const workers = new Workers(logWarning, maxThreads);
	const close = workers.close.bind(workers);

	const cryptor: Cryptor = {

		scrypt: (passwd, salt, logN, r, p, dkLen, progressCB) =>
			workers.call<Uint8Array>(
				'scrypt',
				[ passwd, salt, logN, r, p, dkLen ],
				undefined,
				progressCB),

		box: {
			calc_dhshared_key: (pk, sk) => workers.call<Uint8Array>(
				'box.calc_dhshared_key',
				[ pk, sk ]),
			generate_pubkey: (sk) => workers.call<Uint8Array>(
				'box.generate_pubkey',
				[ sk ])
		},

		sbox: {
			open: (c, n, k) => workers.call<Uint8Array>(
				'sbox.open',
				[ c, n, k ]),
			pack: (m, n, k) => workers.call<Uint8Array>(
				'sbox.pack',
				[ m, n, k ]),
			formatWN: {
				open: (cn, k) => workers.call<Uint8Array>(
					'sbox.formatWN.open',
					[ cn, k ]),
				pack: (m, n, k) => workers.call<Uint8Array>(
					'sbox.formatWN.pack',
					[ m, n, k ])
			}
		},

		signing: {
			generate_keypair: (seed) => workers.call<sign.Keypair>(
				'sign.generate_keypair',
				[ seed ]),
			signature: (m, sk) => workers.call<Uint8Array>(
				'sign.signature',
				[ m, sk ]),
			verify: (sig, m, pk) => workers.call<boolean>(
				'sign.verify',
				[ sig, m, pk ])
		}

	};

	return { cryptor, close };
}

if (workerData === WORKER_MARKER) {
	if (!parentPort) { throw new Error(
		`Missing expected parentPort from module`); }
	workerMain(parentPort);
}

function workerMain(port: NonNullable<typeof parentPort>): void {

	const arrFactory = arrays.makeFactory();
	const wipe = arrays.wipe;

	const funcs: { [key in Func]: Code; } = {

		'scrypt': args => {
			const progressCB = (n: number): void => {
				const reply: ReplyMsg = { interim: n };
				port.postMessage(reply);
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
			type: 'cryptor'
		};
		if ((err as web3n.EncryptionException).failedCipherVerification) {
			exc.failedCipherVerification = true;
		} else {
			exc.message = `Error occured in cryptor worker thread`;
			exc.cause = stringifyErr(err);
		}
		return exc;
	}
	
	port.on('message', (msg: RequestMsg) => {
		const { args, func } = msg;
		const code = funcs[func];
		if (!code) { throw new Error(`Function ${func} is unknown`); }
		try {
			const { res, trans } = code(args);
			const reply: ReplyMsg = { res };
			port.postMessage(reply, trans);
		} catch (err) {
			const reply: ReplyMsg = { err: wrapError(err) };
			port.postMessage(reply);
		}
	});

}


Object.freeze(exports);