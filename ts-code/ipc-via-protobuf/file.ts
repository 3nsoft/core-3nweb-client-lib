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

import { ObjectReference, ProtoType, strArrValType, objRefType, fixInt, fixArray, Value, toOptVal, toVal, valOfOpt, valOfOptInt, toOptJson, valOf, valOfOptJson, packInt, unpackInt } from "./protobuf-msg";
import { checkRefObjTypeIs, ExposedFn, makeIPCException, EnvelopeBody, ExposedObj, Caller, ExposedServices } from "./connector";
import { errWithCause } from "../lib-common/exceptions/error";
import { exposeSrcService, makeSrcCaller, exposeSinkService, makeSinkCaller } from "./bytes";
import { Subject } from "rxjs";
import { map } from "rxjs/operators";

type ReadonlyFile = web3n.files.ReadonlyFile;
type ReadonlyFileVersionedAPI = web3n.files.ReadonlyFileVersionedAPI;
type WritableFile = web3n.files.WritableFile;
type WritableFileVersionedAPI = web3n.files.WritableFileVersionedAPI;
type File = web3n.files.File;
type Stats = web3n.files.Stats;
type XAttrsChanges = web3n.files.XAttrsChanges;
type FileEvent = web3n.files.FileEvent;
type SyncedEvent = web3n.files.SyncedEvent;
type UnsyncedEvent = web3n.files.UnsyncedEvent;
type ConflictEvent = web3n.files.ConflictEvent;

export function makeFileCaller(
	caller: Caller, fileMsg: FileMsg
): File {
	checkRefObjTypeIs('FileImpl', fileMsg.impl);
	const objPath = fileMsg.impl.path;
	const file = {
		writable: fileMsg.writable,
		isNew: fileMsg.isNew,
		name: fileMsg.name,
		getByteSource: getByteSource.makeCaller(caller, objPath),
		getXAttr: getXAttr.makeCaller(caller, objPath),
		listXAttrs: listXAttrs.makeCaller(caller, objPath),
		readBytes: readBytes.makeCaller(caller, objPath),
		readJSON: readJSON.makeCaller(caller, objPath),
		readTxt: readTxt.makeCaller(caller, objPath),
		watch: watch.makeCaller(caller, objPath),
		stat: stat.makeCaller(caller, objPath)
	} as WritableFile;
	if (file.writable) {
		file.copy = copy.makeCaller(caller, objPath);
		file.getByteSink = getByteSink.makeCaller(caller, objPath);
		file.updateXAttrs = updateXAttrs.makeCaller(caller, objPath);
		file.writeBytes = writeBytes.makeCaller(caller, objPath);
		file.writeJSON = writeJSON.makeCaller(caller, objPath);
		file.writeTxt = writeTxt.makeCaller(caller, objPath);
	}
	if (fileMsg.isVersioned) {
		const vPath = objPath.concat('v');
		file.v = {
			getByteSource: vGetByteSource.makeCaller(caller, vPath),
			getXAttr: vGetXAttr.makeCaller(caller, vPath),
			listXAttrs: vListXAttrs.makeCaller(caller, vPath),
			readBytes: vReadBytes.makeCaller(caller, vPath),
			readJSON: vReadJSON.makeCaller(caller, vPath),
			readTxt: vReadTxt.makeCaller(caller, vPath),
		} as WritableFileVersionedAPI;
		if (file.writable) {
			file.v.copy = vCopy.makeCaller(caller, vPath);
			file.v.getByteSink = vGetByteSink.makeCaller(caller, vPath);
			file.v.updateXAttrs = vUpdateXAttrs.makeCaller(caller, vPath);
			file.v.writeBytes = vWriteBytes.makeCaller(caller, vPath);
			file.v.writeJSON = vWriteJSON.makeCaller(caller, vPath);
			file.v.writeTxt = vWriteTxt.makeCaller(caller, vPath);
		}
	}
	caller.registerClientDrop(file, fileMsg.impl);
	return file;
}

