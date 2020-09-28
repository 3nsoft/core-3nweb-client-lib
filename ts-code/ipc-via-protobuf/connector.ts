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

import { Observable, Observer, Subscription, Subject } from "rxjs";
import { ProtoType, ObjectReference, ExposedObjType, strArrValType, fixArray, errBodyType, errToMsg, errFromMsg, Value, valOfOptInt, toVal, toOptVal, valOfOpt } from "./protobuf-msg";
import { Deferred, defer } from "../lib-common/processes";
import { stringOfB64CharsSync } from '../lib-common/random-node';
import { WeakRef } from "../lib-common/weakref";
import { join, resolve } from "path";


export class ObjectsConnector {

	private messagingProc: Subscription|undefined = undefined;
	readonly exposedObjs = new ExposedObjs();
	private readonly fnCallProcs = new Map<number, {
		prom?: Promise<void>;
		sub?: { sub: Subscription; onCancel?: () => void; }; }>();
	private readonly fnCalls = new Map<number, {
		deferred?: Deferred<EnvelopeBody>; obs?: Subject<EnvelopeBody>; }>();
	private fnCallCounter = 1;
	private readonly weakRefs = new Set<WeakRef<any>>();
	private readonly srvRefs = new WeakMap<any, ObjectReference>();

	constructor(
		private msgSink: Observer<Envelope>,
		msgSrc: Observable<Envelope>
	) {
		this.messagingProc = msgSrc.subscribe({
			next: msg => this.processIncomingMsg(msg),
			error: err => this.stop(true, err),
			complete: () => this.stop(true)
		});
		Object.seal(this);
	}

	private stop(fromRemote: boolean, err?: any): void {
		this.messagingProc = undefined;
		this.msgSink = undefined as any;
		this.exposedObjs.dropAll();
		for (const call of this.fnCallProcs.values()) {
			if (call.sub) {
				call.sub.sub.unsubscribe();
				if (call.sub.onCancel) {
					call.sub.onCancel();
				}
			}
		}
		this.fnCallProcs.clear();
		const exc = (fromRemote ?
			makeIPCException({ stopFromOtherSide: true }) :
			makeIPCException({ connectorStop: true }));
		if (err) {
			exc.cause = err;
		}
		for (const call of this.fnCalls.values()) {
			if (call.deferred) {
				call.deferred.reject(exc);
			} else if (call.obs) {
				call.obs.error(exc);
			}
		}
		this.fnCalls.clear();
		for (const clientRef of this.weakRefs.values()) {
			clientRef.removeCallbacks();
		}
		this.weakRefs.clear();
	}

	close(err?: any): void {
		if (!this.messagingProc) { return; }
		if (err) {
			this.msgSink.error(err);
		} else {
			this.msgSink.complete();
		}
		this.messagingProc.unsubscribe();
		this.stop(false);
	}

	private processIncomingMsg(msg: Envelope): void {
		const { msgType, path, fnCallNum: cNum } = msg.headers;
		const fnCallNum = valOfOptInt(cNum);
		const body = valOfOpt(msg.body);
		if (typeof fnCallNum === 'number') {
			if (msgType === 'start') {
				this.processCallStart(fnCallNum, path!, body);
			} else if (msgType === 'interim') {
				this.processInterimCallReply(fnCallNum, body);
			} else if (msgType === 'end') {
				this.processEndCallReply(fnCallNum, body);
			} else if (msgType === 'error') {
				this.processCallError(fnCallNum, body);
			} else if (msgType === 'cancel') {
				this.processCallCancelation(fnCallNum);
			} else if (msgType === 'list-obj') {
				this.processListObj(fnCallNum, path!);
			} else {
				this.sendCallError(fnCallNum, makeIPCException({
					message: `Got unknown msg type ${msgType}`,
					invalidType: true
				}));
			}
		} else if (msgType === 'drop') {
			if (Array.isArray(path)) {
				this.processObjectDrop(path);
			} else {
				this.close(makeIPCException({ invalidPath: true }));
			}
		} else {
			this.close(makeIPCException({ invalidCallNum: true, path }));
		}
	}

