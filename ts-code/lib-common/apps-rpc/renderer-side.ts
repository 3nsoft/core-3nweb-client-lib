/*
 Copyright (C) 2018 - 2019 3NSoft Inc.
 
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

import { AppSide, RPCLink } from './core-side';
import { Subject, Observer as RxObserver } from 'rxjs';
import { stringifyErr } from '../exceptions/error';
import { packIntoArr, unpackFromArr } from './packing-json';
import { Observable } from 'rxjs';
import { share, filter } from 'rxjs/operators';

export type RPC = web3n.rpc.RPC;
export type Observer<T> = web3n.Observer<T>;
export type RegistrationEvent = web3n.rpc.RegistrationEvent;
export type ObjectRegistrationParams<T> = web3n.rpc.ObjectRegistrationParams<T>;
export type FuncRegistrationParams = web3n.rpc.FuncRegistrationParams;

export function makeRPC(coreSide: RPCLink,
		isObjFromCore: (o: any) => boolean): RPC {
	return (new Registry(coreSide, isObjFromCore)).wrapForApp();
}

class Registry implements RPC, AppSide {

	private local: Local;
	private requester: Requester;
	private remote: Remote;
	private appId: string;

	private msgQueue: any[][] = [];

	// should keep this as a live reference, else gc will cut in
	private wrapForCore = Object.freeze<AppSide>({
		handleMsg: this.handleMsg.bind(this),
		handleObjRemovalOnOtherSide:
			this.handleObjRemovalOnOtherSide.bind(this),
		close: this.close.bind(this),
	});

	constructor(
		private core: RPCLink,
		private isObjFromCore: (o: any) => boolean
	) {
		const wmap: WMap = {
			get: id => this.core.getFromWMap(this.appId, id),
			set: (id, o) => this.core.setToWMap(this.appId, id, o),
		};
		const sendMsg = this.sendMsg.bind(this);
		const isConnected = this.isConnected.bind(this);
		this.remote = new Remote(wmap);
		this.local = new Local(isConnected, sendMsg, this.remote);
		this.requester = new Requester(isConnected, sendMsg,
			this.remote, this.local, this.isObjFromCore);
		this.remote.setDependencies(this.requester, this.local);
		const { appId, bufMsgs } = this.core.setApp(this.wrapForCore);
		this.appId = appId;
		if (bufMsgs) {
			this.msgQueue.push(...bufMsgs);
			this.triggerMsgProcessing();
		}
	}

	getRemote<TRemote>(name: string): TRemote|undefined {
		return this.remote.getByName(name);
	}

	async getRemoteEventually<TRemote>(name: string): Promise<TRemote> {
		const rem = this.getRemote<TRemote>(name);
		if (rem) { return rem; }
		return (await new Observable(this.watchRegistrations)
		.pipe(
			filter(regEvent => (regEvent.name === name))
		)
		.toPromise()).remote as TRemote;
	}

	registerLocal<T>(
		local: T, params: ObjectRegistrationParams<T>|FuncRegistrationParams
	): () => void {
		return this.local.add(local, params);
	}

	private isConnected(): boolean {
		return !!this.core;
	}

	close(): void {
		if (!this.isConnected()) { return; }
		const core = this.core;
		this.core = undefined as any;
		this.remote.signalClosing();
		this.remote = undefined as any;
		this.local = undefined as any;
		this.requester.signalClosing();
		this.requester = undefined as any;
		core.close();
	}

	watchRegistrations: RPC['watchRegistrations'] = obs => {
		const sub = this.remote.registration$
		.subscribe(obs as RxObserver<RegistrationEvent>);
		return () => sub.unsubscribe();
	};

	wrapForApp(): RPC {
		const w: RPC = {
			close: this.close.bind(this),
			getRemote: this.getRemote.bind(this) as RPC['getRemote'],
			getRemoteEventually: this.getRemoteEventually.bind(this) as RPC['getRemoteEventually'],
			registerLocal: this.registerLocal.bind(this),
			watchRegistrations: this.watchRegistrations,
		};
		return Object.freeze(w);
	}

	handleMsg(msgArr: any[]): void {
		this.msgQueue.push(msgArr);
		this.triggerMsgProcessing();
	}

	private triggerMsgProcessing(): void {
		if (this.msgProc) { return; }
		const msg = this.msgQueue.shift();
		if (!msg) { return; }
		this.msgProc = this.processMsg(msg)
		.then(() => {
			this.msgProc = undefined;
			this.triggerMsgProcessing();
		});
	}

	private msgProc: Promise<void>|undefined = undefined;

	private async processMsg(msgArr: any[]): Promise<void> {
		if (!this.isConnected()) { return; }
		try {
			const msg = unpackFromArr<Msg>(msgArr);
			if (msg.type === 'rpc/request') {
				await this.local.handleRequest(msg);
			} else if (msg.type === 'rpc/reply') {
				this.requester.handleReply(msg);
			} else if (msg.type === 'rpc/register') {
				this.remote.handleObjRegistration(msg);
			} else if (msg.type === 'rpc/revoke') {
				this.remote.handleRevocation(msg.id)
			}
		} catch (err) {
			console.error(err);
		}
	};

	handleObjRemovalOnOtherSide(id: number): void {
		setTimeout(this.objRemovalHandler, 0, id);
	}

	private objRemovalHandler = (id: number): void => {
		if (!this.isConnected()) { return; }
		try {
			this.local.handleObjRemovalOnOtherSide(id);
		} catch (err) {
			console.error(err);
		}
	}

	private sendMsg(msg: Msg): void {
		if (!this.isConnected()) { return; }
		const msgArr = packIntoArr(msg, this.arrPackObjFilter);
		this.core.sendMsg(this.appId, msgArr);
	}

	private arrPackObjFilter = o => {
		const typeOfO = typeof o;
		if (typeOfO === 'function') { return this.isObjFromCore(o); }
		if ((typeOfO !== 'object') || !o) { return false; }
		return (ArrayBuffer.isView(o) || this.isObjFromCore(o));
	};

}

interface RPCRegistrationMsg<T> {
	type: 'rpc/register';
	name: string;
	id: number;
	obj?: ObjRegistration<T>;
	jncObj?: any;
	func?: FuncRegistration;
}

interface RPCRevocationMsg {
	type: 'rpc/revoke';
	id: number;
}

interface ObjectCallRequestMsg {
	type: 'rpc/request';
	id: number;
	method?: string;
	params: CallParam[];
	reqId?: number;
}

interface CallParam {
	v?: any;
	ref?: number;
	cRef?: number|EmbeddedRegistration;
}

interface EmbeddedRegistration {
	id: number;
	obj?: ObjRegistration<any>;
	jncObj?: any;
	func?: FuncRegistration;
}

interface ObjectCallReplyMsg<T> {
	type: 'rpc/reply';
	reqId: number;
	result?: CallResult<T>;
	error?: any;
}

interface CallResult<T> {
	v?: T;
	ref?: number|EmbeddedRegistration;
	cRef?: number;
}

type Msg = RPCRegistrationMsg<any> | RPCRevocationMsg |
	ObjectCallRequestMsg | ObjectCallReplyMsg<any>;

interface FuncRegistration {
	args?: 'all-jnc' | ('jnc' | 'ref' | 'cRef')[];
	reply?: 'jnc' | 'ref' | 'cRef' | 'none';
}

type ObjRegistration<T> = {
	[field in keyof T]: {
		t: 'jnc' | 'method' | 'ref' | 'cRef';
		v: any | number;
		reg?: EmbeddedRegistration;
	};
};

interface WMap {
	set: (id: number, obj: any) => void;
	get: (id: number) => any;
}

class Remote {

	private namedRemotes = new Map<string, any>();
	private remoteToId = new WeakMap<any, number>();

	private regBroadcast = new Subject<RegistrationEvent>();
	registration$ = this.regBroadcast.asObservable().pipe(share());

	private requester: Requester;
	private local: Local;

	constructor(
		private wmap: WMap
	) {}

	signalClosing(): void {
		this.regBroadcast.complete();
	}

	setDependencies(requester: Requester, local: Local): void {
		this.requester = requester;
		this.local = local;
	}

	handleObjRegistration(msg: RPCRegistrationMsg<any>): void {
		this.checkRegMsg(msg);
		const remote = this.makeRemote(msg);
		const name = msg.name;
		this.namedRemotes.set(name, remote);
		this.regBroadcast.next({ type: 'registration', name, remote });
	}

	private makeRemote(reg: EmbeddedRegistration|RPCRegistrationMsg<any>): any {
		const id = reg.id;
		let remote = this.wmap.get(id);
		if (remote) { return remote; }
		if (reg.jncObj) {
			this.addToWeakMaps(id, reg.jncObj);
			return reg.jncObj;
		} else if (reg.obj) {
			return this.makeRemoteObj(id, reg.obj);
		} else if (reg.func) {
			return this.makeRemoteFunc(id, undefined, reg.func);
		} else {
			throw new Error(`Both obj and func are missing`);
		}
	}

	findOrMakeRemote(ref: number| EmbeddedRegistration): any|undefined {
		if (typeof ref === 'number') {
			let remote = this.wmap.get(ref);
			if (!remote) { throw new Error(
				`Cannot find argument, referenced as ${ref}`); }
			return remote;
		} else {
			return this.makeRemote(ref);
		}
	}

	private checkRegMsg(msg: RPCRegistrationMsg<any>): void {
		if ((msg.name !== undefined)
		&& ((typeof msg.name !== 'string') || (msg.name.length === 0))) {
			throw new Error(`Invalid registration message: name is invalid`);
		}
		if (typeof msg.id !== 'number') {
			throw new Error(`Invalid registration message: id isn't a string`);
		}
		if (!msg.jncObj && !msg.obj && !msg.func) {
			throw new Error(
				`Invalid registration message: both obj and func are missing`);
		}
	}

	private addToWeakMaps(id: number, x: any): void {
		this.remoteToId.set(x, id);
		this.wmap.set(id, x);
	}

	private makeRemoteFunc(
		id: number, method: string|undefined, funcReg: FuncRegistration
	): Function {
		const f = (...args) => this.requester.call(id, method, args, funcReg);
		if (method === undefined) {
			this.addToWeakMaps(id, f);
		}
		return f;
	}

	private makeRemoteObj<T>(id: number, objReg: ObjRegistration<T>): object {
		// XXX propDescr can be turned into static (frozen, if proxy likes it)
		const propDescr: PropertyDescriptor = {
			configurable: true,
			enumerable: true,
			writable: false,
		};
		const remote = new Proxy(objReg, {
			ownKeys: (target) => Object.keys(target),
			getOwnPropertyDescriptor: (target, prop) =>
				((prop in target) ? propDescr : undefined),
			get: (target, prop: keyof T) => {
				const p = target[prop];
				if (!p) { return; }
				if (p.t === 'jnc') { return p.v; }
				if (p.t === 'method') {
					if (typeof p.v === 'object') {
						p.v = this.makeRemoteFunc(id, prop as string, p.v);
					}
					return p.v;
				}
				if (p.t === 'ref') {
					if (typeof p.v === 'number') {
						const remote = this.wmap.get(p.v);
						if (remote) {
							p.v = remote;
						} else if (p.reg) {
							p.v = this.makeRemote(p.reg);
						}
					}
					return p.v;
				}
				if (p.t === 'cRef') {
					if (typeof p.v === 'number') {
						p.v = this.local.findLocal(p.v, true);
					}
					return p.v;
				}
			},
		});
		this.addToWeakMaps(id, remote);
		return remote;
	}

	handleRevocation(id: number): void {
		const remote = this.wmap.get(id);
		if (!remote) { return; }
		this.wmap.set(id, undefined);
		this.remoteToId.delete(remote);
		for (const [ name, val ] of this.namedRemotes.entries()) {
			if (val === remote) {
				this.namedRemotes.delete(name);
				break;
			}
		}
		this.regBroadcast.next({ type: 'revocation', name, remote });
	}

	getByName<T>(name: string): T|undefined {
		return this.namedRemotes.get(name);
	}

	getIdOf(remote: any): number|undefined {
		return this.remoteToId.get(remote);
	}

}

interface Deferred {
	resolve(result?: any): void;
	reject(cause: any): void;
}

class Requester {

	private counter = new Counter();
	private requests = new Map<number, {
		funcReg: FuncRegistration,
		deferred: Deferred,
	}>();

	constructor(
		private isConnected: () => boolean,
		private sendMsg: (msg: Msg) => void,
		private remote: Remote,
		private local: Local,
		private isCoreObj: (o: any) => boolean
	) {}

	signalClosing(): void {
		const err = Error(`RPC has disconnected`);
		for (const req of this.requests.values()) {
			req.deferred.reject(err);
		}
		this.requests.clear();
	}
	
	call<T>(
		id: number, method: string|undefined, args: any[],
		funcReg: FuncRegistration
	): Promise<T>|undefined {
		if (!this.isConnected()) { throw new Error(`RPC has disconnected`); }
		const params = this.packArgs(args);
		if (!funcReg.reply || (funcReg.reply === 'none')) {
			const reqMsg: ObjectCallRequestMsg =
				{ type: 'rpc/request', id, method, params };
			this.sendMsg(reqMsg);
		} else {
			const reqId = this.counter.nextId();
			const reqMsg: ObjectCallRequestMsg =
				{ type: 'rpc/request', id, method, params, reqId };
			const promise = new Promise<T>((resolve, reject) => {
				this.requests.set(reqId,
					{ deferred: { resolve, reject }, funcReg });
			});
			this.sendMsg(reqMsg);		
			return promise;
		}
	}

	private packArgs(args: any[]): CallParam[] {
		const params: CallParam[] = [];
		for (const arg of args) {
			const argType = typeof arg;
			if ((argType === 'object') || (argType === 'function')) {
				const cRef = this.local.getIdOf(arg);
				if (cRef !== undefined) {
					const reg = this.local.getRegParamsToSendFstTime(cRef);
					params.push(reg ? { cRef: reg } : { cRef });
					continue;
				}
				const ref = this.remote.getIdOf(arg);
				if (ref !== undefined) {
					params.push({ ref });
					continue;
				}
				if (this.isCoreObj(arg)) {
					params.push({ v: arg });
					continue;
				}
				params.push({ v: arg });
			} else {
				params.push({ v: arg });
			}
		}
		return params;
	}

	handleReply(msg: ObjectCallReplyMsg<any>): void {
		const req = this.requests.get(msg.reqId);
		if (!req) { return; }
		this.requests.delete(msg.reqId);
		if (msg.error) {
			req.deferred.reject(msg.error);
		} else {
			const result = this.unpackResult(msg.result!, req.funcReg);
			req.deferred.resolve(result);
		}
	}

	private unpackResult<T>(cr: CallResult<T>, funcReg: FuncRegistration): any {
		if (funcReg.reply! === 'jnc') {
			return cr.v;
		} else if (funcReg.reply! === 'ref') {
			return this.remote.findOrMakeRemote(cr.ref!);
		} else if (funcReg.reply! === 'cRef') {
			return this.local.findLocal(cr.cRef!);
		}
	}

}

class Counter {

	private counter = 0;

	nextId(): number {
		this.counter += 1;
		if (this.counter === Number.MAX_SAFE_INTEGER) {
			this.counter = Number.MIN_SAFE_INTEGER;
		}
		return this.counter;
	}
	
}

interface LocalEntity {
	entity: any;
	name?: string;
	objMethods?: Map<string, FuncRegistration>;
	func?: FuncRegistration;
	deferredReg?: EmbeddedRegistration;
}

class Local {

	private locals = new Map<number, LocalEntity>();
	private localsToId = new WeakMap<any, number>();
	private counter = new Counter();

	constructor(
		private isConnected: () => boolean,
		private sendMsg: (msg: Msg) => void,
		private remote: Remote
	) {}

	handleObjRemovalOnOtherSide(id: number): void {
		const local = this.locals.get(id);
		if (!local) { return; }
		if (local.name !== undefined) { return; }
		this.locals.delete(id);
		this.localsToId.delete(local.entity);
	}

	async handleRequest(msg: ObjectCallRequestMsg): Promise<void> {
		const { funcReg, func, obj } = this.findFuncRegistrationFor(msg);
		const args = this.unpackArgs(msg.params, funcReg);
		const reqId = ((!funcReg.reply || (funcReg.reply === 'none')) ?
			undefined : msg.reqId);
		try {
			const result = await (msg.method ?
				obj![msg.method](...args) : func!(...args));
			if (reqId === undefined) { return; }
			this.packAndSendReply(funcReg, reqId, result);
		} catch (err) {
			if (reqId === undefined) { return; }
			this.packAndSendReply(funcReg, reqId, undefined, err);
		}
	}

	private findFuncRegistrationFor(
		msg: ObjectCallRequestMsg
	): { funcReg: FuncRegistration; func?: Function; obj?: object; } {
		const local = this.locals.get(msg.id);
		if (!local) { throw new Error(`Unknown entity id ${msg.id}`); }

		if (msg.method) {
			if (!local.objMethods) { throw new Error(
				`Entity ${msg.id} has no methods`); }
			const funcReg = local.objMethods.get(msg.method);
			if (!funcReg) { throw new Error(
				`Entity ${msg.id} has no method ${msg.method}`); }
			return { funcReg, obj: local.entity };
		}

		if (!local.func) { throw new Error(
			`Entity ${msg.id} is not a function`); }
		return { funcReg: local.func, func: local.entity };
	}

	private unpackArgs(params: CallParam[], funcReg: FuncRegistration): any[] {
		if (!funcReg.args || (funcReg.args === 'all-jnc')) {
			return params.map(param => {
				if ((param.ref !== undefined) || (param.cRef !== undefined)) {
					throw new Error(`Got an unexpected reference form for an argument in rpc call`);
				}
				return param.v;
			})
		}

		const args: any[] = [];
		for (let i=0; i<params.length; i+=1) {
			const argType = ((i<funcReg.args.length) ? funcReg.args[i] : 'jnc');
			if (argType === 'jnc') {
				// value can be either json, or core's object; message unpacking
				// distiguished these two options and presented a ready object
				args.push(params[i].v);
			} else if (argType === 'ref') {
				args.push(this.findLocal(params[i].ref!));
			} else if (argType === 'cRef') {
				args.push(this.remote.findOrMakeRemote(params[i].cRef!));
			} else {
				throw new Error(`Got an unexpected  arg type ${argType} in function registration`);
			}
		}
		return args;
	}

	private packAndSendReply(
		funcReg: FuncRegistration, reqId: number, result: any, err?: any
	): void {
		if (err) {
			const msg: ObjectCallReplyMsg<any> = {
				type: 'rpc/reply', reqId, error: toTransferrableError(err) };
			this.sendMsg(msg);
		} else {
			const msg: ObjectCallReplyMsg<typeof result> = {
				type: 'rpc/reply',
				reqId,
				result: this.packResult(result, funcReg)
			};
			this.sendMsg(msg);
		}
	}

	private packResult<T>(result: T, funcReg: FuncRegistration): CallResult<T> {
		if (funcReg.reply === 'jnc') {
			return { v: result };
		} else if (funcReg.reply === 'ref') {
			const ref = this.localsToId.get(result);
			if (ref === undefined) { throw new Error(
				`Cannot find local object to be referenced in rpc call result`); }
			const reg = this.getRegParamsToSendFstTime(ref);
			return  (reg ? { ref: reg } : { ref });
		} else if (funcReg.reply === 'cRef') {
			const cRef = this.remote.getIdOf(result);
			if (cRef === undefined) { throw new Error(
				`Cannot find remote object to be referenced in rpc call result`); }
			return { cRef };
		} else {
			throw new Error(`This methods' assumptions are not satisfied`);
		}
	}

	getRegParamsToSendFstTime(id: number): EmbeddedRegistration|undefined {
		const entity = this.locals.get(id);
		if (!entity) { return; }
		return entity.deferredReg;
	}

	add<T>(
		local: T, params: ObjectRegistrationParams<T>|FuncRegistrationParams
	): () => void {
		if (!this.isConnected()) { throw new Error(`RPC has been disconnected`); }
		let id = this.localsToId.get(local);
		if (id) { return this.makeRevoker(id); }
		
		id = this.counter.nextId();
		let entity: LocalEntity;
		const name = params.name;
		if (typeof local === 'function') {
			const func = this.prepareFuncRegParams(
				params as FuncRegistrationParams);
			entity = { entity: local, name, func, deferredReg: { id, func } };
		} else if ((typeof local === 'object') && local) {
			const objParams = (params as ObjectRegistrationParams<T>);
			if (objParams.fields === 'all-jnc') {
				entity = { entity: local, name, deferredReg: { id, jncObj: local } };
			} else {
				const obj = this.prepareObjRegParams(local, objParams.fields);
				const objMethods = this.makeObjMethods(obj);
				entity = { entity: local, name, objMethods, deferredReg: { id, obj } };
			}
		} else {
			throw new Error(`RPC can't register ${!local ? local : typeof local}`);
		}

		if (name) {
			const reg = entity.deferredReg!;
			entity.deferredReg = undefined;
			const regMsg: RPCRegistrationMsg<any> = {
				type: 'rpc/register', id, name,
				func: reg.func, obj: reg.obj, jncObj: reg.jncObj };
			this.sendMsg(regMsg);
		}

		this.locals.set(id, entity);
		this.localsToId.set(local, id);
		return this.makeRevoker(id);
	}

	private makeRevoker(id: number): () => void {
		return async () => {
			const local = this.locals.get(id);
			if (!local) { return; }
			this.locals.delete(id);
			this.localsToId.delete(local.entity);
			const revMsg: RPCRevocationMsg = { type: 'rpc/revoke', id };
			this.sendMsg(revMsg);
		}
	}

	private makeObjMethods<T>(params: ObjRegistration<T>):
			Map<string, FuncRegistration> {
		const methodRegs = new Map<string, FuncRegistration>();
		for (const field in params) {
			const param = params[field];
			if (param.t === 'method') {
				methodRegs.set(field, param.v as FuncRegistration);
			}
		}
		return methodRegs;
	}

	private prepareObjRegParams<T>(
		local: T, fieldParams: ObjectRegistrationParams<T>['fields']
	): ObjRegistration<T> {
		if (typeof fieldParams !== 'object') { throw new TypeError(
			`This method expect a case, when field parameters argument is an object`); }
		const objReg = {} as ObjRegistration<T>;
		for (const field in fieldParams) {
			const t = fieldParams[field];
			if (t === 'jnc') {
				objReg[field] = { t: 'jnc', v: local[field] };
			} else if (t && (typeof t === 'object')) {
				if (typeof local[field] !== 'function') { throw new Error(
					`Field ${field} is registered as a method, but object is missing it, or it isn't a function`); }
				objReg[field] = { t: 'method', v: t };
			} else if (t === 'ref') {
				const id = this.localsToId.get(local[field]);
				if (!id) { throw new Error(
					`Referenced in registration local object in field ${field}, hasn't been registered, yet`); }
				const entity = this.locals.get(id)!;
				objReg[field] = { t: 'ref', v: id, reg: entity.deferredReg };
			} else if (t === 'cRef') {
				const id = this.remote.getIdOf(local[field]);
				if (!id) { throw new Error(
					`processing cRef in a registration is not implemented, yet`); }
				objReg[field] = { t: 'cRef', v: id };
			} else {
				throw new Error();
			}
		}
		return objReg;
	}

	private prepareFuncRegParams(
		params: FuncRegistrationParams
	): FuncRegistration {
		const reg: FuncRegistration = {
			args: params.args,
			reply: params.reply,
		};
		return reg;
	}

	getIdOf(local: any): number|undefined {
		return this.localsToId.get(local);
	}

	findLocal<T>(id: number, undefinedOnMissing?: boolean): T|undefined {
		const local = this.locals.get(id);
		if (!local) {
			if (undefinedOnMissing) { return; } 
			throw new Error(`Cannot find argument, referenced as ${id}`);
		}
		return local.entity;
	}

}

type RuntimeException = web3n.RuntimeException;

function toTransferrableError(e: RuntimeException): any {
	const errStr = stringifyErr(e);
	return ((e && e.runtimeException) ? JSON.parse(errStr) : errStr);
}
