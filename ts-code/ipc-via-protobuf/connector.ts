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

import { Observable, Observer, Subscription, Subject } from "rxjs";
import { ProtoType, ObjectReference, ExposedObjType, errBodyType, errToMsg, Value, valOfOptInt, toVal, valOfOpt } from "./protobuf-msg";


export interface ExposedServices {
	exposeDroppableService(
		objType: ExposedObjType, exp: ExposedFn|ExposedObj<any>, original: any
	): ObjectReference;
	getOriginalObj<T>(ref: ObjectReference): T;
	exposeW3NService(exp: ExposedFn|ExposedObj<any>): void;
	listObj(path: string[]): string[]|null;
}

export interface ServicesSide {
	exposedServices(): ExposedServices;
	processCallStart(
		fnCallNum: number, path: string[]|undefined, body: EnvelopeBody,
	): void;
	processCallCancelation(fnCallNum: number): void;
	processListObj(fnCallNum: number, path: string[]|undefined): void;
	processObjectDrop(path: string[]|undefined): void;
	stop(): void;
}

export interface Caller {
	startPromiseCall(path: string[], req: EnvelopeBody): Promise<EnvelopeBody>;
	startObservableCall(
		path: string[], req: EnvelopeBody, obs: Subject<EnvelopeBody>
	): () => void;
	registerClientDrop(o: any, srvRef: ObjectReference): void;
	srvRefOf(clientObj: any): ObjectReference;
	listObj(path: string[]): string[];
}

export interface ClientsSide {
	caller(): Caller;
	processInterimCallReply(fnCallNum: number, body: EnvelopeBody): void;
	processEndCallReply(fnCallNum: number, body: EnvelopeBody): void;
	processCallError(fnCallNum: number, body: EnvelopeBody): void;
	stop(exc: IPCException): void;
}

function makeServicesSide(sendMsg: (msg: Envelope) => void): ServicesSide {
	const srvClassFn = require('./connector-services-side').ServicesSideImpl;
	return new srvClassFn(sendMsg);
}

function makeClientsSide(
	sendMsg: (msg: Envelope) => void,
	syncReqToListObj: (path: string[]) => string[]|null
): ClientsSide {
	const classFn = require('./connector-clients-side').ClientsSideImpl;
	return new classFn(sendMsg, syncReqToListObj);
}


export class ObjectsConnector {

	private messagingProc: Subscription|undefined = undefined;
	private readonly services: ServicesSide|undefined;
	private readonly clients: ClientsSide|undefined;

	constructor(
		private msgSink: Observer<Envelope>,
		msgSrc: Observable<Envelope>,
		sides: 'clients'|'services'|'clients-and-services',
		listObjOnServiceSide?: (path: string[]) => string[]|null
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
		this.services = (
			((sides === 'services') || (sides === 'clients-and-services')) ?
			makeServicesSide(sendMsg) : undefined);
		if ((sides === 'clients') || (sides === 'clients-and-services')) {
			if (!listObjOnServiceSide) { throw new Error(
				`Client side needs listObjOnServiceSide argument`); }
			this.clients = makeClientsSide(sendMsg, listObjOnServiceSide);
		} else {
			this.clients = undefined;
		}
		Object.seal(this);
	}

	get caller(): Caller {
		if (!this.clients) { throw new Error(
			`Clients side is not set in this connector`); }
		return this.clients.caller();
	}

	get exposedServices(): ExposedServices {
		if (!this.services) { throw new Error(
			`Services side is not set in this connector`); }
		return this.services.exposedServices();
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
		if (err) {
			this.msgSink.error(err);
		} else {
			this.msgSink.complete();
		}
		this.messagingProc.unsubscribe();
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

export function ensureCorrectRefObjType(objType: ExposedObjType): void {
	switch (objType) {
		case 'FileByteSink':
		case 'FileByteSource':
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

export const msgProtoType = ProtoType.makeFrom<Envelope>(
	'ipc.proto', 'ipc.Envelope');

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