	private sendCallError(fnCallNum: number, err: any): void {
		if (!this.messagingProc) { return; }
		const msg: Envelope = {
			headers: { fnCallNum: toVal(fnCallNum), msgType: 'error' },
			body: toVal(errBodyType.pack(errToMsg(err)))
		};
		this.msgSink.next(msg);
	}

	private sendCallReply(
		fnCallNum: number, last: boolean, body: EnvelopeBody
	): void {
		if (!this.messagingProc) { return; }
		this.msgSink.next({
			headers: {
				fnCallNum: toVal(fnCallNum),
				msgType: (last ? 'end' : 'interim')
			},
			body: toOptVal(body) as Value<Buffer>|undefined
		});
	}

	private sendCallCancellation(fnCallNum: number): void {
		if (!this.messagingProc) { return; }
		this.msgSink.next({
			headers: { fnCallNum: toVal(fnCallNum), msgType: 'cancel' }
		});
	}

	private processCallStart(
		fnCallNum: number, path: string[], body: EnvelopeBody
	): void {
		if (this.fnCallProcs.has(fnCallNum)) {
			this.sendCallError(fnCallNum, makeIPCException(
				{ duplicateFnCallNum: true }));
			return;
		}
		try {
			const fn = this.exposedObjs.findFn(path);
			if (!fn) { return; }
			const out = fn(body);
			if (!out) {
				return;
			} else if (out.promise) {
				const prom = out.promise.then(
					buf => {
						this.sendCallReply(fnCallNum, true, buf);
						this.fnCallProcs.delete(fnCallNum);
					},
					err => {
						this.sendCallError(fnCallNum, err);
						this.fnCallProcs.delete(fnCallNum);
					}
				);
				this.fnCallProcs.set(fnCallNum, { prom });
			} else if (out.obs) {
				const sub = out.obs.subscribe({
					next: buf => this.sendCallReply(fnCallNum, false, buf),
					complete: () => {
						this.sendCallReply(fnCallNum, true, undefined);
						this.fnCallProcs.delete(fnCallNum);
					},
					error: err => {
						this.sendCallError(fnCallNum, err);
						this.fnCallProcs.delete(fnCallNum);
					}
				});
				const onCancel = out.onCancel;
				this.fnCallProcs.set(fnCallNum, { sub: { sub, onCancel } });
			}
		} catch (err) {
			this.sendCallError(fnCallNum, err);
		}
	}

	private processInterimCallReply(
		fnCallNum: number, body: EnvelopeBody
	): void {
		const call = this.fnCalls.get(fnCallNum);
		if (!call) { return; }
		if (call.obs) {
			call.obs.next(body);
		} else if (call.deferred) {
			// XXX log presence of fn call with promise instead of observable
			call.deferred.resolve(body);
			this.sendCallCancellation(fnCallNum);
			this.fnCalls.delete(fnCallNum);
		} else {
			// XXX log presence of fn call without fields to signal reply
			this.sendCallCancellation(fnCallNum);
			this.fnCalls.delete(fnCallNum);
		}
	}

	private processEndCallReply(
		fnCallNum: number, body: EnvelopeBody
	): void {
		const call = this.fnCalls.get(fnCallNum);
		if (!call) { return; }
		if (call.obs) {
			call.obs.complete();
		} else if (call.deferred) {
			call.deferred.resolve(body);
		} else {
			// XXX log presence of fn call without fields to signal reply
		}
		this.fnCalls.delete(fnCallNum);
	}

	private processCallError(
		fnCallNum: number, body: EnvelopeBody
	): void {
		const call = this.fnCalls.get(fnCallNum);
		if (!call) { return; }
		const err = (body ? errFromMsg(errBodyType.unpack(body)) : undefined);
		if (call.obs) {
			call.obs.error(err);
		} else if (call.deferred) {
			call.deferred.reject(err);
		} else {
			// XXX log presence of fn call without fields to signal reply
		}
		this.fnCalls.delete(fnCallNum);
	}

	private processCallCancelation(fnCallNum: number): void {
		const call = this.fnCallProcs.get(fnCallNum);
		if (!call) { return; }
		if (call.sub) {
			if (call.sub.onCancel) {
				call.sub.onCancel();
			}
			call.sub.sub.unsubscribe();
		}
		this.fnCallProcs.delete(fnCallNum);
	}

