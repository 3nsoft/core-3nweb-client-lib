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

import { ProtoType, fixInt, fixArray, valOfOpt, Value, toVal, valOfOptJson, toOptVal, toOptJson, packInt, unpackInt, valOfOptInt, errToMsg, ErrorValue, errFromMsg } from './protobuf-msg';
import { ExposedObj, ExposedFn, makeIPCException, EnvelopeBody, Caller, ExposedServices } from './connector';
import { Subject } from 'rxjs';
import { map } from 'rxjs/operators';
import { exposeFSService, FSMsg, makeFSCaller } from './fs';
import { FileMsg } from './file';

type ASMailService = web3n.asmail.Service;
type Inbox = ASMailService['inbox'];
type Delivery = ASMailService['delivery'];
type MsgInfo = web3n.asmail.MsgInfo;
type IncomingMessage = web3n.asmail.IncomingMessage;
type OutgoingMessage = web3n.asmail.OutgoingMessage;
type DeliveryProgress = web3n.asmail.DeliveryProgress;

export function exposeASMailCAP(
	cap: ASMailService, expServices: ExposedServices
): ExposedObj<ASMailService> {
	const out = cap.delivery;
	const box = cap.inbox;
	return {
		getUserId: getUserId.wrapService(cap.getUserId),
		delivery: {
			addMsg: addMsg.wrapService(out.addMsg),
			currentState: currentState.wrapService(out.currentState),
			listMsgs: delivListMsgs.wrapService(out.listMsgs),
			observeAllDeliveries: observeAllDeliveries.wrapService(
				out.observeAllDeliveries),
			observeDelivery: observeDelivery.wrapService(out.observeDelivery),
			preFlight: preFlight.wrapService(out.preFlight),
			rmMsg: rmMsg.wrapService(out.rmMsg)
		},
		inbox: {
			getMsg: getMsg.wrapService(box.getMsg, expServices),
			listMsgs: inboxListMsgs.wrapService(box.listMsgs),
			removeMsg: removeMsg.wrapService(box.removeMsg),
			subscribe: inboxSubscribe.wrapService(box.subscribe, expServices)
		},
	};
}

export function makeASMailCaller(
	caller: Caller, objPath: string[]
): ASMailService {
	const delivPath = objPath.concat('delivery');
	const inboxPath = objPath.concat('inbox');
	return {
		getUserId: getUserId.makeCaller(caller, objPath),
		delivery: {
			addMsg: addMsg.makeCaller(caller, delivPath),
			currentState: currentState.makeCaller(caller, delivPath),
			listMsgs: delivListMsgs.makeCaller(caller, delivPath),
			observeAllDeliveries: observeAllDeliveries.makeCaller(
				caller, delivPath),
			observeDelivery: observeDelivery.makeCaller(caller, delivPath),
			preFlight: preFlight.makeCaller(caller, delivPath),
			rmMsg: rmMsg.makeCaller(caller, delivPath)
		},
		inbox: {
			getMsg: getMsg.makeCaller(caller, inboxPath),
			listMsgs: inboxListMsgs.makeCaller(caller, inboxPath),
			removeMsg: removeMsg.makeCaller(caller, inboxPath),
			subscribe: inboxSubscribe.makeCaller(caller, inboxPath)
		}
	};
}

function asmailType<T extends object>(type: string): ProtoType<T> {
	return ProtoType.makeFrom<T>('asmail.proto', `asmail.${type}`);
}


namespace getUserId {

	export function wrapService(fn: ASMailService['getUserId']): ExposedFn {
		return () => {
			const promise = fn()
			.then(userId => Buffer.from(userId, 'utf8'));
			return { promise };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): ASMailService['getUserId'] {
		const path = objPath.concat('getUserId');
		return () => caller.startPromiseCall(path, undefined)
		.then(buf => {
			if (!buf) { throw makeIPCException({ missingBodyBytes: true }); }
			return buf.toString('utf8');
		});
	}

}
Object.freeze(getUserId);


namespace inboxListMsgs {

	interface Request {
		fromTS?: Value<number>;
	}
	interface Reply {
		infos: MsgInfo[];
	}