export function exposeFileService(
	file: File, expServices: ExposedServices
): FileMsg {
	const implExp = {
		getByteSource: getByteSource.wrapService(file.getByteSource, expServices),
		getXAttr: getXAttr.wrapService(file.getXAttr),
		listXAttrs: listXAttrs.wrapService(file.listXAttrs),
		readBytes: readBytes.wrapService(file.readBytes),
		readJSON: readJSON.wrapService(file.readJSON),
		readTxt: readTxt.wrapService(file.readTxt),
		watch: watch.wrapService(file.watch),
		stat: stat.wrapService(file.stat)
	} as ExposedObj<WritableFile>;
	if (file.writable) {
		implExp.copy = copy.wrapService(
			(file as WritableFile).copy, expServices);
		implExp.getByteSink = getByteSink.wrapService(
			(file as WritableFile).getByteSink, expServices);
		implExp.updateXAttrs = updateXAttrs.wrapService(
			(file as WritableFile).updateXAttrs);
		implExp.writeBytes = writeBytes.wrapService(
			(file as WritableFile).writeBytes);
		implExp.writeJSON = writeJSON.wrapService(
			(file as WritableFile).writeJSON);
		implExp.writeTxt = writeTxt.wrapService((file as WritableFile).writeTxt);
	}
	if (file.v) {
		implExp.v = {
			getByteSource: vGetByteSource.wrapService(
				file.v.getByteSource, expServices),
			getXAttr: vGetXAttr.wrapService(file.v.getXAttr),
			listXAttrs: vListXAttrs.wrapService(file.v.listXAttrs),
			readBytes: vReadBytes.wrapService(file.v.readBytes),
			readJSON: vReadJSON.wrapService(file.v.readJSON),
			readTxt: vReadTxt.wrapService(file.v.readTxt)
		} as ExposedObj<WritableFileVersionedAPI>;
		if (file.writable) {
			implExp.copy = vCopy.wrapService(
				(file.v as WritableFileVersionedAPI).copy, expServices);
			implExp.getByteSink = vGetByteSink.wrapService(
				(file.v as WritableFileVersionedAPI).getByteSink, expServices);
			implExp.updateXAttrs = vUpdateXAttrs.wrapService(
				(file.v as WritableFileVersionedAPI).updateXAttrs);
			implExp.writeBytes = vWriteBytes.wrapService(
				(file.v as WritableFileVersionedAPI).writeBytes);
			implExp.writeJSON = vWriteJSON.wrapService(
				(file.v as WritableFileVersionedAPI).writeJSON);
			implExp.writeTxt = vWriteTxt.wrapService(
				(file.v as WritableFileVersionedAPI).writeTxt);
		}
	}
	const impl = expServices.exposeDroppableService('FileImpl', implExp, file);
	const fileMsg: FileMsg = {
		impl,
		isNew: file.isNew,
		name: file.name,
		writable: file.writable,
		isVersioned: !!file.v
	};
	return fileMsg;
}

function makeFileType<T extends object>(type: string): ProtoType<T> {
	return ProtoType.makeFrom<T>('file.proto', `file.${type}`);
}

export const fileMsgType = makeFileType<FileMsg>('File');

interface StatsMsg {
	isFile?: Value<boolean>;
	isFolder?: Value<boolean>;
	isLink?: Value<boolean>;
	writable: boolean;
	size?: Value<number>;
	mtime?: Value<number>;
	ctime?: Value<number>;
	version?: Value<number>;
}

const statsMsgType = makeFileType<StatsMsg>('StatsMsg');

export function packStats(s: Stats): Buffer {
	const msg: StatsMsg = {
		writable: s.writable,
		isFile: toOptVal(s.isFile),
		isFolder: toOptVal(s.isFolder),
		isLink: toOptVal(s.isLink),
		ctime: (s.ctime ? toVal(s.ctime.valueOf()) : undefined),
		mtime: (s.mtime ? toVal(s.mtime.valueOf()) : undefined),
		size: toOptVal(s.size),
		version: toOptVal(s.version)
	};
	return statsMsgType.pack(msg);
}

export function unpackStats(buf: Buffer|void): Stats {
	const m = statsMsgType.unpack(buf);
	return {
		writable: m.writable,
		isFile: valOfOpt(m.isFile),
		isFolder: valOfOpt(m.isFolder),
		isLink: valOfOpt(m.isLink),
		size: valOfOptInt(m.size),
		version: valOfOptInt(m.version),
		ctime: (m.ctime ? new Date(valOfOptInt(m.ctime)!) : undefined),
		mtime: (m.mtime ? new Date(valOfOptInt(m.mtime)!) : undefined),
	};
}

