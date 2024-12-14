/*
 Copyright (C) 2020 - 2024 3NSoft Inc.
 
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

import { Observer, SubjectLike, Subscribable, Unsubscribable } from "rxjs";
import { ObjectReference, errBodyType, errToMsg, Value, valOfOptInt, toVal, valOfOpt } from "./protobuf-msg";
import { ProtoType } from '../lib-client/protobuf-type';
import { ipc as pb } from '../protos/ipc.proto';

export interface ServicesImpl {
	exposeDroppableService<T extends string>(
		objType: T, exp: ExposedFn|ExposedObj<any>, original: any
	): ObjectReference<T>;
	getOriginalObj<T>(ref: ObjectReference<any>): T;
	exposeStaticService(name: string, exp: ExposedFn|ExposedObj<any>): void;
	listObj(path: string[]): string[]|null;
	getObjForTransfer<T extends string>(
		ref: ObjectReference<T>
	): TransferableObj<T>;
	findRefIfAlreadyExposed(o: any): ObjectReference<any>|undefined;
}

export interface TransferableObj<T extends string> {
	type: T;
	o: any;
}

export interface ServicesSide {
	exposedServices(): ServicesImpl;
	processCallStart(
		fnCallNum: number, path: string[]|undefined, body: EnvelopeBody,
	): void;
	processCallCancelation(fnCallNum: number): void;
	processListObj(fnCallNum: number, path: string[]|undefined): void;
	processObjectDrop(path: string[]|undefined): void;
	stop(): void;
}

export interface CoreSideServices {
	exposeDroppableService: ServicesImpl['exposeDroppableService'];
	getOriginalObj: ServicesImpl['getOriginalObj'];
	exposeW3NService(exp: ExposedFn|ExposedObj<any>): void;
	listObj: ServicesImpl['listObj'];
	getObjForTransfer: ServicesImpl['getObjForTransfer'];
	findRefIfAlreadyExposed: ServicesImpl['findRefIfAlreadyExposed'];
}

export interface CoreSide {
	exposedServices: CoreSideServices;
	close: (err?: any) => void;
}

export interface ClientSide {
	caller: Caller;
	close: (err?: any) => void;
}

export interface Caller {
	startPromiseCall(path: string[], req: EnvelopeBody): Promise<EnvelopeBody>;
	startObservableCall(
		path: string[], req: EnvelopeBody, obs: SubjectLike<EnvelopeBody>
	): () => void;
	registerClientDrop(
		o: any, srvRef: ObjectReference<any>, reconstructData?: any
	): void;
	srvRefOf(clientObj: any): ObjectReference<any>;
	listObj?: (path: string[]) => string[];
	listObjAsync?: (path: string[]) => Promise<string[]>;
	findCallingObjByRef<T, R>(
		ref: ObjectReference<any>
	): { obj?: T; reconstructData?: R; }|undefined;
}

export interface ObjectFromCore {
	_isObjectFromCore: true;
}

export interface ClientsSide {
	caller(): Caller;
	processInterimCallReply(fnCallNum: number, body: EnvelopeBody): void;
	processEndCallReply(fnCallNum: number, body: EnvelopeBody): void;
	processCallError(fnCallNum: number, body: EnvelopeBody): void;
	stop(exc: IPCException): void;
}

// Note that make_?_Side functions could've been imported normally, but client
// side uses weakrefs, while services side doesn't, and services side can be
// used in embedding without weakrefs, needing to hide require points.

function makeServicesSide(sendMsg: (msg: Envelope) => void): ServicesSide {
	const srvClassFn = require('./connector-services-side').ServicesSideImpl;
	return new srvClassFn(sendMsg);
}

function makeClientsSide(
	sendMsg: (msg: Envelope) => void,
	syncReqToListObj: Caller['listObj'],
	asyncReqToListObj: Caller['listObjAsync']
): ClientsSide {
	const classFn = require('./connector-clients-side').ClientsSideImpl;
	return new classFn(sendMsg, syncReqToListObj, asyncReqToListObj);
}


export class ObjectsConnector {

	private messagingProc: Unsubscribable|undefined = undefined;
	private readonly services: ServicesSide|undefined;
	private readonly clients: ClientsSide|undefined;

	private constructor(
		side: 'client'|'core',
		private msgSink: Observer<Envelope>,
		msgSrc: Subscribable<Envelope>,
		listObj?: Caller['listObj'],
		listObjAsync?: Caller['listObjAsync']
	) {
		this.messagingProc = msgSrc.subscribe({
			next: msg => this.processIncomingMsg(msg),
			error: err => this.stop(true, err),
			complete: () => this.stop(true)
		});
		const sendMsg = (msg: Envelope): void => {
			if (!this.messagingProc) { return; }
			this.msgSink.next(msg);
		};
		switch (side) {
			case 'core':
				this.services = makeServicesSide(sendMsg);
				this.clients = undefined;
				break;
			case "client":
				if ((!listObj && !listObjAsync)
				|| (listObj && listObjAsync)) { throw new Error(
					`Client side needs either listObj, or listObjAsync argument`);
				}
				this.clients = makeClientsSide(sendMsg, listObj, listObjAsync);
				this.services = undefined;
				break;
		}
		Object.seal(this);
	}

	static makeCoreSide(
		fromCore: Observer<Envelope>, toCore: Subscribable<Envelope>
	): CoreSide {
		const connector = new ObjectsConnector('core', fromCore, toCore);
		const {
			exposeDroppableService, exposeStaticService, findRefIfAlreadyExposed,
			getObjForTransfer, getOriginalObj, listObj
		} = connector.services!.exposedServices();
		let w3nIsSet = false;
		return {
			exposedServices: {
				exposeDroppableService,
				exposeW3NService: exp => {
					if (w3nIsSet) {
						throw new Error(`${W3N_NAME} object has already been added`);
					}
					exposeStaticService(W3N_NAME, exp);
					w3nIsSet = true;
				},
				findRefIfAlreadyExposed, getObjForTransfer,
				getOriginalObj, listObj
			},
			close: err => connector.close(err)
		};
	}

	static makeClientSide(
		fromClient: Observer<Envelope>, toClient: Subscribable<Envelope>,
		listObj?: Caller['listObj'],
		listObjAsync?: Caller['listObjAsync']
	): ClientSide {
		const connector = new ObjectsConnector(
			'client', fromClient, toClient, listObj, listObjAsync
		);
		return {
			caller: connector.clients!.caller(),
			close: err => connector.close(err)
		};
	}

	private stop(fromRemote: boolean, err?: any): void {
		this.messagingProc = undefined;
		this.msgSink = undefined as any;
		if (this.services) {
			this.services.stop();
		}
		if (this.clients) {
			const exc = (fromRemote ?
				makeIPCException({ stopFromOtherSide: true }) :
				makeIPCException({ connectorStop: true }));
			if (err) {
				exc.cause = err;
			}
			this.clients.stop(exc);
		}
	}

	close(err?: any): void {
		if (!this.messagingProc) { return; }
		this.messagingProc.unsubscribe();
		if (err) {
			this.msgSink.error(err);
		} else {
			this.msgSink.complete();
		}
		this.stop(false, err);
	}

	private processIncomingMsg(msg: Envelope): void {
		const { msgType, path, fnCallNum: cNum } = msg.headers;
		const fnCallNum = valOfOptInt(cNum);
		const body = valOfOpt(msg.body);
		try {
			if (typeof fnCallNum === 'number') {
				if (msgType === 'start') {
					this.services?.processCallStart(fnCallNum, path, body);
				} else if (msgType === 'interim') {
					this.clients?.processInterimCallReply(fnCallNum, body);
				} else if (msgType === 'end') {
					this.clients?.processEndCallReply(fnCallNum, body);
				} else if (msgType === 'error') {
					this.clients?.processCallError(fnCallNum, body);
				} else if (msgType === 'cancel') {
					this.services?.processCallCancelation(fnCallNum);
				} else if (msgType === 'list-obj') {
					this.services?.processListObj(fnCallNum, path);
				} else {
					this.sendCallError(fnCallNum, makeIPCException({
						message: `Got unknown msg type ${msgType}`,
						invalidType: true
					}));
				}
			} else if (msgType === 'drop') {
				this.services?.processObjectDrop(path);
			} else {
				throw makeIPCException({ invalidCallNum: true, path });
			}
		} catch (err) {
			this.close(err);
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

}
Object.freeze(ObjectsConnector.prototype);
Object.freeze(ObjectsConnector);


export const W3N_NAME = 'w3n';

/**
 * Envelope is a message form that is sent in IPC channel.
 */
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

export const msgProtoType = ProtoType.for<Envelope>(pb.Envelope);

export type ExposedFn = (reqBody: EnvelopeBody) => ({
	promise?: Promise<EnvelopeBody>;
	obs?: Subscribable<EnvelopeBody>;
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

export function checkRefObjTypeIs<T>(
	expected: T, ref: ObjectReference<T>
): void {
	if (ref.objType !== expected) { throw new TypeError(
		`Expected reference to ${expected} type, instead got ${ref.objType}`); }
}


Object.freeze(exports);