	const requestType = asmailType<Request>('ListMsgsRequestBody');
	const replyType = asmailType<Reply>('ListMsgsInboxReplyBody');

	function unpackMsgInfos(buf: EnvelopeBody): MsgInfo[] {
		const msgs = fixArray(replyType.unpack(buf).infos);
		for (const msg of msgs) {
			msg.deliveryTS = fixInt(msg.deliveryTS);
		}
		return msgs;
	}
	
	export function wrapService(fn: Inbox['listMsgs']): ExposedFn {
		return (reqBody: Buffer) => {
			const { fromTS } = requestType.unpack(reqBody);
			const promise = fn(valOfOptInt(fromTS))
			.then(infos => replyType.pack({ infos }));
			return { promise };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): Inbox['listMsgs'] {
		const path = objPath.concat('listMsgs');
		return fromTS => {
			const req: Request = (fromTS ? { fromTS: toVal(fromTS) } : {});
			return caller
			.startPromiseCall(path, requestType.pack(req))
			.then(unpackMsgInfos);
		};
	}

}
Object.freeze(inboxListMsgs);


namespace removeMsg {

	interface Request {
		msgId: string;
	}

	const requestType = asmailType<Request>('RemoveMsgRequestBody');

	export function wrapService(fn: Inbox['removeMsg']): ExposedFn {
		return (reqBody: Buffer) => {
			const { msgId } = requestType.unpack(reqBody);
			const promise = fn(msgId);
			return { promise };
		}
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): Inbox['removeMsg'] {
		const path = objPath.concat('removeMsg');
		return async msgId => {
			await caller.startPromiseCall(path, requestType.pack({ msgId }));
		};
	}

}
Object.freeze(removeMsg);


namespace getMsg {

	interface Request {
		msgId: string;
	}

	const requestType = asmailType<Request>('GetMsgRequestBody');

	export function wrapService(
		fn: Inbox['getMsg'], expServices: ExposedServices
	): ExposedFn {
		return (reqBody: Buffer) => {
			const { msgId } = requestType.unpack(reqBody);
			const promise = fn(msgId)
			.then(msg => packIncomingMessage(msg, expServices));
			return { promise };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): Inbox['getMsg'] {
		const path = objPath.concat('getMsg');
		return msgId => caller
		.startPromiseCall(path, requestType.pack({ msgId }))
		.then(buf => unpackIncomingMessage(buf, caller));
	}

}
Object.freeze(getMsg);

interface IncomingMessageMsg {
	msgType: string;
	msgId: string;
	deliveryTS: number;
	sender: string;
	establishedSenderKeyChain: boolean;
	subject?: Value<string>;
	plainTxtBody?: Value<string>;
	htmlTxtBody?: Value<string>;
	jsonBody?: Value<string>;
	carbonCopy?: string[];
	recipients?: string[];
	attachments?: FSMsg;
}
const incomingMessageType = asmailType<IncomingMessageMsg>(
	'IncomingMessageMsg');

function packIncomingMessage(
	m: IncomingMessage, expServices: ExposedServices
): EnvelopeBody {
	const ipcMsg: IncomingMessageMsg = {
		msgType: m.msgType,
		msgId: m.msgType,
		deliveryTS: m.deliveryTS,
		sender: m.sender,
		establishedSenderKeyChain: m.establishedSenderKeyChain,
		subject: toOptVal(m.subject),
		plainTxtBody: toOptVal(m.plainTxtBody),
		htmlTxtBody: toOptVal(m.htmlTxtBody),
		jsonBody: toOptJson(m.jsonBody),
		carbonCopy: m.carbonCopy,
		recipients: m.recipients,
		attachments: (m.attachments ?
			exposeFSService(m.attachments, expServices) : undefined)
	};
	return incomingMessageType.pack(ipcMsg);
}

function unpackIncomingMessage(
	buf: EnvelopeBody, caller: Caller
): IncomingMessage {
	const ipcMsg = incomingMessageType.unpack(buf);
	const msg: IncomingMessage = {
		msgType: ipcMsg.msgType,
		msgId: ipcMsg.msgId,
		deliveryTS: fixInt(ipcMsg.deliveryTS),
		sender: ipcMsg.sender,
		establishedSenderKeyChain: ipcMsg.establishedSenderKeyChain,
		subject: valOfOpt(ipcMsg.subject),
		plainTxtBody: valOfOpt(ipcMsg.plainTxtBody),
		htmlTxtBody: valOfOpt(ipcMsg.htmlTxtBody),
		jsonBody: valOfOptJson(ipcMsg.jsonBody),
		carbonCopy: ipcMsg.carbonCopy,
		recipients: ipcMsg.recipients,
		attachments: (ipcMsg.attachments ?
			makeFSCaller(caller, ipcMsg.attachments) : undefined)
	};
	return msg;
}


namespace inboxSubscribe {