export interface FileMsg {
	writable: boolean;
	isVersioned: boolean;
	name: string;
	isNew: boolean;
	impl: ObjectReference;
}

const fileType = makeFileType<FileMsg>('File');


namespace stat {

	export function wrapService(fn: ReadonlyFile['stat']): ExposedFn {
		return () => {
			const promise = fn()
			.then(packStats);
			return { promise };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): ReadonlyFile['stat'] {
		const path = objPath.concat('stat');
		return () => caller
		.startPromiseCall(path, undefined)
		.then(unpackStats);
	}

}
Object.freeze(stat);


interface XAttrValue {
	str?: Value<string>;
	json?: Value<string>;
	bytes?: Value<Buffer>;
}

const xattrValueType = makeFileType<XAttrValue>('XAttrValue');

export function packXAttrValue(val: any): EnvelopeBody {
	if (Buffer.isBuffer(val)) {
		return xattrValueType.pack({ bytes: toVal(val) });
	} else if (typeof val === 'string') {
		return xattrValueType.pack({ str: toVal(val) });
	} else {
		return xattrValueType.pack({ json: toOptJson(val) });
	}
}

export function unpackXAttrValue(buf: EnvelopeBody): any {
	const { json, str, bytes } = xattrValueType.unpack(buf);
	if (bytes) {
		return valOf(bytes);
	} else if (str) {
		return valOf(str);
	} else {
		return valOfOptJson(json);
	}
}


namespace getXAttr {

	interface Request {
		xaName: string;
	}

	const requestType = makeFileType<Request>('GetXAttrRequestBody');

	export function wrapService(fn: ReadonlyFile['getXAttr']): ExposedFn {
		return buf => {
			const { xaName } = requestType.unpack(buf);
			const promise = fn(xaName)
			.then(packXAttrValue);
			return { promise };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): ReadonlyFile['getXAttr'] {
		const path = objPath.concat('getXAttr');
		return () => caller
		.startPromiseCall(path, undefined)
		.then(unpackXAttrValue);
	}

}
Object.freeze(getXAttr);


namespace listXAttrs {

	export function wrapService(fn: ReadonlyFile['listXAttrs']): ExposedFn {
		return () => {
			const promise = fn()
			.then(lst => strArrValType.pack({ values: lst }));
			return { promise };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): ReadonlyFile['listXAttrs'] {
		const path = objPath.concat('listXAttrs');
		return () => caller
		.startPromiseCall(path, undefined)
		.then(buf => fixArray(strArrValType.unpack(buf).values));
	}

}
Object.freeze(listXAttrs);


export namespace readBytes {

	interface Request {
		start?: Value<number>;
		end?: Value<number>;
	}

	interface Reply {
		bytes?: Value<Uint8Array>;
	}

	const requestType = makeFileType<Request>('ReadBytesRequestBody');

	const replyType = makeFileType<Reply>('ReadBytesReplyBody');

	export function packReply(bytes?: Uint8Array): EnvelopeBody {
		return replyType.pack({ bytes: toOptVal(bytes) });
	}

	export function unpackReply(buf: EnvelopeBody): Uint8Array|undefined {
		return valOfOpt(replyType.unpack(buf).bytes);
	}

	export function wrapService(fn: ReadonlyFile['readBytes']): ExposedFn {
		return buf => {
			const { start, end } = requestType.unpack(buf);
			const promise = fn(valOfOptInt(start), valOfOptInt(end))
			.then(packReply);
			return { promise };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): ReadonlyFile['readBytes'] {
		const path = objPath.concat('readBytes');
		return (start, end) => caller
		.startPromiseCall(path, requestType.pack({
			start: toOptVal(start), end: toOptVal(end)
		}))
		.then(unpackReply);
	}

}
Object.freeze(readBytes);


namespace readTxt {