	private processObjectDrop(path: string[]): void {
		if (path.length === 1) {
			this.exposedObjs.drop(path[0]);
		}
	}

	private processListObj(fnCallNum: number, path: string[]): void {
		const obj = this.exposedObjs.find(path);
		if (obj) {
			const lst = Object.keys(obj);
			const buf = strArrValType.pack({ values: lst });
			this.sendCallReply(fnCallNum, true, buf);
		} else {
			const exc = makeIPCException({ 'objectNotFound': true });
			this.sendCallError(fnCallNum, exc);
		}
	}

	private nextFnCallNum(): number {
		while (this.fnCalls.has(this.fnCallCounter)) {
			if (this.fnCallCounter < Number.MAX_SAFE_INTEGER) {
				this.fnCallCounter += 1;
			} else {
				this.fnCallCounter = 1;
			}
		}
		const fnCallNum = this.fnCallCounter;
		this.fnCallCounter = 1;
		return fnCallNum;
	}

	private startCall(
		fnCallNum: number, path: string[], body: EnvelopeBody
	): void {
		if (!this.messagingProc) { throw makeIPCException(
			{ 'ipcNotConnected': true }); }
		this.msgSink.next({
			headers: { fnCallNum: toVal(fnCallNum), msgType: 'start', path },
			body: toOptVal(body) as Value<Buffer>|undefined
		});
	}

	startPromiseCall(path: string[], req: EnvelopeBody): Promise<EnvelopeBody> {
		const deferred = defer<EnvelopeBody>();
		const fnCallNum = this.nextFnCallNum();
		this.fnCalls.set(fnCallNum, { deferred });
		this.startCall(fnCallNum, path, req);
		return deferred.promise;
	}

	startObservableCall(
		path: string[], req: EnvelopeBody, obs: Subject<EnvelopeBody>
	): () => void {
		const fnCallNum = this.nextFnCallNum();
		this.fnCalls.set(fnCallNum, { obs });
		this.startCall(fnCallNum, path, req);
		return () => this.sendCallCancellation(fnCallNum);
	}

	registerClientDrop(o: any, srvRef: ObjectReference): void {
		const clientRef = WeakRef.makeFor(o);
		this.weakRefs.add(clientRef);
		clientRef.addCallback(this.makeClientDropCB(clientRef, srvRef));
		this.srvRefs.set(o, srvRef);
	}

	private makeClientDropCB(
		clientRef: WeakRef<any>, srvRef: ObjectReference
	): () => void {
		return () => {
			this.weakRefs.delete(clientRef);
			this.sendObjDropMsg(srvRef);
		};
	}

	private sendObjDropMsg(srvRef: ObjectReference): void {
		if (!this.messagingProc) { return; }
		this.msgSink.next({ headers: { msgType: 'drop', path: srvRef.path } });
	}

	srvRefOf(clientObj: any): ObjectReference {
		const srvRef = this.srvRefs.get(clientObj);
		if (srvRef) {
			return srvRef;
		} else {
			throw makeIPCException({ 'objectNotFound': true });
		}
	}

	async listObj(path: string[]): Promise<string[]> {
		if (!this.messagingProc) { throw makeIPCException(
			{ 'ipcNotConnected': true }); }
		const deferred = defer<EnvelopeBody>();
		const fnCallNum = this.nextFnCallNum();
		this.fnCalls.set(fnCallNum, { deferred });
		this.msgSink.next({
			headers: { fnCallNum: toVal(fnCallNum), msgType: 'list-obj', path }
		});
		const lstPromise = deferred.promise
		.then(buf => fixArray(strArrValType.unpack(buf).values));
		return lstPromise;
	}

}
Object.freeze(ObjectsConnector.prototype);
Object.freeze(ObjectsConnector);


export class ExposedObjs {

	private readonly objs = new Map<string, {
		exp: ExposedFn|ExposedObj<any>;
		original: any;
	}>();

