/*
 Copyright (C) 2016 - 2017 3NSoft Inc.

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

import { fork, ChildProcess } from 'child_process';
import { cpus } from 'os';
import { commToChild, IPCToChild } from '../../lib-common/ipc/node-child-ipc';
import { reqNames, ScryptRequest, CRYPTOR_CHANNEL, OpenRequest, OpenWNRequest,	PackRequest, DHSharedKeyRequest, SignatureRequest, VerifySigRequest,
	SigKeyPairReply }
	from './common';
import { signing } from 'ecma-nacl';
import { toBuffer, bufFromJson } from '../../lib-common/buffer-utils';
import { LogWarning } from '../logging/log-to-file';
import { AsyncSBoxCryptor } from 'xsp-files';

import { arrays, secret_box as sbox } from 'ecma-nacl';

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

const CHILD_SCRIPT = `${__dirname}/child.js`;

interface Task<T> {
	reqName: string;
	req: T;
	notifyCallback?: (progress: any) => void;
	resolve?: (result: any) => void;
	reject?: (err: any) => void;
}

const MAX_IDLE_MILLIS = 60*1000;

class Child {
	
	proc: ChildProcess;
	private comm: IPCToChild;
	isBusy = false;
	lastActiveAt = 0;
	periodicCheck = setInterval(() => {
		if (this.isBusy) { return; }
		if ((Date.now() - this.lastActiveAt) > MAX_IDLE_MILLIS) {
			this.proc.kill();
			clearInterval(this.periodicCheck);
		}
	}, MAX_IDLE_MILLIS);
	
	constructor() {
		this.proc = fork(CHILD_SCRIPT);
		this.comm = commToChild(CRYPTOR_CHANNEL, this.proc);
		this.periodicCheck.unref();
		this.proc.on('exit', () => {
			this.comm.close();
			clearInterval(this.periodicCheck);
		});
		Object.seal(this);
	}
	
	makeRequest<T>(t: Task<any>): Promise<T> {
		try {
			this.isBusy = true;
			const r = this.comm.makeRequest<T>(t.reqName, t.req, t.notifyCallback);
			if (t.resolve) { t.resolve(r); }
			return r;
		} catch (err) {
			if (t.reject) { t.reject(err); }
			throw err;
		} finally {
			this.isBusy = false;
			this.lastActiveAt = Date.now();
		}
	}
}

/**
 * This is en(de)-crypting service that uses node's child processes to do
 * actual calculations. 
 */
class CryptService {
	
	private numOfThreads: number;
	private idle: Child[] = [];
	private busy: Child[] = [];
	private tasks: Task<any>[] = [];
	private isClosed = false;
	
	constructor(
		private logWarning: LogWarning,
		maxThreads: number|undefined
	) {
		const numOfCPUs = cpus().length;
		if (numOfCPUs <= 2) {
			this.numOfThreads = 1;
		} else if (maxThreads === undefined) {
			this.numOfThreads = numOfCPUs - 2;
		} else {
			this.numOfThreads = Math.min(maxThreads, numOfCPUs-2);
		}
		Object.seal(this);
	}
	
	private getChildForNewTask(): Child|undefined {
		let child = this.idle.pop();
		if (child) {
			this.busy.push(child);
		} else if (this.busy.length < this.numOfThreads) {
			child = new Child();
			child.proc.on('disconnect', () => {
				if (this.isClosed) { return; }
				let i = this.idle.indexOf(child!);
				if (i >= 0) {
					this.idle.splice(i, 1);
				}
				i = this.busy.indexOf(child!);
				if (i >= 0) {
					this.busy.splice(i, 1);
				}
			});
			this.busy.push(child);
		}
		return child;
	}
	
	private startNextTaskOrSetIdle(child: Child): void {
		if (this.isClosed) { return; }
		const i = this.busy.indexOf(child);
		if (i < 0) { return; }
		const t = this.tasks.shift();
		if (t) {
			child.makeRequest(t);
		} else {
			this.busy.splice(i, 1);
			this.idle.push(child);
		}
	}
	
	private async execTask<T>(t: Task<any>): Promise<T> {
		if (this.isClosed) { throw new Error('Cryptor is closed.'); }
		const child = this.getChildForNewTask();
		if (child) {
			try {
				return await child.makeRequest<T>(t);
			} finally {
				this.startNextTaskOrSetIdle(child);
			}
		} else {
			this.tasks.push(t);
			return new Promise<T>((resolve, reject) => {
				t.resolve = resolve;
				t.reject = reject;
			})
		}
	}
	
	async scrypt(passwd: Uint8Array, salt: Uint8Array, logN: number, r: number,
			p: number, dkLen: number, progressCB: (p: number) => void):
			Promise<Uint8Array> {
		const t: Task<ScryptRequest> = {
			reqName: reqNames.scrypt,
			req: {
				passwd: toBuffer(passwd),
				salt: toBuffer(salt),
				logN, r, p, dkLen },
			notifyCallback: progressCB
		};
		return bufFromJson(await this.execTask<Buffer>(t));
	}
	
	async sboxWNOpen(c: Uint8Array, k: Uint8Array): Promise<Uint8Array> {
		const t: Task<OpenWNRequest> = {
			reqName: reqNames.sboxWNOpen,
			req: {
				c: toBuffer(c),
				k: toBuffer(k)
			}
		};
		return bufFromJson(await this.execTask<Buffer>(t));
	}
	
	async sboxOpen(c: Uint8Array, n: Uint8Array, k: Uint8Array):
			Promise<Uint8Array> {
		const t: Task<OpenRequest> = {
			reqName: reqNames.sboxOpen,
			req: {
				c: toBuffer(c),
				n: toBuffer(n),
				k: toBuffer(k)
			}
		};
		return bufFromJson(await this.execTask<Buffer>(t));
	}
	