	export function wrapService(fn: ReadonlyFile['readTxt']): ExposedFn {
		return () => {
			const promise = fn()
			.then(txt => Buffer.from(txt, 'utf8'));
			return { promise };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): ReadonlyFile['readTxt'] {
		const path = objPath.concat('readTxt');
		return () => caller
		.startPromiseCall(path, undefined)
		.then(buf => (buf ? buf.toString('utf8') : ''));
	}

}
Object.freeze(readTxt);


export function packJSON(json: any): EnvelopeBody {
	return Buffer.from(JSON.stringify(json), 'utf8');
}

export function unpackJSON(buf: EnvelopeBody): any {
	if (!buf) { throw makeIPCException({ missingBodyBytes: true }); }
	try {
		return JSON.parse(buf.toString('utf8'));
	} catch (err) {
		throw errWithCause(err, `Can't parse ipc reply as json`);
	}
}


namespace readJSON {

	export function wrapService(fn: ReadonlyFile['readJSON']): ExposedFn {
		return () => {
			const promise = fn()
			.then(packJSON);
			return { promise };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): ReadonlyFile['readJSON'] {
		const path = objPath.concat('readJSON');
		return () => caller
		.startPromiseCall(path, undefined)
		.then(unpackJSON);
	}

}
Object.freeze(readJSON);


namespace getByteSource {

	export function wrapService(
		fn: ReadonlyFile['getByteSource'], expServices: ExposedServices
	): ExposedFn {
		return () => {
			const promise = fn()
			.then(src => {
				const ref = exposeSrcService(src, expServices);
				return objRefType.pack(ref);
			});
			return { promise };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): ReadonlyFile['getByteSource'] {
		const path = objPath.concat('getByteSource');
		return () => caller
		.startPromiseCall(path, undefined)
		.then(buf => {
			const ref = objRefType.unpack(buf);
			return makeSrcCaller(caller, ref);
		});
	}

}
Object.freeze(getByteSource);


interface FileEventMsg {
	type: string;
	path: string;
	isRemote?: Value<boolean>;
	newVersion?: Value<number>;
	current?: Value<number>;
	lastSynced?: Value<number>;
	remoteVersion?: Value<number>;
}

const fileEventType = makeFileType<FileEventMsg>('FileEventMsg');

export function packFileEvent(e: FileEvent): Buffer {
	const msg: FileEventMsg = {
		type: e.type,
		path: e.path,
		isRemote: toOptVal(e.isRemote),
		newVersion: toOptVal(e.newVersion),
		current: toOptVal((e as SyncedEvent).current),
		lastSynced: toOptVal((e as UnsyncedEvent).lastSynced),
		remoteVersion: toOptVal((e as ConflictEvent).remoteVersion)
	};
	return fileEventType.pack(msg);
}

export function unpackFileEvent(buf: EnvelopeBody): FileEvent {
	const m = fileEventType.unpack(buf);
	return {
		type: m.type,
		path: m.path,
		isRemote: valOfOpt(m.isRemote),
		newVersion: valOfOptInt(m.newVersion),
		current: valOfOptInt(m.current),
		lastSynced: valOfOptInt(m.lastSynced),
		remoteVersion: valOfOptInt(m.remoteVersion)
	} as FileEvent;
}


namespace watch {

	export function wrapService(fn: ReadonlyFile['watch']): ExposedFn {
		return buf => {
			const s = new Subject<FileEvent>();
			const obs = s.asObservable().pipe(
				map(packFileEvent)
			);
			const onCancel = fn(s);
			return { obs, onCancel };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): ReadonlyFile['watch'] {
		const path = objPath.concat('watch');
		return obs => {
			const s = new Subject<EnvelopeBody>();
			const unsub = caller.startObservableCall(path, undefined, s);
			s.subscribe({
				next: buf => {
					if (obs.next) {
						obs.next(unpackFileEvent(buf));
					}
				},
				complete: obs.complete,
				error: obs.error
			});
			return unsub;
		};
	}
	
}
Object.freeze(watch);


export namespace vGetXAttr {

	interface Request {
		xaName: string;
	}

	const requestType = makeFileType<Request>('GetXAttrRequestBody');

	export interface Reply {
		version: number;
		str?: Value<string>;
		json?: Value<string>;
		bytes?: Value<Buffer>;
	}