	interface Request {
		event: string;
	}

	const requestType = asmailType<Request>('SubscribeStartCallBody');

	export function wrapService(
		fn: Inbox['subscribe'], expServices: ExposedServices
	): ExposedFn {
		return buf => {
			const { event } = requestType.unpack(buf);
			const s = new Subject<IncomingMessage>();
			const obs = s.asObservable().pipe(
				map(msg => packIncomingMessage(msg, expServices))
			);
			const onCancel = fn(event as any, s);
			return { obs, onCancel };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): Inbox['subscribe'] {
		const path = objPath.concat('subscribe');
		return (event, obs) => {
			const s = new Subject<EnvelopeBody>();
			const unsub = caller.startObservableCall(
				path, requestType.pack({ event }), s);
			s.subscribe({
				next: buf => {
					if (obs.next) {
						obs.next(unpackIncomingMessage(buf, caller));
					}
				},
				complete: obs.complete,
				error: obs.error
			});
			return unsub;
		};
	}

}
Object.freeze(inboxSubscribe);


namespace preFlight {

	interface Request {
		toAddress: string;
	}

	const requestType = asmailType<Request>('PreFlightRequestBody');

	export function wrapService(fn: Delivery['preFlight']): ExposedFn {
		return (reqBody: Buffer) => {
			const { toAddress } = requestType.unpack(reqBody);
			const promise = fn(toAddress)
			.then(packInt);
			return { promise };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): Delivery['preFlight'] {
		const path = objPath.concat('preFlight');
		return toAddress => caller
		.startPromiseCall(path, requestType.pack({ toAddress }))
		.then(unpackInt);
	}

}
Object.freeze(preFlight);


namespace addMsg {

	interface OutgoingMessageMsg {
		msgType: string;
		subject?: Value<string>;
		plainTxtBody?: Value<string>;
		htmlTxtBody?: Value<string>;
		jsonBody?: Value<string>;
		carbonCopy?: string[];
		recipients?: string[];
		msgId?: Value<string>;
		attachments?: {
			files?: {
				name: string;
				file: FileMsg;
			};
			folders?: {
				name: string;
				folder: FSMsg;
			};
		};
	}
	
	interface Request {
		recipients: string[];
		msg: OutgoingMessageMsg;
		id: string;
		sendImmeditely?: Value<boolean>;
		localMeta?: Value<Buffer>;
	}

	const requestType = asmailType<Request>('AddMsgRequestBody');

	function packMsg(m: OutgoingMessage): OutgoingMessageMsg {
		const ipcMsg: OutgoingMessageMsg = {
			msgType: m.msgType,
			htmlTxtBody: toOptVal(m.htmlTxtBody),
			jsonBody: toOptJson(m.jsonBody),
			msgId: toOptVal(m.msgType),
			plainTxtBody: toOptVal(m.plainTxtBody),
			recipients: m.recipients,
			carbonCopy: m.carbonCopy,
			subject: toOptVal(m.subject)
		};
		if (m.attachments) {
			ipcMsg.attachments = {};
			if (m.attachments.files) {}
			if (m.attachments.folders) {}
		}
		return ipcMsg;
	}