	async sboxPack(m: Uint8Array, n: Uint8Array, k: Uint8Array):
			Promise<Uint8Array> {
		const t: Task<PackRequest> = {
			reqName: reqNames.sboxPack,
			req: {
				m: toBuffer(m),
				n: toBuffer(n),
				k: toBuffer(k)
			}
		};
		return bufFromJson(await this.execTask<Buffer>(t));
	}
	
	async sboxWNPack(m: Uint8Array, n: Uint8Array, k: Uint8Array):
			Promise<Uint8Array> {
		const t: Task<PackRequest> = {
			reqName: reqNames.sboxWNPack,
			req: {
				m: toBuffer(m),
				n: toBuffer(n),
				k: toBuffer(k)
			}
		};
		return bufFromJson(await this.execTask<Buffer>(t));
	}
	
	async boxGenPubKey(sk: Uint8Array): Promise<Uint8Array> {
		const t: Task<Buffer> = {
			reqName: reqNames.boxGenPubKey,
			req: toBuffer(sk)
		};
		return bufFromJson(await this.execTask<Buffer>(t));
	}
	
	async boxDHSharedKey(pk: Uint8Array, sk: Uint8Array): Promise<Uint8Array> {
		const t: Task<DHSharedKeyRequest> = {
			reqName: reqNames.boxDHSharedKey,
			req: {
				pk: toBuffer(pk),
				sk: toBuffer(sk)
			}
		};
		return bufFromJson(await this.execTask<Buffer>(t));
	}
	
	async signature(m: Uint8Array, sk: Uint8Array): Promise<Uint8Array> {
		const t: Task<SignatureRequest> = {
			reqName: reqNames.signature,
			req: {
				m: toBuffer(m),
				sk: toBuffer(sk)
			}
		};
		return bufFromJson(await this.execTask<Buffer>(t));
	}
	
	async verifySignature(sig: Uint8Array, m: Uint8Array, pk: Uint8Array):
			Promise<boolean> {
		const t: Task<VerifySigRequest> = {
			reqName: reqNames.verifySignature,
			req: {
				sig: toBuffer(sig),
				m: toBuffer(m),
				pk: toBuffer(pk)
			}
		};
		return this.execTask<boolean>(t);
	}
	
	async signatureKeyPair(seed: Uint8Array): Promise<signing.Keypair> {
		const t: Task<Buffer> = {
			reqName: reqNames.signatureKeyPair,
			req: toBuffer(seed)
		};
		const reply = await this.execTask<SigKeyPairReply>(t);
		const pair: signing.Keypair = {
			skey: bufFromJson(reply.skey),
			pkey: bufFromJson(reply.pkey)
		};
		return pair;
	}
	
	close(): void {
		if (this.isClosed) { return; }
		for (const child of this.idle) {
			child.proc.kill();
		}
		for (const child of this.busy) {
			this.logWarning('Closing cryptor, while some work still goes on.');
			child.proc.kill();
		}
		if (this.tasks.length > 0) {
			this.logWarning(
				'Closing cryptor, while there still tasks waiting execution.');
			for (const t of this.tasks) {
				t.reject!(new Error('Cryptor is closed.'));
			}
		}
		this.isClosed = true;
		this.idle = (undefined as any);
		this.busy = (undefined as any);
		this.tasks = (undefined as any);
	}
	
}
Object.freeze(CryptService.prototype);
Object.freeze(CryptService);

export function makeCryptor(
	logWarning: LogWarning, maxThreads?: number
): { cryptor: Cryptor; close: () => void; } {
	if (typeof maxThreads === 'number') {
		if (maxThreads < 1) { throw new Error(
			'Number of threads should be more than one.'); }
	} else {
		if (maxThreads !== undefined) { throw new Error(
			`Illegal parameter is given as number of htreads ${maxThreads}`); }
	}
	const cs = new CryptService(logWarning, maxThreads);

	// XXX we are inserting on-tread crypto till moment when passing buffers
	//		to child is less heavy, than current json-ification.
	const arrFactory = arrays.makeFactory();
	const ac: AsyncSBoxCryptor = {
		open: async (c, n, k) => sbox.open(c, n, k, arrFactory),
		pack: async (m, n, k) => sbox.pack(m, n, k, arrFactory),
		formatWN: {
			open: async (c, k) => sbox.formatWN.open(c, k, arrFactory),
			pack: async (m, n, k) => sbox.formatWN.pack(m, n, k, arrFactory),
		}
	};

	const cryptor: Cryptor = {
		
		scrypt: cs.scrypt.bind(cs),
		
		box: {
			calc_dhshared_key: cs.boxDHSharedKey.bind(cs),
			generate_pubkey: cs.boxGenPubKey.bind(cs)
		},

		// sbox: {
		// 	open: cs.sboxOpen.bind(cs),
		// 	pack: cs.sboxPack.bind(cs),
		// 	formatWN: {
		// 		open: cs.sboxWNOpen.bind(cs),
		// 		pack: cs.sboxPack.bind(cs),
		// 	}
		// },
		sbox: ac,
		
		signing: {
			generate_keypair: cs.signatureKeyPair.bind(cs),
			signature: cs.signature.bind(cs),
			verify: cs.verifySignature.bind(cs),
		}

	};
	Object.freeze(cryptor.box);
	Object.freeze(cryptor.sbox);
	Object.freeze(cryptor.signing);
	Object.freeze(cryptor);
	function close(): void {
		cs.close();
	}
	return { cryptor, close };
}

Object.freeze(exports);