	export const replyType = makeFileType<Reply>('VersionedGetXAttrReplyBody');

	export function wrapService(
		fn: ReadonlyFileVersionedAPI['getXAttr']
	): ExposedFn {
		return buf => {
			const { xaName } = requestType.unpack(buf);
			const promise = fn(xaName)
			.then(({ attr, version }) => {
				if (Buffer.isBuffer(attr)) {
					return replyType.pack({ version, bytes: toVal(attr) });
				} else if (typeof attr === 'string') {
					return replyType.pack({ version, str: toVal(attr) });
				} else {
					return replyType.pack({ version, json: toOptJson(attr) });
				}
			});
			return { promise };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): ReadonlyFileVersionedAPI['getXAttr'] {
		const path = objPath.concat('getXAttr');
		return () => caller
		.startPromiseCall(path, undefined)
		.then(buf => {
			const { json, str, bytes, version: v } = replyType.unpack(buf);
			const version = fixInt(v);
			if (bytes) {
				return { version, attr: valOf(bytes) };
			} else if (str) {
				return { version, attr: valOf(str) };
			} else {
				return { version, attr: valOfOptJson(json) };
			}
		});
	}

}
Object.freeze(vGetXAttr);


export namespace vListXAttrs {

	export interface Reply {
		version: number;
		xaNames: string[];
	}

	export const replyType = makeFileType<Reply>('VersionedListXAttrsReplyBody');

	export function wrapService(
		fn: ReadonlyFileVersionedAPI['listXAttrs']
	): ExposedFn {
		return () => {
			const promise = fn()
			.then(({ version, lst }) => replyType.pack({ version, xaNames: lst }));
			return { promise };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): ReadonlyFileVersionedAPI['listXAttrs'] {
		const path = objPath.concat('listXAttrs');
		return () => caller
		.startPromiseCall(path, undefined)
		.then(buf => {
			const { xaNames, version: v } = replyType.unpack(buf);
			return { version: fixInt(v), lst: (xaNames ? xaNames : []) };
		});
	}

}
Object.freeze(vListXAttrs);


export namespace vReadBytes {

	interface Request {
		start?: Value<number>;
		end?: Value<number>;
	}

	const requestType = makeFileType<Request>('ReadBytesRequestBody');

	interface Reply {
		version: number;
		bytes?: Value<Uint8Array>;
	}

	const replyType = makeFileType<Reply>('VersionedReadBytesReplyBody');

	export function packReply(
		r: { version: number; bytes?: Uint8Array; }
	): EnvelopeBody {
		return replyType.pack({
			version: r.version, bytes: toOptVal(r.bytes)
		});
	}

	export function unpackReply(
		buf: EnvelopeBody
	): { version: number; bytes: Uint8Array|undefined; } {
		const { version: v, bytes: b } = replyType.unpack(buf);
		return { version: fixInt(v), bytes: valOfOpt(b) };
}

	export function wrapService(
		fn: ReadonlyFileVersionedAPI['readBytes']
	): ExposedFn {
		return buf => {
			const { start, end } = requestType.unpack(buf);
			const promise = fn(valOfOptInt(start), valOfOptInt(end))
			.then(packReply);
			return { promise };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): ReadonlyFileVersionedAPI['readBytes'] {
		const path = objPath.concat('readBytes');
		return (start, end) => caller
		.startPromiseCall(path, requestType.pack({
			start: toOptVal(start), end: toOptVal(end)
		}))
		.then(unpackReply);
	}

}
Object.freeze(vReadBytes);


export namespace vReadTxt {

	export interface Reply {
		version: number;
		txt: string;
	}

	export const replyType = makeFileType<Reply>('VersionedReadTxtReplyBody');

	export function wrapService(
		fn: ReadonlyFileVersionedAPI['readTxt']
	): ExposedFn {
		return () => {
			const promise = fn()
			.then(verAndTxt => replyType.pack(verAndTxt));
			return { promise };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): ReadonlyFileVersionedAPI['readTxt'] {
		const path = objPath.concat('readTxt');
		return () => caller
		.startPromiseCall(path, undefined)
		.then(buf => {
			const { version: v, txt } = replyType.unpack(buf);
			return { version: fixInt(v), txt };
		});
	}

}
Object.freeze(vReadTxt);


export namespace vReadJSON {

