/*
 Copyright (C) 2020 - 2022 3NSoft Inc.
 
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

import { Subject } from "rxjs";
import { ObjectReference, errBodyType, errFromMsg, Value, toVal, toOptVal } from "./protobuf-msg";
import { Deferred, defer } from "../lib-common/processes";
import { WeakReference, makeWeakRefFor } from "../lib-common/weakref";
import { ClientsSide, makeIPCException, EnvelopeBody, Envelope, IPCException, Caller } from "./connector";


interface FnCall {
	deferred?: Deferred<EnvelopeBody>;
	obs?: Subject<EnvelopeBody>;
}


// XXX can have an optimized use of WeakRef and FinalizationRegistry, when
// these are available.
export class ClientsSideImpl implements ClientsSide {

	private readonly fnCalls = new Map<number, FnCall>();
	private fnCallCounter = 1;
	private readonly weakRefs = new Set<WeakReference<any>>();
	private readonly srvRefs = new WeakMap<any, ObjectReference<any>>();
	private isStopped = false;

	constructor(
		private readonly sendMsg: (msg: Envelope) => void,
		private readonly syncReqToListObj: Caller['listObj'],
		private readonly asyncReqToListObj: Caller['listObjAsync']
	) {
		if ((this.asyncReqToListObj && this.syncReqToListObj)
		|| (!this.asyncReqToListObj && !this.syncReqToListObj)) {
			throw new Error(`Expect either sync or async obj listing function.`);
		}
		Object.seal(this);
	}

	stop(exc: IPCException): void {
		if (this.isStopped) { return; }
		this.isStopped = true;
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

	private sendCallCancellation(fnCallNum: number): void {
		this.sendMsg({
			headers: { fnCallNum: toVal(fnCallNum), msgType: 'cancel' }
		});
	}

	processInterimCallReply(fnCallNum: number, body: EnvelopeBody): void {
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

	processEndCallReply(fnCallNum: number, body: EnvelopeBody): void {
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

	processCallError(fnCallNum: number, body: EnvelopeBody): void {
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

	private nextFnCallNum(): number {
		while (this.fnCalls.has(this.fnCallCounter)) {
			if (this.fnCallCounter < Number.MAX_SAFE_INTEGER) {
				this.fnCallCounter += 1;
			} else {
				this.fnCallCounter = 1;
			}
		}
		const fnCallNum = this.fnCallCounter;
		this.fnCallCounter += 1;
		return fnCallNum;
	}

	caller(): Caller {
		const callerWrap: Caller = {
			listObj: (this.syncReqToListObj ? this.listObj.bind(this) : undefined),
			listObjAsync: (this.asyncReqToListObj ?
				this.listObjAsync.bind(this) : undefined),
			registerClientDrop: this.registerClientDrop.bind(this),
			srvRefOf: this.srvRefOf.bind(this),
			startObservableCall: this.startObservableCall.bind(this),
			startPromiseCall: this.startPromiseCall.bind(this)
		};
		return callerWrap;
	}

	private startCall(
		fnCallNum: number, path: string[], body: EnvelopeBody
	): void {
		if (this.isStopped) { throw makeIPCException(
			{ 'ipcNotConnected': true }); }
		this.sendMsg({
			headers: { fnCallNum: toVal(fnCallNum), msgType: 'start', path },
			body: toOptVal(body) as Value<Buffer>|undefined
		});
	}

	startPromiseCall(path: string[], req: EnvelopeBody): Promise<EnvelopeBody> {
		const deferred = defer<EnvelopeBody>();
		const fnCallNum = this.nextFnCallNum();
		this.fnCalls.set(fnCallNum, { deferred });
		try {
			this.startCall(fnCallNum, path, req);
			return deferred.promise;
		} catch (err) {
			this.fnCalls.delete(fnCallNum);
			throw err;
		}
	}

	startObservableCall(
		path: string[], req: EnvelopeBody, obs: Subject<EnvelopeBody>
	): () => void {
		const fnCallNum = this.nextFnCallNum();
		this.fnCalls.set(fnCallNum, { obs });
		try {
			this.startCall(fnCallNum, path, req);
			return () => this.sendCallCancellation(fnCallNum);
		} catch (err) {
			this.fnCalls.delete(fnCallNum);
			throw err;
		}
	}

	registerClientDrop(o: any, srvRef: ObjectReference<any>): void {
		const clientRef = makeWeakRefFor(o);
		this.weakRefs.add(clientRef);
		clientRef.addCallback(this.makeClientDropCB(clientRef, srvRef));
		this.srvRefs.set(o, srvRef);
	}

	private makeClientDropCB(
		clientRef: WeakReference<any>, srvRef: ObjectReference<any>
	): () => void {
		return () => {
			this.weakRefs.delete(clientRef);
			this.sendObjDropMsg(srvRef);
		};
	}

	private sendObjDropMsg(srvRef: ObjectReference<any>): void {
		if (this.isStopped) { return; }
		this.sendMsg({ headers: { msgType: 'drop', path: srvRef.path } });
	}

	srvRefOf(clientObj: any): ObjectReference<any> {
		const srvRef = this.srvRefs.get(clientObj);
		if (srvRef) {
			return srvRef;
		} else {
			throw makeIPCException({ 'objectNotFound': true });
		}
	}

	listObj(path: string[]): string[] {
		if (this.isStopped) { throw makeIPCException(
			{ 'ipcNotConnected': true }); }
		return this.syncReqToListObj!(path);
	}

	listObjAsync(path: string[]): Promise<string[]> {
		if (this.isStopped) { throw makeIPCException(
			{ 'ipcNotConnected': true }); }
		return this.asyncReqToListObj!(path);
	}

}
Object.freeze(ClientsSideImpl.prototype);
Object.freeze(ClientsSideImpl);


Object.freeze(exports);