	exposeDroppableService(
		objType: ExposedObjType, exp: ExposedFn|ExposedObj<any>, original: any
	): ObjectReference {
		ensureCorrectRefObjType(objType);
		let id: string;
		do {
			id = stringOfB64CharsSync(20);
		} while (this.objs.has(id));
		this.objs.set(id, { exp, original });
		return { objType, path: [ id ] };
	}

	getOriginalObj<T>(ref: ObjectReference): T {
		const o = this.objs.get(ref.path[0]);
		if (o) {
			return o.original;
		} else {
			throw makeIPCException({ 'objectNotFound': true });
		}
	}

	exposeW3NService(exp: ExposedFn|ExposedObj<any>): void {
		if (this.objs.has(W3N_NAME)) {
			throw new Error(`${W3N_NAME} object has already been added`);
		}
		this.objs.set(W3N_NAME, { exp, original: undefined });
	}

	drop(name: string): void {
		if (name !== W3N_NAME) {
			this.objs.delete(name);
		}
	}

	find(path: string[]): ExposedFn|ExposedObj<any>|undefined {
		if (!Array.isArray(path) || (path.length === 0)) { return; }
		const rootObj = this.objs.get(path[0]);
		if (!rootObj) { return; }
		let o = rootObj.exp;
		for (let i=1; !!o && (i<path.length); i+=1) {
			if (typeof o !== 'object') { return; }
			o = o[path[i]];
		}
		return o;
	}

	findFn(path: string[]): ExposedFn|undefined {
		const fn = this.find(path);
		if (typeof fn === 'function') {
			return fn;
		} else {
			throw makeIPCException({ callFnNotFound: true, path });
		}
	}

	dropAll(): void {
		this.objs.clear();
	}

}
Object.freeze(ExposedObjs.prototype);
Object.freeze(ExposedObjs);


export const W3N_NAME = 'w3n';

function ensureCorrectRefObjType(objType: ExposedObjType): void {
	switch (objType) {
		case 'FileByteSink':
		case 'FileByteSource':
		case 'UnsubscribeFn':
		case 'Observer':
		case 'FileImpl':
		case 'FSImpl':
		case 'SymLinkImpl':
		case 'FSCollection':
		case 'FSItemsIter':
				return;
		default:
			throw new Error(`Object type ${objType} is not known`);
	}
}

export interface Envelope {
	headers: {
		msgType: MsgType;
		fnCallNum?: Value<number>;
		path?: string[];
	},
	body?: Value<Buffer>;
}

export type EnvelopeBody = Buffer|void;

export type MsgType = ClientToService | ServiceToClient;
export type ClientToService = 'start' | 'cancel' | 'drop' | 'list-obj';
export type ServiceToClient = 'interim' | 'end' | 'error';

export const msgProtoType = ProtoType.makeFrom<Envelope>(
	join(resolve(__dirname, '../../protos'), 'ipc.proto'), 'ipc.Envelope');

export type ExposedFn = (reqBody: EnvelopeBody) => ({
	promise?: Promise<EnvelopeBody>;
	obs?: Observable<EnvelopeBody>;
	onCancel?: () => void;
}|void);

export type ExposedObj<T extends object> = {
	[method in keyof T]: ExposedFn|ExposedObj<any>;
};

export interface IPCException extends web3n.RuntimeException {
	type: 'ipc';
	duplicateFnCallNum?: true;
	objectNotFound?: true;
	callFnNotFound?: true;
	invalidCallNum?: true;
	invalidPath?: true;
	invalidType?: true;
	invalidReference?: true;
	missingBodyBytes?: true;
	badReply?: true;
	stopFromOtherSide?: true;
	connectorStop?: true;
	ipcNotConnected?: true;
	invalidNumInBody?: true;
	path?: string[];
}

export function makeIPCException(fields: Partial<IPCException>): IPCException {
	const exc: IPCException = {
		runtimeException: true,
		type: 'ipc'
	};
	for (const [ field, value ] of Object.entries(fields)) {
		exc[field] = value;
	}
	return exc;
}

export function checkRefObjTypeIs(
	expected: ExposedObjType, ref: ObjectReference
): void {
	if (ref.objType !== expected) { throw new TypeError(
		`Expected reference to ${expected} type, instead got ${ref.objType}`); }
}


Object.freeze(exports);