	export interface Reply {
		version: number;
		json: string;
	}

	export const replyType = makeFileType<Reply>('VersionedReadJsonReplyBody');

	export function wrapService(
		fn: ReadonlyFileVersionedAPI['readJSON']
	): ExposedFn {
		return () => {
			const promise = fn()
			.then(({ version, json }) => {
				return replyType.pack({ version, json: JSON.stringify(json) });
			});
			return { promise };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): ReadonlyFileVersionedAPI['readJSON'] {
		const path = objPath.concat('readJSON');
		return () => caller
		.startPromiseCall(path, undefined)
		.then(buf => {
			const { version: v, json } = replyType.unpack(buf);
			try {
				return { version: fixInt(v), json: JSON.parse(json) };
			} catch (err) {
				throw errWithCause(err, `Can't parse ipc reply as json`);
			}
		});
	}

}
Object.freeze(vReadJSON);


export namespace vGetByteSource {

	export interface Reply {
		version: number;
		src: ObjectReference;
	}

	export const replyType = makeFileType<Reply>(
		'VersionedGetByteSourceReplyBody');

	export function wrapService(
		fn: ReadonlyFileVersionedAPI['getByteSource'],
		expServices: ExposedServices
	): ExposedFn {
		return () => {
			const promise = fn()
			.then(({ version, src }) => {
				const ref = exposeSrcService(src, expServices);
				return replyType.pack({ version, src: ref });
			});
			return { promise };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): ReadonlyFileVersionedAPI['getByteSource'] {
		const path = objPath.concat('getByteSource');
		return () => caller
		.startPromiseCall(path, undefined)
		.then(buf => {
			const { version: v, src: ref } = replyType.unpack(buf);
			return { version: fixInt(v), src: makeSrcCaller(caller, ref) };
		});
	}

}
Object.freeze(vGetByteSource);


export namespace updateXAttrs {

	export interface Attr {
		xaName: string;
		str?: Value<string>;
		json?: Value<string>;
		bytes?: Value<Buffer>;
	}

	export interface Request {
		changes: {
			set: Attr[];
			remove: string[];
		};
	}
	
	const requestType = makeFileType<Request>('UpdateXAttrsRequestBody');

	export function fromReqChanges(r: Request['changes']): XAttrsChanges {
		const attrs: XAttrsChanges = {};
		if (r.set) {
			attrs.set = {};
			for (const attr of r.set) {
				if (attr.bytes) {
					attrs.set[attr.xaName] = valOf(attr.bytes);
				} else if (attr.str) {
					attrs.set[attr.xaName] = valOf(attr.str);
				} else {
					attrs.set[attr.xaName] = valOfOptJson(attr.json);
				}
			}
		}
		if (r.remove) {
			attrs.remove = r.remove;
		}
		return attrs;
	}

	export function unpackXAttrsChanges(buf: EnvelopeBody): XAttrsChanges {
		const { changes } = requestType.unpack(buf);
		return fromReqChanges(changes);
	}

	export function wrapService(fn: WritableFile['updateXAttrs']): ExposedFn {
		return buf => {
			const attrs = unpackXAttrsChanges(buf);
			const promise = fn(attrs);
			return { promise };
		};
	}

	export function toReqChanges(changes: XAttrsChanges): Request['changes'] {
		const r: Request['changes'] = {
			set: [],
			remove: (changes.remove ? changes.remove : [])
		};
		if (changes.set) {
			for (const [ xaName, val ] of Object.entries(changes.set)) {
				const attr: Attr = { xaName };
				if (Buffer.isBuffer(val)) {
					attr.bytes = toVal(val);
				} else if (typeof val === 'string') {
					attr.str = toVal(val);
				} else {
					attr.json = toOptJson(val);
				}
				r.set.push(attr);
			}
		}
		return r;
	}

	export function packXAttrsChanges(changes: XAttrsChanges): EnvelopeBody {
		return requestType.pack({ changes: toReqChanges(changes) });
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): WritableFile['updateXAttrs'] {
		const path = objPath.concat('updateXAttrs');
		return async changes => {
			await caller.startPromiseCall(path, packXAttrsChanges(changes));
		};
	}

}
Object.freeze(updateXAttrs);


namespace writeBytes {