	function unpackMsg(ipcMsg: OutgoingMessageMsg): OutgoingMessage {
		const msg: OutgoingMessage = {
			msgType: ipcMsg.msgType,
			htmlTxtBody: valOfOpt(ipcMsg.htmlTxtBody),
			jsonBody: valOfOptJson(ipcMsg.jsonBody),
			msgId: valOfOpt(ipcMsg.msgId),
			plainTxtBody: valOfOpt(ipcMsg.plainTxtBody),
			recipients: ipcMsg.recipients,
			carbonCopy: ipcMsg.carbonCopy,
			subject: valOfOpt(ipcMsg.subject)
		};
		if (ipcMsg.attachments) {
			msg.attachments = {};
			if (ipcMsg.attachments.files) {}
			if (ipcMsg.attachments.folders) {}
		}
		return msg;
	}

	export function wrapService(fn: Delivery['addMsg']): ExposedFn {
		return (reqBody: Buffer) => {
			const { id, recipients, msg,
				localMeta, sendImmeditely } = requestType.unpack(reqBody);
			const promise = fn(
				fixArray(recipients), unpackMsg(msg), id, {
					localMeta: valOfOpt(localMeta),
					sendImmeditely: valOfOpt(sendImmeditely)
				});
			return { promise };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): Delivery['addMsg'] {
		const path = objPath.concat('addMsg');
		return async (recipients, msg, id, opts) => {
			const req: Request = { id, msg: packMsg(msg), recipients };
			if (opts) {
				req.sendImmeditely = toOptVal(opts.sendImmeditely);
				req.localMeta = toOptVal(opts.localMeta);
			}
			await caller.startPromiseCall(path, requestType.pack(req));
		}
	}

}
Object.freeze(addMsg);


namespace delivListMsgs {

	interface Reply {
		msgs: { id: string; info: DeliveryProgressMsg; }[];
	}

	const replyType = asmailType<Reply>('ListMsgsDeliveryReplyBody');

	export function wrapService(fn: Delivery['listMsgs']): ExposedFn {
		return () => {
			const promise = fn()
			.then(idAndInfo => {
				const msgs = idAndInfo.map(
					({ id, info }) => ({ id, info: packDeliveryProgress(info) }));
				return replyType.pack({ msgs })
			});
			return { promise };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): Delivery['listMsgs'] {
		const path = objPath.concat('listMsgs');
		return () => caller
		.startPromiseCall(path, undefined)
		.then(buf => {
			const msgs = fixArray(replyType.unpack(buf).msgs);
			return msgs.map(
				({ id, info }) => ({ id, info: unpackDeliveryProgress(info) }));
		});
	}

}
Object.freeze(delivListMsgs);


interface DeliveryProgressMsg {
	notConnected?: Value<boolean>;
	allDone: boolean;
	msgSize: number;
	localMeta?: Value<Buffer>;
	recipients: {
		address: string;
		info: {
			done: boolean;
			idOnDelivery?: Value<string>;
			err?: ErrorValue;
			bytesSent: number;
		};
	}[];
}

const deliveryProgressMsgType = asmailType<DeliveryProgressMsg>(
	'DeliveryProgressMsg');

function packDeliveryProgress(p: DeliveryProgress): DeliveryProgressMsg {
	const m: DeliveryProgressMsg = {
		notConnected: toOptVal(p.notConnected),
		allDone: p.allDone,
		msgSize: p.msgSize,
		localMeta: toOptVal(p.localMeta),
		recipients: []
	};
	for (const [ address, info ] of Object.entries(p.recipients)) {
		m.recipients.push({
			address,
			info: {
				done: info.done,
				idOnDelivery: toOptVal(info.idOnDelivery),
				bytesSent: info.bytesSent,
				err: (info.err ? errToMsg(info.err) : undefined)
			}
		});
	}
	return m;
}

function unpackDeliveryProgress(m: DeliveryProgressMsg): DeliveryProgress {
	const p: DeliveryProgress = {
		allDone: m.allDone,
		msgSize: fixInt(m.msgSize),
		notConnected: valOfOpt(m.notConnected) as true|undefined,
		localMeta: valOfOpt(m.localMeta),
		recipients: {}
	};
	for (const { address, info } of fixArray(m.recipients)) {
		p.recipients[address] = {
			done: info.done,
			idOnDelivery: valOfOpt(info.idOnDelivery),
			bytesSent: info.bytesSent,
			err: (info.err ? errFromMsg(info.err) : undefined)
		};
	}
	return p;
}


namespace currentState {

