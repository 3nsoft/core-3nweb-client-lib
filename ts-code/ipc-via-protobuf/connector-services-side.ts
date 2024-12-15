/*
 Copyright (C) 2020 - 2021, 2023 - 2024 3NSoft Inc.
 
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

import { Unsubscribable } from "rxjs";
import { ObjectReference, strArrValType, errBodyType, errToMsg, Value, toVal, toOptVal } from "./protobuf-msg";
import { stringOfB64CharsSync } from '../lib-common/random-node';
import { ServicesSide, Envelope, EnvelopeBody, makeIPCException, ExposedFn, ExposedObj, W3N_NAME, ServicesImpl, TransferableObj } from "./connector";


interface FnCallProc {
	prom?: Promise<void>;
	sub?: { sub: Unsubscribable; onCancel?: () => void; };
}


export class ServicesSideImpl implements ServicesSide {

	readonly exposedObjs = new ExposedObjs();
	private readonly fnCallProcs = new Map<number, FnCallProc>();

	constructor(
		private readonly sendMsg: (msg: Envelope) => void,
	) {
		Object.seal(this);
	}

	stop(): void {
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
	}

	private sendCallError(fnCallNum: number, err: any): void {
		this.sendMsg({
			headers: { fnCallNum: toVal(fnCallNum), msgType: 'error' },
			body: toVal(errBodyType.pack(errToMsg(err)))
		});
	}

	private sendCallReply(
		fnCallNum: number, last: boolean, body: EnvelopeBody
	): void {
		this.sendMsg({
			headers: {
				fnCallNum: toVal(fnCallNum),
				msgType: (last ? 'end' : 'interim')
			},
			body: toOptVal(body) as Value<Buffer>|undefined
		});
	}

	processCallStart(
		fnCallNum: number, path: string[]|undefined, body: EnvelopeBody
	): void {
		if (this.fnCallProcs.has(fnCallNum)) {
			this.sendCallError(fnCallNum, makeIPCException(
				{ duplicateFnCallNum: true }));
			return;
		}
		try {
			const fn = this.exposedObjs.findFn(path);
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

	processCallCancelation(fnCallNum: number): void {
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

	processObjectDrop(path: string[]): void {
		if (Array.isArray(path) && (path.length === 1)) {
			this.exposedObjs.drop(path[0]);
		} else {
			throw makeIPCException({ invalidPath: true, path });
		}
	}

	processListObj(fnCallNum: number, path: string[]): void {
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

	exposedServices(): ServicesImpl {
		const expSrv: ServicesImpl = {
			exposeDroppableService: this.exposedObjs.exposeDroppableService.bind(
				this.exposedObjs
			),
			exposeStaticService: this.exposedObjs.exposeStaticService.bind(
				this.exposedObjs
			),
			exposeW3NService: this.exposedObjs.exposeW3NService.bind(
				this.exposedObjs
			),
			getOriginalObj: this.exposedObjs.getOriginalObj.bind(this.exposedObjs),
			listObj: path => {
				const obj = this.exposedObjs.find(path);
				return (obj ? Object.keys(obj) : null);
			},
			getObjForTransfer: this.exposedObjs.getObjForTransfer.bind(
				this.exposedObjs
			),
			findRefIfAlreadyExposed: this.exposedObjs.findRefIfAlreadyExposed.bind(
				this.exposedObjs
			)
		};
		return expSrv;
	}

}
Object.freeze(ServicesSideImpl.prototype);
Object.freeze(ServicesSideImpl);


export class ExposedObjs {

	private readonly objs = new Map<string, {
		exp: ExposedFn|ExposedObj<any>;
		original: any;
		objType: string;
	}>();
	private readonly objToRefs = new Map<any, ObjectReference<string>>();

	exposeDroppableService<T extends string>(
		objType: T, exp: ExposedFn|ExposedObj<any>, original: any
	): ObjectReference<T> {
		const ref = this.newRef(objType);
		this.objs.set(ref.path[0], { exp, original, objType });
		this.objToRefs.set(original, ref);
		return ref;
	}

	private newRef<T extends string>(objType: T): ObjectReference<T> {
		let id: string;
		do {
			id = stringOfB64CharsSync(20);
		} while (this.objs.has(id));
		return {
			objType, path: [ id ]
		};
	}

	getOriginalObj<T>(ref: ObjectReference<any>): T {
		const o = this.objs.get(ref.path[0]);
		if (o) {
			return o.original;
		} else {
			throw makeIPCException({ 'objectNotFound': true });
		}
	}

	getObjForTransfer<T extends string>(
		ref: ObjectReference<T>
	): TransferableObj<T> {
		const o = this.objs.get(ref.path[0]);
		if (!o) {
			throw makeIPCException({ 'objectNotFound': true });
		} else if (ref.objType !== o.objType) {
			throw makeIPCException({ 'invalidReference': true });
		} else {
			return { o: o.original, type: o.objType as T };
		}
	}

	findRefIfAlreadyExposed(o: any): ObjectReference<any>|undefined {
		return this.objToRefs.get(o);
	}

	exposeW3NService(exp: ExposedFn|ExposedObj<any>): void {
		if (this.objs.has(W3N_NAME)) {
			throw new Error(`${W3N_NAME} object has already been added`);
		}
		this.objs.set(W3N_NAME, {
			exp, original: undefined, objType: 'non-transferable'
		});
	}

	exposeStaticService<T extends string>(
		objType: T, exp: ExposedFn|ExposedObj<any>
	): ObjectReference<T> {
		const ref = this.newRef(objType);
		this.objs.set(ref.path[0], {
			exp, original: undefined, objType
		});
		return ref;
	}

	drop(name: string): void {
		if (name !== W3N_NAME) {
			const o = this.objs.get(name);
			if (o) {
				this.objs.delete(name);
				this.objToRefs.delete(o);
			}
		}
	}

	find(path: string[]|undefined): ExposedFn|ExposedObj<any>|undefined {
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

	findFn(path: string[]|undefined): ExposedFn {
		const fn = this.find(path);
		if (typeof fn === 'function') {
			return fn;
		} else {
			throw makeIPCException({ callFnNotFound: true, path });
		}
	}

	dropAll(): void {
		this.objs.clear();
		this.objToRefs.clear();
	}

}
Object.freeze(ExposedObjs.prototype);
Object.freeze(ExposedObjs);


Object.freeze(exports);