	interface Request {
		bytes: Buffer;
	}

	const requestType = makeFileType<Request>('WriteBytesRequestBody');

	export function wrapService(fn: WritableFile['writeBytes']): ExposedFn {
		return buf => {
			const { bytes } = requestType.unpack(buf);
			const promise = fn(bytes);
			return { promise };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): WritableFile['writeBytes'] {
		const path = objPath.concat('writeBytes');
		return bytes => caller
		.startPromiseCall(path, requestType.pack({
			bytes: bytes as Buffer
		})) as Promise<void>;
	}

}
Object.freeze(writeBytes);


namespace writeTxt {

	interface Request {
		txt: string;
	}

	const requestType = makeFileType<Request>('WriteTxtRequestBody');

	export function wrapService(fn: WritableFile['writeTxt']): ExposedFn {
		return buf => {
			const { txt } = requestType.unpack(buf);
			const promise = fn(txt);
			return { promise };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): WritableFile['writeTxt'] {
		const path = objPath.concat('writeTxt');
		return txt => caller
		.startPromiseCall(path, requestType.pack({ txt })) as Promise<void>;
	}

}
Object.freeze(writeTxt);


namespace writeJSON {

	interface Request {
		json: string;
	}

	const requestType = makeFileType<Request>('WriteJsonRequestBody');

	export function wrapService(fn: WritableFile['writeJSON']): ExposedFn {
		return buf => {
			const { json } = requestType.unpack(buf);
			const promise = fn(JSON.parse(json));
			return { promise };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): WritableFile['writeJSON'] {
		const path = objPath.concat('writeJSON');
		return json => caller
		.startPromiseCall(path, requestType.pack({
			json: JSON.stringify(json)
		})) as Promise<void>;
	}

}
Object.freeze(writeJSON);


namespace getByteSink {

	interface Request {
		truncateFile?: Value<boolean>;
	}

	const requestType = makeFileType<Request>('GetByteSinkRequestBody');

	export function wrapService(
		fn: WritableFile['getByteSink'], expServices: ExposedServices
	): ExposedFn {
		return buf => {
			const { truncateFile } = requestType.unpack(buf);
			const promise = fn(valOfOpt(truncateFile))
			.then(sink => {
				const ref = exposeSinkService(sink, expServices);
				return objRefType.pack(ref);
			});
			return { promise };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): WritableFile['getByteSink'] {
		const path = objPath.concat('getByteSink');
		return truncateFile => caller
		.startPromiseCall(path, requestType.pack({
			truncateFile: toOptVal(truncateFile)
		}))
		.then(buf => {
			const ref = objRefType.unpack(buf);
			return makeSinkCaller(caller, ref);
		});
	}

}
Object.freeze(getByteSink);


namespace copy {

	interface Request {
		file: ObjectReference;
	}

	export const requestType = makeFileType<Request>('CopyRequestBody');

	export function wrapService(
		fn: WritableFile['copy'], expServices: ExposedServices
	): ExposedFn {
		return buf => {
			const { file: fRef } = requestType.unpack(buf);
			const file = expServices.getOriginalObj<File>(fRef);
			const promise = fn(file);
			return { promise };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): WritableFile['copy'] {
		const path = objPath.concat('copy');
		return async file => {
			const fRef = caller.srvRefOf(file);
			await caller
			.startPromiseCall(path, requestType.pack({ file: fRef }));
		}
	}

}
Object.freeze(copy);

namespace vCopy {

	export function wrapService(
		fn: WritableFileVersionedAPI['copy'], expServices: ExposedServices
	): ExposedFn {
		return buf => {
			const { file: fRef } = copy.requestType.unpack(buf);
			const file = expServices.getOriginalObj<File>(fRef);
			const promise = fn(file)
			.then(packInt);
			return { promise };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): WritableFileVersionedAPI['copy'] {
		const path = objPath.concat('copy');
		return file => {
			const fRef = caller.srvRefOf(file);
			return caller
			.startPromiseCall(path, copy.requestType.pack({ file: fRef }))
			.then(unpackInt);
		}
	}

}
Object.freeze(vCopy);


namespace vUpdateXAttrs {