	interface Request {
		id: string;
	}

	const requestType = asmailType<Request>('CurrentStateRequestBody');

	export function wrapService(fn: Delivery['currentState']): ExposedFn {
		return (reqBody: Buffer) => {
			const { id } = requestType.unpack(reqBody);
			const promise = fn(id)
			.then(p => {
				if (p) {
					const msg = packDeliveryProgress(p);
					return deliveryProgressMsgType.pack(msg);
				}
			});
			return { promise };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): Delivery['currentState'] {
		const path = objPath.concat('currentState');
		return id => caller
		.startPromiseCall(path, requestType.pack({ id }))
		.then(buf => {
			if (buf) {
				const msg = deliveryProgressMsgType.unpack(buf);
				return unpackDeliveryProgress(msg);
			}
		});
	}

}
Object.freeze(currentState);


namespace rmMsg {

	interface Request {
		id: string;
		cancelSending?: Value<boolean>;
	}

	const requestType = asmailType<Request>('RmMsgRequestBody');

	export function wrapService(fn: Delivery['rmMsg']): ExposedFn {
		return (reqBody: Buffer) => {
			const { id, cancelSending } = requestType.unpack(reqBody);
			const promise = fn(id, valOfOpt(cancelSending));
			return { promise };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): Delivery['rmMsg'] {
		const path = objPath.concat('rmMsg');
		return (id, cancelSending) => caller
		.startPromiseCall(path, requestType.pack({
			id, cancelSending: toOptVal(cancelSending)
		})) as Promise<void>;
	}

}
Object.freeze(rmMsg);


namespace observeAllDeliveries {

	interface Notif {
		id: string;
		progress: DeliveryProgressMsg;
	}

	const notifType = asmailType<Notif>('DeliveryNotificationWithId');

	export function wrapService(
		fn: Delivery['observeAllDeliveries']
	): ExposedFn {
		return () => {
			const s = new Subject<{ id: string; progress: DeliveryProgress; }>();
			const obs = s.asObservable().pipe(
				map(({ id, progress }) => notifType.pack({
					id,
					progress: packDeliveryProgress(progress)
				}))
			);
			const onCancel = fn(s);
			return { obs, onCancel };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): Delivery['observeAllDeliveries'] {
		const path = objPath.concat('observeAllDeliveries');
		return obs => {
			const s = new Subject<EnvelopeBody>();
			const unsub = caller.startObservableCall(path, undefined, s);
			s.subscribe({
				next: buf => {
					if (obs.next) {
						const { id, progress } = notifType.unpack(buf);
						obs.next({
							id,
							progress: unpackDeliveryProgress(progress)
						});
					}
				},
				complete: obs.complete,
				error: obs.error
			});
			return unsub;
		};
	}

}
Object.freeze(observeAllDeliveries);


namespace observeDelivery {

	interface Request {
		id: string;
	}

	const requestType = asmailType<Request>('ObserveDeliveryRequestBody');

	export function wrapService(fn: Delivery['observeDelivery']): ExposedFn {
		return buf => {
			const { id } = requestType.unpack(buf);
			const s = new Subject<DeliveryProgress>();
			const obs = s.asObservable().pipe(
				map(p => deliveryProgressMsgType.pack(packDeliveryProgress(p)))
			);
			const onCancel = fn(id, s);
			return { obs, onCancel };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): Delivery['observeDelivery'] {
		const path = objPath.concat('observeDelivery');
		return (id, obs) => {
			const s = new Subject<EnvelopeBody>();
			const unsub = caller.startObservableCall(
				path, requestType.pack({ id }), s);
			s.subscribe({
				next: buf => {
					if (obs.next) {
						const msg = deliveryProgressMsgType.unpack(buf);
						obs.next(unpackDeliveryProgress(msg));
					}
				},
				complete: obs.complete,
				error: obs.error
			});
			return unsub;
		};
	}

}
Object.freeze(observeDelivery);


Object.freeze(exports);