	export function wrapService(
		fn: WritableFileVersionedAPI['updateXAttrs']
	): ExposedFn {
		return buf => {
			const attrs = updateXAttrs.unpackXAttrsChanges(buf);
			const promise = fn(attrs)
			.then(packInt);
			return { promise };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): WritableFileVersionedAPI['updateXAttrs'] {
		const path = objPath.concat('updateXAttrs');
		return changes => {
			const reqBody = updateXAttrs.packXAttrsChanges(changes);
			return caller.startPromiseCall(path, reqBody)
			.then(unpackInt);
		};
	}

}
Object.freeze(vUpdateXAttrs);


namespace vWriteBytes {

	interface Request {
		bytes: Buffer;
	}

	const requestType = makeFileType<Request>('WriteBytesRequestBody');

	export function wrapService(
		fn: WritableFileVersionedAPI['writeBytes']
	): ExposedFn {
		return buf => {
			const { bytes } = requestType.unpack(buf);
			const promise = fn(bytes)
			.then(packInt);
			return { promise };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): WritableFileVersionedAPI['writeBytes'] {
		const path = objPath.concat('writeBytes');
		return bytes => caller
		.startPromiseCall(path, requestType.pack({ bytes: bytes as Buffer }))
		.then(unpackInt);
	}

}
Object.freeze(vWriteBytes);


namespace vWriteTxt {

	interface Request {
		txt: string;
	}

	const requestType = makeFileType<Request>('WriteTxtRequestBody');

	export function wrapService(
		fn: WritableFileVersionedAPI['writeTxt']
	): ExposedFn {
		return buf => {
			const { txt } = requestType.unpack(buf);
			const promise = fn(txt)
			.then(packInt);
			return { promise };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): WritableFileVersionedAPI['writeTxt'] {
		const path = objPath.concat('writeTxt');
		return txt => caller
		.startPromiseCall(path, requestType.pack({ txt }))
		.then(unpackInt);
	}

}
Object.freeze(vWriteTxt);


namespace vWriteJSON {

	interface Request {
		json: string;
	}

	const requestType = makeFileType<Request>('WriteJsonRequestBody');

	export function wrapService(
		fn: WritableFileVersionedAPI['writeJSON']
	): ExposedFn {
		return buf => {
			const { json } = requestType.unpack(buf);
			const promise = fn(JSON.parse(json))
			.then(packInt);
			return { promise };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): WritableFileVersionedAPI['writeJSON'] {
		const path = objPath.concat('writeJSON');
		return json => caller
		.startPromiseCall(path, requestType.pack({ json: JSON.stringify(json) }))
		.then(unpackInt);
	}

}
Object.freeze(vWriteJSON);


export namespace vGetByteSink {

	interface Request {
		truncateFile?: Value<boolean>;
		currentVersion?: Value<number>;
	}

	const requestType = makeFileType<Request>('VersionedGetByteSinkRequestBody');

	export interface Reply {
		version: number;
		sink: ObjectReference;
	}

	export const replyType = makeFileType<Reply>(
		'VersionedGetByteSinkReplyBody');

	export function wrapService(
		fn: WritableFileVersionedAPI['getByteSink'], expServices: ExposedServices
	): ExposedFn {
		return buf => {
			const { truncateFile, currentVersion } = requestType.unpack(buf);
			const promise = fn(valOfOpt(truncateFile), valOfOptInt(currentVersion))
			.then(({ sink, version }) => {
				const ref = exposeSinkService(sink, expServices);
				return replyType.pack({ version, sink: ref });
			});
			return { promise };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): WritableFileVersionedAPI['getByteSink'] {
		const path = objPath.concat('getByteSink');
		return (truncateFile, currentVersion) => caller
		.startPromiseCall(path, requestType.pack({
			truncateFile: toOptVal(truncateFile),
			currentVersion: toOptVal(currentVersion)
		}))
		.then(buf => {
			const { version: v, sink: ref} = replyType.unpack(buf);
			return { version: fixInt(v), sink: makeSinkCaller(caller, ref) };
		});
	}

}
Object.freeze(vGetByteSink);


Object.freeze(exports);