/*
 Copyright (C) 2020, 2022 3NSoft Inc.
 
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

import { ObjectReference, boolValType, strArrValType, objRefType, fixInt, fixArray, Value, valOfOpt, toOptVal, toVal, valOfOptInt, valOf, packInt, unpackInt, decodeFromUtf8, encodeToUtf8 } from "./protobuf-msg";
import { ProtoType } from '../lib-client/protobuf-type';
import { fs as pb } from '../protos/fs.proto';
import { checkRefObjTypeIs, ExposedFn, ExposedObj, EnvelopeBody, makeIPCException, Caller, ExposedServices } from "./connector";
import { packStats, unpackStats, packXAttrValue, unpackXAttrValue, exposeFileService, FileMsg, makeFileCaller, packJSON, unpackJSON, fileMsgType, unpackFileEvent, packFileEvent } from "./file";
import * as file from "./file";
import { assert } from "../lib-common/assert";
import { exposeSrcService, makeSrcCaller, exposeSinkService, makeSinkCaller } from "./bytes";
import { Subject } from "rxjs";
import { defer, Deferred } from "../lib-common/processes/deferred";
import { map } from "rxjs/operators";
import { toRxObserver } from "../lib-common/utils-for-observables";

type ReadonlyFS = web3n.files.ReadonlyFS;
type ReadonlyFSVersionedAPI = web3n.files.ReadonlyFSVersionedAPI;
type WritableFS = web3n.files.WritableFS;
type WritableFSVersionedAPI = web3n.files.WritableFSVersionedAPI;
type FS = web3n.files.FS;
type File = web3n.files.File;
type WritableFile = web3n.files.WritableFile;
type FSEvent = web3n.files.FSEvent;
type EntryRemovalEvent = web3n.files.EntryRemovalEvent;
type EntryRenamingEvent = web3n.files.EntryRenamingEvent;
type EntryAdditionEvent = web3n.files.EntryAdditionEvent;
type SyncUploadEvent = web3n.files.SyncUploadEvent;
type FileEvent = web3n.files.FileEvent;
type SymLink = web3n.files.SymLink;
type ListingEntry = web3n.files.ListingEntry;
type XAttrsChanges = web3n.files.XAttrsChanges;
type FileFlags = web3n.files.FileFlags;
type VersionedFileFlags = web3n.files.VersionedFileFlags;
type SelectCriteria = web3n.files.SelectCriteria;
type FSItem = web3n.files.FSItem;
type FSCollection = web3n.files.FSCollection;
type CollectionEvent = web3n.files.CollectionEvent;

export function makeFSCaller(caller: Caller, fsMsg: FSMsg): FS {
	checkRefObjTypeIs('FSImpl', fsMsg.impl);
	const objPath = fsMsg.impl.path;
	const fs = {
		name: fsMsg.name,
		type: fsMsg.type,
		writable: fsMsg.writable,
		checkFilePresence: checkPresence.makeFileCaller(caller, objPath),
		checkFolderPresence: checkPresence.makeFolderCaller(caller, objPath),
		checkLinkPresence: checkPresence.makeLinkCaller(caller, objPath),
		close: close.makeCaller(caller, objPath),
		getByteSource: getByteSource.makeCaller(caller, objPath),
		getXAttr: getXAttr.makeCaller(caller, objPath),
		listXAttrs: listXAttrs.makeCaller(caller, objPath),
		listFolder: listFolder.makeCaller(caller, objPath),
		readBytes: readBytes.makeCaller(caller, objPath),
		readLink: readLink.makeCaller(caller, objPath),
		readJSONFile: readJSONFile.makeCaller(caller, objPath),
		readTxtFile: readTxtFile.makeCaller(caller, objPath),
		readonlyFile: readonlyFile.makeCaller(caller, objPath),
		readonlySubRoot: readonlySubRoot.makeCaller(caller, objPath),
		select: select.makeCaller(caller, objPath),
		stat: stat.makeCaller(caller, objPath),
		watchFolder: watch.makeFolderCaller(caller, objPath),
		watchFile: watch.makeFileCaller(caller, objPath),
		watchTree: watch.makeTreeCaller(caller, objPath),
	} as WritableFS;
	if (fsMsg.writable) {
		fs.copyFile = copyFile.makeCaller(caller, objPath);
		fs.copyFolder = copyFolder.makeCaller(caller, objPath);
		fs.deleteFile = deleteFile.makeCaller(caller, objPath);
		fs.deleteFolder = deleteFolder.makeCaller(caller, objPath);
		fs.deleteLink = deleteLink.makeCaller(caller, objPath);
		fs.getByteSink = getByteSink.makeCaller(caller, objPath);
		fs.link = link.makeCaller(caller, objPath);
		fs.makeFolder = makeFolder.makeCaller(caller, objPath);
		fs.move = move.makeCaller(caller, objPath);
		fs.saveFile = saveFile.makeCaller(caller, objPath);
		fs.saveFolder = saveFolder.makeCaller(caller, objPath);
		fs.updateXAttrs = updateXAttrs.makeCaller(caller, objPath);
		fs.writableFile = writableFile.makeCaller(caller, objPath);
		fs.writableSubRoot = writableSubRoot.makeCaller(caller, objPath);
		fs.writeBytes = writeBytes.makeCaller(caller, objPath);
		fs.writeJSONFile = writeJSONFile.makeCaller(caller, objPath);
		fs.writeTxtFile = writeTxtFile.makeCaller(caller, objPath);
	}
	if (fsMsg.isVersioned) {
		const vPath = objPath.concat('v');
		fs.v = {
			getByteSource: vGetByteSource.makeCaller(caller, vPath),
			getXAttr: vGetXAttr.makeCaller(caller, vPath),
			listXAttrs: vListXAttrs.makeCaller(caller, vPath),
			listFolder: vListFolder.makeCaller(caller, vPath),
			readBytes: vReadBytes.makeCaller(caller, vPath),
			readJSONFile: vReadJSONFile.makeCaller(caller, vPath),
			readTxtFile: vReadTxtFile.makeCaller(caller, vPath),
		} as WritableFSVersionedAPI;
		if (fsMsg.writable) {
			fs.v.getByteSink = vGetByteSink.makeCaller(caller, vPath);
			fs.v.writeBytes = vWriteBytes.makeCaller(caller, vPath);
			fs.v.writeJSONFile = vWriteJSONFile.makeCaller(caller, vPath);
			fs.v.writeTxtFile = vWriteTxtFile.makeCaller(caller, vPath);
			fs.v.updateXAttrs = vUpdateXAttrs.makeCaller(caller, vPath);
		}
	}
	caller.registerClientDrop(fs, fsMsg.impl);
	return fs;
}

export function exposeFSService(fs: FS, expServices: ExposedServices): FSMsg {
	const implExp = {
		checkFilePresence: checkPresence.wrapService(fs.checkFilePresence),
		checkFolderPresence: checkPresence.wrapService(fs.checkFolderPresence),
		checkLinkPresence: checkPresence.wrapService(fs.checkLinkPresence),
		close: close.wrapService(fs.close),
		getByteSource: getByteSource.wrapService(fs.getByteSource, expServices),
		getXAttr: getXAttr.wrapService(fs.getXAttr),
		listXAttrs: listXAttrs.wrapService(fs.listXAttrs),
		listFolder: listFolder.wrapService(fs.listFolder),
		readBytes: readBytes.wrapService(fs.readBytes),
		readLink: readLink.wrapService(fs.readLink, expServices),
		readJSONFile: readJSONFile.wrapService(fs.readJSONFile),
		readTxtFile: readTxtFile.wrapService(fs.readTxtFile),
		readonlyFile: readonlyFile.wrapService(fs.readonlyFile, expServices),
		readonlySubRoot: readonlySubRoot.wrapService(
			fs.readonlySubRoot, expServices),
		select: select.wrapService(fs.select, expServices),
		stat: stat.wrapService(fs.stat),
		watchFolder: watch.wrapService(fs.watchFolder, packFSEvent),
		watchFile: watch.wrapService(fs.watchFile, packFileEvent),
		watchTree: watch.wrapService(fs.watchTree, packFSEvent),
	} as ExposedObj<WritableFS>;
	if (fs.writable) {
		implExp.copyFile = copyFile.wrapService((fs as WritableFS).copyFile);
		implExp.copyFolder = copyFolder.wrapService(
			(fs as WritableFS).copyFolder);
		implExp.deleteFile = deleteFile.wrapService(
			(fs as WritableFS).deleteFile);
		implExp.deleteFolder = deleteFolder.wrapService(
			(fs as WritableFS).deleteFolder);
		implExp.deleteLink = deleteLink.wrapService(
			(fs as WritableFS).deleteLink);
		implExp.getByteSink = getByteSink.wrapService(
			(fs as WritableFS).getByteSink, expServices);
		implExp.link = link.wrapService((fs as WritableFS).link, expServices);
		implExp.makeFolder = makeFolder.wrapService(
			(fs as WritableFS).makeFolder);
		implExp.move = move.wrapService((fs as WritableFS).move);
		implExp.saveFile = saveFile.wrapService(
			(fs as WritableFS).saveFile, expServices);
		implExp.saveFolder = saveFolder.wrapService(
			(fs as WritableFS).saveFolder, expServices);
		implExp.updateXAttrs = updateXAttrs.wrapService(
			(fs as WritableFS).updateXAttrs);
		implExp.writableFile = writableFile.wrapService(
			(fs as WritableFS).writableFile, expServices);
		implExp.writableSubRoot = writableSubRoot.wrapService(
			(fs as WritableFS).writableSubRoot, expServices);
		implExp.writeBytes = writeBytes.wrapService(
			(fs as WritableFS).writeBytes);
		implExp.writeJSONFile = writeJSONFile.wrapService(
			(fs as WritableFS).writeJSONFile);
		implExp.writeTxtFile = writeTxtFile.wrapService(
			(fs as WritableFS).writeTxtFile);
	}
	if (fs.v) {
		implExp.v = {
			getByteSource: vGetByteSource.wrapService(
				fs.v.getByteSource, expServices),
			getXAttr: vGetXAttr.wrapService(fs.v.getXAttr),
			listXAttrs: vListXAttrs.wrapService(fs.v.listXAttrs),
			listFolder: vListFolder.wrapService(fs.v.listFolder),
			readBytes: vReadBytes.wrapService(fs.v.readBytes),
			readJSONFile: vReadJSONFile.wrapService(fs.v.readJSONFile),
			readTxtFile: vReadTxtFile.wrapService(fs.v.readTxtFile),
		} as ExposedObj<WritableFSVersionedAPI>;
		if (fs.writable) {
			implExp.v.getByteSink = vGetByteSink.wrapService(
				(fs.v as WritableFSVersionedAPI).getByteSink, expServices);
			implExp.v.writeBytes = vWriteBytes.wrapService(
				(fs.v as WritableFSVersionedAPI).writeBytes);
			implExp.v.writeJSONFile = vWriteJSONFile.wrapService(
				(fs.v as WritableFSVersionedAPI).writeJSONFile);
			implExp.v.writeTxtFile = vWriteTxtFile.wrapService(
				(fs.v as WritableFSVersionedAPI).writeTxtFile);
			implExp.v.updateXAttrs = vUpdateXAttrs.wrapService(
				(fs.v as WritableFSVersionedAPI).updateXAttrs);
		}
	}
	const impl = expServices.exposeDroppableService<'FSImpl'>(
		'FSImpl', implExp, fs);
	const fsMsg: FSMsg = {
		impl,
		isVersioned: !!fs.v,
		name: fs.name,
		type: fs.type,
		writable: fs.writable
	};
	return fsMsg;
}

export interface FSMsg {
	type: string;
	isVersioned: boolean;
	writable: boolean;
	name: string;
	impl: ObjectReference<'FSImpl'>;
}

export const fsMsgType = ProtoType.for<FSMsg>(pb.FS);


namespace checkPresence {

	interface Request {
		path: string;
		throwIfMissing?: Value<boolean>;
	}

	const requestType = ProtoType.for<Request>(pb.CheckPresenceRequestBody);

	export function wrapService(fn: ReadonlyFS['checkFilePresence']): ExposedFn {
		return buf => {
			const { path, throwIfMissing } = requestType.unpack(buf);
			const promise = fn(path, valOfOpt(throwIfMissing))
			.then(found => boolValType.pack({ value: found }));
			return { promise };
		};
	}

	function makeCaller(
		caller: Caller, objPath: string[]
	): ReadonlyFS['checkFilePresence'] {
		return (path, throwIfMissing) => caller
		.startPromiseCall(objPath, requestType.pack({
			path, throwIfMissing: toOptVal(throwIfMissing)
		}))
		.then(buf => boolValType.unpack(buf).value);
	}

	export function makeFileCaller(
		caller: Caller, objPath: string[]
	): ReadonlyFS['checkFilePresence'] {
		return makeCaller(caller, objPath.concat('checkFilePresence'));
	}

	export function makeFolderCaller(
		caller: Caller, objPath: string[]
	): ReadonlyFS['checkFolderPresence'] {
		return makeCaller(caller, objPath.concat('checkFolderPresence'));
	}

	export function makeLinkCaller(
		caller: Caller, objPath: string[]
	): ReadonlyFS['checkLinkPresence'] {
		return makeCaller(caller, objPath.concat('checkLinkPresence'));
	}

}
Object.freeze(checkPresence);


interface RequestWithPath {
	path: string;
}

const reqWithPathType = ProtoType.for<RequestWithPath>(pb.PathOnlyRequestBody);


namespace stat {

	export function wrapService(fn: ReadonlyFS['stat']): ExposedFn {
		return buf => {
			const { path } = reqWithPathType.unpack(buf);
			const promise = fn(path)
			.then(packStats);
			return { promise };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): ReadonlyFS['stat'] {
		const ipcPath = objPath.concat('stat');
		return path => caller
		.startPromiseCall(ipcPath, reqWithPathType.pack({ path }))
		.then(unpackStats);
	}

}
Object.freeze(stat);


namespace getXAttr {

	export interface Request {
		path: string;
		xaName: string;
	}

	export const requestType = ProtoType.for<Request>(pb.GetXAttrRequestBody);

	export function wrapService(fn: ReadonlyFS['getXAttr']): ExposedFn {
		return buf => {
			const { path, xaName } = requestType.unpack(buf);
			const promise = fn(path, xaName)
			.then(packXAttrValue);
			return { promise };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): ReadonlyFS['getXAttr'] {
		const ipcPath = objPath.concat('getXAttr');
		return (path, xaName) => caller
		.startPromiseCall(ipcPath, requestType.pack({ path, xaName }))
		.then(unpackXAttrValue);
	}

}
Object.freeze(getXAttr);


namespace listXAttrs {

	export function wrapService(fn: ReadonlyFS['listXAttrs']): ExposedFn {
		return buf => {
			const { path } = reqWithPathType.unpack(buf);
			const promise = fn(path)
			.then(lst => strArrValType.pack({ values: lst }));
			return { promise };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): ReadonlyFS['listXAttrs'] {
		const ipcPath = objPath.concat('listXAttrs');
		return path => caller
		.startPromiseCall(ipcPath, reqWithPathType.pack({ path }))
		.then(buf => fixArray(strArrValType.unpack(buf).values));
	}

}
Object.freeze(listXAttrs);


interface SymLinkMsg {
	readonly: boolean;
	isFile?: Value<boolean>;
	isFolder?: Value<boolean>;
	impl: ObjectReference<'SymLinkImpl'>;
}
const symLinkMsgType = ProtoType.for<SymLinkMsg>(pb.SymLink);

interface SymLinkTarget {
	fs?: FSMsg;
	file?: FileMsg;
}
const symLinkTargetType = ProtoType.for<SymLinkTarget>(
	pb.SymLinkTargetReplyBody);

function exposeSymLink(
	link: SymLink, expServices: ExposedServices
): SymLinkMsg {
	const exp: ExposedFn = () => {
		if (link.isFile) {
			const promise = link.target()
			.then(f => {
				const file = exposeFileService(f as File, expServices);
				return symLinkTargetType.pack({ file });
			});
			return { promise };
		} else if (link.isFolder) {
			const promise = link.target()
			.then(f => {
				const fs = exposeFSService(f as FS, expServices);
				return symLinkTargetType.pack({ fs });
			});
			return { promise };
		} else {
			assert(false);
		}
	};
	const ref = expServices.exposeDroppableService<'SymLinkImpl'>(
		'SymLinkImpl', exp, link);
	const msg: SymLinkMsg = {
		readonly: link.readonly,
		isFile: toOptVal(link.isFile),
		isFolder: toOptVal(link.isFolder),
		impl: ref
	};
	return msg;
}

function makeSymLinkCaller(
	caller: Caller, linkMsg: SymLinkMsg
): SymLink {
	checkRefObjTypeIs('SymLinkImpl', linkMsg.impl);
	const link: SymLink = {
		readonly: linkMsg.readonly,
		target: () => caller
		.startPromiseCall(linkMsg.impl.path, undefined)
		.then(buf => {
			const { file, fs } = symLinkTargetType.unpack(buf);
			if (file) {
				return makeFileCaller(caller, file);
			} else if (fs) {
				return makeFSCaller(caller, fs);
			} else {
				throw new Error('Missing target info');
			}
		}),
		isFile: valOfOpt(linkMsg.isFile),
		isFolder: valOfOpt(linkMsg.isFolder)
	};
	return link;
}


namespace readLink {

	export function wrapService(
		fn: ReadonlyFS['readLink'], expServices: ExposedServices
	): ExposedFn {
		return buf => {
			const { path } = reqWithPathType.unpack(buf);
			const promise = fn(path)
			.then(link => {
				const msg = exposeSymLink(link, expServices);
				return symLinkMsgType.pack(msg);
			});
			return { promise };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): ReadonlyFS['readLink'] {
		const ipcPath = objPath.concat('readLink');
		return path => caller
		.startPromiseCall(ipcPath, reqWithPathType.pack({ path }))
		.then(buf => {
			const linkMsg = symLinkMsgType.unpack(buf);
			return makeSymLinkCaller(caller, linkMsg);
		});
	}

}
Object.freeze(readLink);


interface FSEventMsg {
	type: string;
	path: string;
	isRemote?: Value<boolean>;
	newVersion?: Value<number>;
	name?: Value<string>;
	oldName?: Value<string>;
	newName?: Value<string>;
	entry?: ListingEntryMsg;
	current?: Value<number>;
	uploaded?: Value<number>;
	moveLabel?: Value<number>;
}

const fsEventMsgType = ProtoType.for<FSEventMsg>(pb.FSEventMsg);

function packFSEvent(e: FSEvent): Buffer {
	const m: FSEventMsg = {
		type: e.type,
		path: e.path,
		isRemote: toOptVal(e.isRemote),
		newVersion: toOptVal(e.newVersion),
		name: toOptVal((e as EntryRemovalEvent).name),
		oldName: toOptVal((e as EntryRenamingEvent).oldName),
		newName: toOptVal((e as EntryRenamingEvent).newName),
		entry: ((e as EntryAdditionEvent).entry ?
			lsEntryToMsg((e as EntryAdditionEvent).entry) : undefined),
		current: toOptVal((e as SyncUploadEvent).current),
		uploaded: toOptVal((e as SyncUploadEvent).uploaded),
		moveLabel: toOptVal((e as EntryAdditionEvent).moveLabel)
	};
	return fsEventMsgType.pack(m);
}

function unpackFSEvent(buf: EnvelopeBody): FSEvent {
	const m = fsEventMsgType.unpack(buf);
	const event = {
		type: m.type,
		path: m.path,
		isRemote: valOfOpt(m.isRemote),
		newVersion: valOfOptInt(m.newVersion),
		name: valOfOpt(m.name),
		oldName: valOfOpt(m.oldName),
		newName: valOfOpt(m.newName),
		entry: (m.entry ? lsEntryFromMsg(m.entry): undefined),
		current: valOfOptInt(m.current),
		uploaded: valOfOptInt(m.uploaded),
		moveLabel: valOfOptInt(m.moveLabel)
	} as FSEvent;
	return event;
}

interface ListingEntryMsg {
	name: string;
	isFile?: Value<boolean>;
	isFolder?: Value<boolean>;
	isLink?: Value<boolean>;
}

function lsEntryToMsg(e: ListingEntry): ListingEntryMsg {
	return {
		name: e.name,
		isFile: toOptVal(e.isFile),
		isFolder: toOptVal(e.isFolder),
		isLink: toOptVal(e.isLink)
	};
}

function lsEntryFromMsg(m: ListingEntryMsg): ListingEntry {
	const name = m.name;
	if (valOfOpt(m.isFile)) {
		return { name, isFile: true };
	} else if (valOfOpt(m.isFolder)) {
		return { name, isFolder: true };
	} else if (valOfOpt(m.isLink)) {
		return { name, isLink: true };
	} else {
		throw makeIPCException({
			badReply: true, message: `Missing fs entry type flag`
		});
	}
}


namespace watch {

	export type watchFn = ReadonlyFS['watchFolder'] | ReadonlyFS['watchFile'] |
		ReadonlyFS['watchTree'];

	export function wrapService<E extends FSEvent|FileEvent>(
		fn: watchFn, packEvent: (ev: E) => Buffer
	): ExposedFn {
		return buf => {
			const { path } = reqWithPathType.unpack(buf);
			const s = new Subject<E>();
			const obs = s.asObservable().pipe(
				map(packEvent)
			);
			const onCancel = fn(path, s as Subject<any>);
			return { obs, onCancel };
		};
	}

	function makeCaller<E>(
		caller: Caller, ipcPath: string[],
		unpackEvent: (buf: EnvelopeBody) => E
	): watchFn {
		return (path, obs) => {
			const s = new Subject<EnvelopeBody>();
			const unsub = caller.startObservableCall(
				ipcPath, reqWithPathType.pack({ path }), s);
			s.asObservable()
			.pipe(
				map(unpackEvent)
			)
			.subscribe(toRxObserver(obs));
			return unsub;
		};
	}

	export function makeFolderCaller(
		caller: Caller, objPath: string[]
	): ReadonlyFS['watchFolder'] {
		const ipcPath = objPath.concat('watchFolder');
		return makeCaller(
			caller, ipcPath, unpackFSEvent) as ReadonlyFS['watchFolder'];
	}

	export function makeTreeCaller(
		caller: Caller, objPath: string[]
	): ReadonlyFS['watchTree'] {
		const ipcPath = objPath.concat('watchTree');
		return makeCaller(
			caller, ipcPath, unpackFSEvent) as ReadonlyFS['watchTree'];
	}

	export function makeFileCaller(
		caller: Caller, objPath: string[]
	): ReadonlyFS['watchFile'] {
		const ipcPath = objPath.concat('watchFile');
		return makeCaller(
			caller, ipcPath, unpackFileEvent) as ReadonlyFS['watchFile'];
	}

}
Object.freeze(watch);


namespace close {

	export function wrapService(fn: ReadonlyFS['close']): ExposedFn {
		return () => {
			const promise = fn();
			return { promise };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): ReadonlyFS['close'] {
		const path = objPath.concat('close');
		return () => caller
		.startPromiseCall(path, undefined) as Promise<undefined>;
	}

}
Object.freeze(close);


namespace readonlySubRoot {

	export function wrapService(
		fn: ReadonlyFS['readonlySubRoot'], expServices: ExposedServices
	): ExposedFn {
		return buf => {
			const { path } = reqWithPathType.unpack(buf);
			const promise = fn(path)
			.then(fs => {
				const msg = exposeFSService(fs, expServices);
				return fsMsgType.pack(msg);
			});
			return { promise };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): ReadonlyFS['readonlySubRoot'] {
		const ipcPath = objPath.concat('readonlySubRoot');
		return path => caller
		.startPromiseCall(ipcPath, reqWithPathType.pack({ path }))
		.then(buf => {
			const fsMsg = fsMsgType.unpack(buf);
			return makeFSCaller(caller, fsMsg);
		});
	}

}
Object.freeze(readonlySubRoot);


namespace listFolder {

	interface Reply {
		entries: ListingEntryMsg[];
	}

	const requestType = ProtoType.for<Reply>(pb.ListFolderReplyBody);

	export function wrapService(
		fn: ReadonlyFS['listFolder']
	): ExposedFn {
		return buf => {
			const { path } = reqWithPathType.unpack(buf);
			const promise = fn(path)
			.then(lst => requestType.pack({ entries: lst.map(lsEntryToMsg) }));
			return { promise };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): ReadonlyFS['listFolder'] {
		const ipcPath = objPath.concat('listFolder');
		return path => caller
		.startPromiseCall(ipcPath, reqWithPathType.pack({ path }))
		.then(buf => fixArray(requestType.unpack(buf).entries).map(
			lsEntryFromMsg));
	}

}
Object.freeze(listFolder);


namespace readJSONFile {

	export function wrapService(
		fn: ReadonlyFS['readJSONFile']
	): ExposedFn {
		return buf => {
			const { path } = reqWithPathType.unpack(buf);
			const promise = fn(path)
			.then(packJSON);
			return { promise };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): ReadonlyFS['readJSONFile'] {
		const ipcPath = objPath.concat('readJSONFile');
		return path => caller
		.startPromiseCall(ipcPath, reqWithPathType.pack({ path }))
		.then(unpackJSON);
	}

}
Object.freeze(readJSONFile);


namespace readTxtFile {

	export function wrapService(
		fn: ReadonlyFS['readTxtFile']
	): ExposedFn {
		return buf => {
			const { path } = reqWithPathType.unpack(buf);
			const promise = fn(path)
			.then(txt => encodeToUtf8(txt) as Buffer);
			return { promise };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): ReadonlyFS['readTxtFile'] {
		const ipcPath = objPath.concat('readTxtFile');
		return path => caller
		.startPromiseCall(ipcPath, reqWithPathType.pack({ path }))
		.then(buf => (buf ? decodeFromUtf8(buf) : ''));
	}

}
Object.freeze(readTxtFile);


namespace readBytes {

	export interface Request {
		path: string;
		start?: Value<number>;
		end?: Value<number>;
	}

	export const requestType = ProtoType.for<Request>(pb.ReadBytesRequestBody);

	export function wrapService(
		fn: ReadonlyFS['readBytes']
	): ExposedFn {
		return buf => {
			const { path, start, end } = requestType.unpack(buf);
			const promise = fn(
				path, valOfOptInt(start), valOfOptInt(end)
			)
			.then(file.readBytes.packReply);
			return { promise };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): ReadonlyFS['readBytes'] {
		const ipcPath = objPath.concat('readBytes');
		return (path, start, end) => caller
		.startPromiseCall(ipcPath, requestType.pack({
			path, start: toOptVal(start), end: toOptVal(end)
		}))
		.then(file.readBytes.unpackReply);
	}

}
Object.freeze(readBytes);


namespace getByteSource {

	export function wrapService(
		fn: ReadonlyFS['getByteSource'], expServices: ExposedServices
	): ExposedFn {
		return buf => {
			const { path } = reqWithPathType.unpack(buf);
			const promise = fn(path)
			.then(src => {
				const ref = exposeSrcService(src, expServices);
				return objRefType.pack(ref);
			});
			return { promise };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): ReadonlyFS['getByteSource'] {
		const ipcPath = objPath.concat('getByteSource');
		return path => caller
		.startPromiseCall(ipcPath, reqWithPathType.pack({ path }))
		.then(buf => {
			const ref = objRefType.unpack(buf);
			return makeSrcCaller(caller, ref);
		});
	}

}
Object.freeze(getByteSource);


namespace readonlyFile {

	export function wrapService(
		fn: ReadonlyFS['readonlyFile'], expServices: ExposedServices
	): ExposedFn {
		return buf => {
			const { path } = reqWithPathType.unpack(buf);
			const promise = fn(path)
			.then(file => {
				const fileMsg = exposeFileService(file, expServices);
				return fileMsgType.pack(fileMsg);
			});
			return { promise };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): ReadonlyFS['readonlyFile'] {
		const ipcPath = objPath.concat('readonlyFile');
		return path => caller
		.startPromiseCall(ipcPath, reqWithPathType.pack({ path }))
		.then(buf => {
			const fileMsg = fileMsgType.unpack(buf);
			return makeFileCaller(caller, fileMsg);
		});
	}

}
Object.freeze(readonlyFile);


namespace select {

	interface CriteriaMsg {
		exactName?: Value<string>;
		pattern?: Value<string>;
		regexp?: Value<string>;
		depth?: Value<number>;
		type: string[];
		action: SelectCriteria['action'];
	}

	interface Request {
		path: string;
		criteria: CriteriaMsg;
	}

	const requestType = ProtoType.for<Request>(pb.SelectRequestBody);

	function criteriaToMsg(sc: SelectCriteria): CriteriaMsg {
		const c: CriteriaMsg = {
			action: sc.action,
			type: (Array.isArray(sc.type) ?
				sc.type : ((typeof sc.type === 'string') ? [sc.type] : [])),
			depth: toOptVal(sc.depth),
		};
		if (typeof sc.name === 'string') {
			c.pattern = toVal(sc.name);
		} else if (sc.name.type === 'pattern') {
			c.pattern = toVal(sc.name.p);
		} else if (sc.name.type === 'exact') {
			c.exactName = toVal(sc.name.p);
		} else if (sc.name.type === 'regexp') {
			c.regexp = toVal(sc.name.p);
		}
		return c;
	}

	function criteriaFromMsg(c: CriteriaMsg): SelectCriteria {
		let name: SelectCriteria['name'];
		if (c.exactName) {
			name = { type: 'exact', p: valOf(c.exactName) };
		} else if (c.pattern) {
			name = { type: 'pattern', p: valOf(c.pattern) };
		} else if (c.regexp) {
			name = { type: 'regexp', p: valOf(c.regexp) };
		} else {
			throw makeIPCException(
				{ message: `Invalid name parameter in select criteria` });
		}
		const typeArr = fixArray(c.type) as any[];
		const sc: SelectCriteria = {
			action: c.action,
			name,
			depth: valOfOptInt(c.depth),
			type: ((typeArr.length > 0) ? typeArr : undefined)
		};
		return sc;
	}

	export function wrapService(
		fn: ReadonlyFS['select'], expServices: ExposedServices
	): ExposedFn {
		return buf => {
			const { path, criteria } = requestType.unpack(buf);
			const s = new Subject<EnvelopeBody>();
			fn(path, criteriaFromMsg(criteria))
			.then(({ completion, items }) => {
				const ref = fsCollection.exposeCollectionService(
					items, expServices);
				s.next(objRefType.pack(ref));
				completion.then(() => s.complete(), err => s.error(err));
			}, err => s.error(err));
			return { obs: s.asObservable() };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): ReadonlyFS['select'] {
		const ipcPath = objPath.concat('select');
		return async (path, criteria) => {
			const req: Request = { path, criteria: criteriaToMsg(criteria) };
			const s = new Subject<EnvelopeBody>();
			caller.startObservableCall(ipcPath, requestType.pack(req), s);
			const reply = defer<FSCollection>();
			let completion: Deferred<void>|undefined = undefined;
			s.subscribe({
				next: buf => {
					const ref = objRefType.unpack(buf);
					const collection = fsCollection.makeCollectionCaller(
						ref, caller);
					reply.resolve(collection);
					completion = defer<void>();
				},
				complete: () => {
					if (completion) {
						completion.resolve();
					} else {
						reply.reject(makeIPCException({
							message: `Early completion sent by core side`
						}));
					}
				},
				error: err => {
					if (completion) {
						completion.reject(err);
					} else {
						reply.reject(err);
					}
				}
			});
			const items = await reply.promise;
			return { items, completion: completion!.promise };
		};
	}

}
Object.freeze(select);


namespace fsCollection {


	export function exposeCollectionService(
		collection: FSCollection, expServices: ExposedServices
	): ObjectReference<'FSCollection'> {
		const exp: ExposedObj<FSCollection> = {
			get: get.wrapService(collection.get, expServices),
			getAll: getAll.wrapService(collection.getAll, expServices),
			entries: entries.wrapService(collection.entries, expServices),
			watch: watch.wrapService(collection.watch, expServices)
		};
		const ref = expServices.exposeDroppableService<'FSCollection'>(
			'FSCollection', exp, collection);
		return ref;
	}

	export function makeCollectionCaller(
		ref: ObjectReference<'FSCollection'>, caller: Caller
	): FSCollection {
		checkRefObjTypeIs('FSCollection', ref);
		const objPath = ref.path;
		const collection: FSCollection = {
			get: get.makeCaller(caller, objPath),
			getAll: getAll.makeCaller(caller, objPath),
			entries: entries.makeCaller(caller, objPath),
			watch: watch.makeCaller(caller, objPath)
		}
		caller.registerClientDrop(collection, ref);
		return collection;
	}


	namespace get {

		interface Request {
			name: string;
		}

		const requestType = ProtoType.for<Request>(pb.FSCGetRequestBody);

		interface Reply {
			item?: fsItem.FSItemMsg;
		}

		const replyType = ProtoType.for<Reply>(pb.FSCGetReplyBody);

		export function wrapService(
			fn: FSCollection['get'], expServices: ExposedServices
		): ExposedFn {
			return buf => {
				const { name } = requestType.unpack(buf);
				const promise = fn(name)
				.then(item => {
					const reply = (item ?
						{ item: fsItem.exposeFSItem(expServices, item) } : {});
					return replyType.pack(reply);
				});
				return { promise };
			};
		}

		export function makeCaller(
			caller: Caller, objPath: string[]
		): FSCollection['get'] {
			const ipcPath = objPath.concat('get');
			return name => caller
			.startPromiseCall(ipcPath, requestType.pack({ name }))
			.then(buf => {
				const { item } = replyType.unpack(buf);
				return (item ? fsItem.fsItemFromMsg(caller, item) : undefined);
			});
		}

	}
	Object.freeze(get);


	interface NameAndItem {
		name: string;
		item: fsItem.FSItemMsg;
	}


	namespace getAll {

		interface Reply {
			items: NameAndItem[];
		}

		const replyType = ProtoType.for<Reply>(pb.FSCGetAllReplyBody);

		export function wrapService(
			fn: FSCollection['getAll'], expServices: ExposedServices
		): ExposedFn {
			return buf => {
				const promise = fn()
				.then(items => {
					const reply: Reply = { items: [] };
					for (const [ name, item ] of items) {
						reply.items.push({
							name, item: fsItem.exposeFSItem(expServices, item)
						});
					}
					return replyType.pack(reply);
				});
				return { promise };
			};
		}

		export function makeCaller(
			caller: Caller, objPath: string[]
		): FSCollection['getAll'] {
			const ipcPath = objPath.concat('getAll');
			return () => caller
			.startPromiseCall(ipcPath, undefined)
			.then(buf => {
				const items = fixArray(replyType.unpack(buf).items);
				const pairs: [ string, FSItem ][] = [];
				for (const { name, item } of items) {
					pairs.push([ name, fsItem.fsItemFromMsg(caller, item) ]);
				}
				return pairs;
			});
		}

	}
	Object.freeze(getAll);


	namespace entries {

		type Iter = web3n.AsyncIterator<[ string, FSItem ]>;

		function exposeIter(
			iter: Iter, expServices: ExposedServices
		): ObjectReference<'FSItemsIter'> {
			const exp: ExposedObj<Iter> = {
				next: wrapIterNext(iter.next, expServices)
			};
			const ref = expServices.exposeDroppableService<'FSItemsIter'>(
				'FSItemsIter', exp, iter);
			return ref;
		}

		function makeIterCaller(
			ref: ObjectReference<'FSItemsIter'>, caller: Caller
		): Iter {
			checkRefObjTypeIs('FSItemsIter', ref);
			const objPath = ref.path;
			const iter: Iter = {
				next: makeIterNextCaller(caller, objPath)
			};
			caller.registerClientDrop(iter, ref);
			return iter;
		}

		interface IterResMsg {
			done?: Value<boolean>;
			value?: NameAndItem;
		}
		const iterResMsgType = ProtoType.for<IterResMsg>(pb.IterResMsg);

		function packIterRes(
			res: IteratorResult<[string, FSItem]>, expServices: ExposedServices
		): Buffer {
			let msg: IterResMsg;
			if (res.done) {
				msg = { done: toVal(true) };
			} else {
				const itemRef = fsItem.exposeFSItem(expServices, res.value[1]);
				msg = { value: { name: res.value[0], item: itemRef } };
			}
			return iterResMsgType.pack(msg);
		}

		function unpackIterRes(
			buf: EnvelopeBody, caller: Caller
		): IteratorResult<[string, FSItem]> {
			const msg = iterResMsgType.unpack(buf);
			if (msg.done) {
				return { done: true } as IteratorResult<[string, FSItem]>;
			} else {
				const v = msg.value!;
				const item = fsItem.fsItemFromMsg(caller, v.item);
				return { value: [ v.name, item ] };
			}
		}

		function wrapIterNext(
			fn: Iter['next'], expServices: ExposedServices
		): ExposedFn {
			return () => {
				const promise = fn()
				.then(res => packIterRes(res, expServices));
				return { promise };
			};
		}

		function makeIterNextCaller(
			caller: Caller, objPath: string[]
		): Iter['next'] {
			const ipcPath = objPath.concat('next');
			return () => caller
			.startPromiseCall(ipcPath, undefined)
			.then(buf => unpackIterRes(buf, caller));
		}

		export function wrapService(
			fn: FSCollection['entries'], expServices: ExposedServices
		): ExposedFn {
			return () => {
				const promise = fn()
				.then(iter => {
					const ref = exposeIter(iter, expServices);
					return objRefType.pack(ref);
				});
				return { promise };
			};
		}

		export function makeCaller(
			caller: Caller, objPath: string[]
		): FSCollection['entries'] {
			const ipcPath = objPath.concat('entries');
			return () => caller
			.startPromiseCall(ipcPath, undefined)
			.then(buf => {
				const ref = objRefType.unpack(buf);
				return makeIterCaller(ref, caller);
			});
		}

	}
	Object.freeze(entries);


	namespace watch {

		interface CollectionEventMsg {
			type: string;
			path?: Value<string>;
			item?: fsItem.FSItemMsg;
		}

		const eventType = ProtoType.for<CollectionEventMsg>(pb.CollectionEvent);

		export function wrapService(
			fn: FSCollection['watch'], expServices: ExposedServices
		): ExposedFn {
			return () => {
				const s = new Subject<CollectionEvent>();
				const obs = s.asObservable().pipe(
					map(event => packEvent(event, expServices))
				);
				const onCancel = fn(s);
				return { obs, onCancel };
			};
		}

		function packEvent(
			event: CollectionEvent, expServices: ExposedServices
		): Buffer {
			const msg: CollectionEventMsg = {
				type: event.type,
				path: toOptVal(event.path)
			};
			if ((event as any).item) {
				msg.item = fsItem.exposeFSItem(expServices, (event as any).item);
			}
			return eventType.pack(msg);
		}

		function unpackEvent(
			buf: EnvelopeBody, caller: Caller
		): CollectionEvent {
			const msg = eventType.unpack(buf);
			const event: CollectionEvent = {
				type: msg.type as any,
				path: valOfOpt(msg.path)
			};
			if (msg.item) {
				(event as any).item = fsItem.fsItemFromMsg(caller, msg.item);
			}
			return event;
		}
	
		export function makeCaller(
			caller: Caller, objPath: string[]
		): FSCollection['watch'] {
			const path = objPath.concat('watch');
			return obs => {
				const s = new Subject<EnvelopeBody>();
				const unsub = caller.startObservableCall(path, undefined, s);
				s.asObservable()
				.pipe(
					map(buf => unpackEvent(buf, caller))
				)
				.subscribe(toRxObserver(obs));
				return unsub;
			};
		}
	
	}
	Object.freeze(watch);


}
Object.freeze(fsCollection);


export namespace fsItem {

	export interface FSItemMsg {
		isFile?: Value<boolean>;
		isFolder?: Value<boolean>;
		isLink?: Value<boolean>;
		isCollection?: Value<boolean>;
		item?: {
			fs?: FSMsg;
			file?: FileMsg;
			collection?: ObjectReference<'FSCollection'>;
		};
		location?: {
			fs: FSMsg;
			path: string;
			storageUse: NonNullable<FSItem['location']>['storageUse'];
			storageType: NonNullable<FSItem['location']>['storageType'];
		};
	}

	export const msgType = ProtoType.for<FSItemMsg>(pb.FSItem);

	export function exposeFSItem(
		expServices: ExposedServices, item: FSItem
	): FSItemMsg {
		const msg: FSItemMsg = {
			isLink: toOptVal(item.isLink)
		};
		if (item.isFile) {
			msg.isFile = toVal(true);
			if (item.item) {
				msg.item = {
					file: exposeFileService(item.item as File, expServices)
				};
			}
		} else if (item.isFolder) {
			msg.isFolder = toVal(true);
			if (item.item) {
				msg.item = {
					fs: exposeFSService(item.item as FS, expServices)
				};
			}
		} else if (item.isCollection) {
			msg.isCollection = toVal(true);
			if (item.item) {
				msg.item = {
					collection: fsCollection.exposeCollectionService(
						item.item as FSCollection, expServices)
				};
			}
		} else {
			throw new TypeError(`Missing type flag in FSItem`);
		}
		if (item.location) {
			msg.location = {
				path: item.location.path,
				storageType: item.location.storageType,
				storageUse: item.location.storageUse,
				fs: exposeFSService(item.location.fs, expServices)
			};
		}
		return msg;
	}

	export function fsItemFromMsg(
		caller: Caller, msg: FSItemMsg
	): FSItem {
		const item: FSItem = {
			isLink: valOfOpt(msg.isLink)
		};
		if (valOfOpt(msg.isFile)) {
			item.isFile = true;
			if (msg.item) {
				item.item = makeFileCaller(caller, msg.item.file!);
			}
		} else if (valOfOpt(msg.isFolder)) {
			item.isFolder = true;
			if (msg.item) {
				item.item = makeFSCaller(caller, msg.item.fs!);
			}
		} else if (valOfOpt(msg.isCollection)) {
			item.isCollection = true;
			if (msg.item) {
				item.item = fsCollection.makeCollectionCaller(
					msg.item.collection!, caller);
			}
		} else {
			throw new TypeError(`Missing type flag in FSItem`);
		}
		if (msg.location) {
			item.location = {
				path: msg.location.path,
				storageType: msg.location.storageType,
				storageUse: msg.location.storageUse,
				fs: makeFSCaller(caller, msg.location.fs)
			};
		}
		return item;
	}

}
Object.freeze(fsItem);


namespace vGetXAttr {

	export function wrapService(
		fn: ReadonlyFSVersionedAPI['getXAttr']
	): ExposedFn {
		return buf => {
			const { path, xaName } = getXAttr.requestType.unpack(buf);
			const promise = fn(path, xaName)
			.then(attrAndVer => file.vGetXAttr.replyType.pack(attrAndVer));
			return { promise };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): ReadonlyFSVersionedAPI['getXAttr'] {
		const ipcPath = objPath.concat('getXAttr');
		return (path, xaName) => caller
		.startPromiseCall(ipcPath, getXAttr.requestType.pack({ path, xaName }))
		.then(file.vGetXAttr.unpackReply);
	}

}
Object.freeze(vGetXAttr);


namespace vListXAttrs {

	export function wrapService(
		fn: ReadonlyFSVersionedAPI['listXAttrs']
	): ExposedFn {
		return buf => {
			const { path } = reqWithPathType.unpack(buf);
			const promise = fn(path)
			.then(({ version, lst }) => file.vListXAttrs.replyType.pack(
				{ version, xaNames: lst }));
			return { promise };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): ReadonlyFSVersionedAPI['listXAttrs'] {
		const ipcPath = objPath.concat('listXAttrs');
		return path => caller
		.startPromiseCall(ipcPath, reqWithPathType.pack({ path }))
		.then(buf => {
			const { version: v, xaNames } = file.vListXAttrs.replyType.unpack(buf);
			return { version: fixInt(v), lst: (xaNames ? xaNames : []) };
		});
	}

}
Object.freeze(vListXAttrs);


namespace vListFolder {

	interface Reply {
		version: number;
		entries: ListingEntryMsg[];
	}

	const replyType = ProtoType.for<Reply>(pb.VersionedListFolderReplyBody);

	export function wrapService(
		fn: ReadonlyFSVersionedAPI['listFolder']
	): ExposedFn {
		return buf => {
			const { path } = reqWithPathType.unpack(buf);
			const promise = fn(path)
			.then(({ version, lst }) => replyType.pack({
				version, entries: lst.map(lsEntryToMsg)
			}));
			return { promise };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): ReadonlyFSVersionedAPI['listFolder'] {
		const ipcPath = objPath.concat('listFolder');
		return path => caller
		.startPromiseCall(ipcPath, reqWithPathType.pack({ path }))
		.then(buf => {
			const { version: v, entries } = replyType.unpack(buf);
			return {
				version: fixInt(v), lst: fixArray(entries.map(lsEntryFromMsg))
			};
		});
	}

}
Object.freeze(vListFolder);


namespace vReadJSONFile {

	export function wrapService(
		fn: ReadonlyFSVersionedAPI['readJSONFile']
	): ExposedFn {
		return buf => {
			const { path } = reqWithPathType.unpack(buf);
			const promise = fn(path)
			.then(({ version, json }) => {
				return file.vReadJSON.replyType.pack(
					{ version, json: JSON.stringify(json) });
			});
			return { promise };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): ReadonlyFSVersionedAPI['readJSONFile'] {
		const ipcPath = objPath.concat('readJSONFile');
		return path => caller
		.startPromiseCall(ipcPath, reqWithPathType.pack({ path }))
		.then(buf => {
			const { version: v, json } = file.vReadJSON.replyType.unpack(buf);
			return { version: fixInt(v), json: JSON.parse(json) };
		});
	}

}
Object.freeze(vReadJSONFile);


namespace vReadTxtFile {

	export function wrapService(
		fn: ReadonlyFSVersionedAPI['readTxtFile']
	): ExposedFn {
		return buf => {
			const { path } = reqWithPathType.unpack(buf);
			const promise = fn(path)
			.then(verAndTxt => file.vReadTxt.replyType.pack(verAndTxt));
			return { promise };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): ReadonlyFSVersionedAPI['readTxtFile'] {
		const ipcPath = objPath.concat('readTxtFile');
		return path => caller
		.startPromiseCall(ipcPath, reqWithPathType.pack({ path }))
		.then(buf => {
			const { version: v, txt } = file.vReadTxt.replyType.unpack(buf);
			return { version: fixInt(v), txt };
		});
	}

}
Object.freeze(vReadTxtFile);


namespace vReadBytes {

	export function wrapService(
		fn: ReadonlyFSVersionedAPI['readBytes']
	): ExposedFn {
		return buf => {
			const { path, start, end } = readBytes.requestType.unpack(buf);
			const promise = fn(path, valOfOptInt(start), valOfOptInt(end))
			.then(file.vReadBytes.packReply);
			return { promise };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): ReadonlyFSVersionedAPI['readBytes'] {
		const ipcPath = objPath.concat('readBytes');
		return (path, start, end) => {
		return caller
		.startPromiseCall(ipcPath, readBytes.requestType.pack({
			path, start: toOptVal(start), end: toOptVal(end) }))
		.then(file.vReadBytes.unpackReply);
		};
	}

}
Object.freeze(vReadBytes);


namespace vGetByteSource {

	export function wrapService(
		fn: ReadonlyFSVersionedAPI['getByteSource'], expServices: ExposedServices
	): ExposedFn {
		return buf => {
			const { path } = reqWithPathType.unpack(buf);
			const promise = fn(path)
			.then(({ version, src }) => {
				const ref = exposeSrcService(src, expServices);
				return file.vGetByteSource.replyType.pack({ version, src: ref });
			});
			return { promise };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): ReadonlyFSVersionedAPI['getByteSource'] {
		const ipcPath = objPath.concat('getByteSource');
		return path => caller
		.startPromiseCall(ipcPath, reqWithPathType.pack({ path }))
		.then(buf => {
			const { version: v, src } = file.vGetByteSource.replyType.unpack(buf);
			return { version: fixInt(v), src: makeSrcCaller(caller, src) };
		});
	}

}
Object.freeze(vGetByteSource);


namespace updateXAttrs {

	export interface Request extends file.updateXAttrs.Request {
		path: string;
	}

	const requestType = ProtoType.for<Request>(pb.UpdateXAttrsRequestBody);

	export function unpackRequest(
		buf: EnvelopeBody
	): { changes: XAttrsChanges; path: string; } {
		const { changes, path } = requestType.unpack(buf);
		return { path, changes: file.updateXAttrs.fromReqChanges(changes) };
	}

	export function packRequest(
		path: string, changes: XAttrsChanges
	): EnvelopeBody {
		return requestType.pack(
			{ path, changes: file.updateXAttrs.toReqChanges(changes) });
	}

	export function wrapService(fn: WritableFS['updateXAttrs']): ExposedFn {
		return buf => {
			const { path, changes } = unpackRequest(buf);
			const promise = fn(path, changes);
			return { promise };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): WritableFS['updateXAttrs'] {
		const ipcPath = objPath.concat('updateXAttrs');
		return (path, changes) => caller
		.startPromiseCall(ipcPath, packRequest(path, changes)) as Promise<void>;
	}

}
Object.freeze(updateXAttrs);


namespace makeFolder {

	interface Request {
		path: string;
		exclusive?: Value<boolean>;
	}

	const requestType = ProtoType.for<Request>(pb.MakeFolderRequestBody);

	export function wrapService(fn: WritableFS['makeFolder']): ExposedFn {
		return buf => {
			const { path, exclusive } = requestType.unpack(buf);
			const promise = fn(path, valOfOpt(exclusive));
			return { promise };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): WritableFS['makeFolder'] {
		const ipcPath = objPath.concat('makeFolder');
		return (path, exclusive) => caller
		.startPromiseCall(ipcPath, requestType.pack({
			path, exclusive: toOptVal(exclusive)
		})) as Promise<void>;
	}

}
Object.freeze(makeFolder);


namespace deleteFolder {

	interface Request {
		path: string;
		removeContent?: Value<boolean>;
	}

	const requestType = ProtoType.for<Request>(pb.DeleteFolderRequestBody);

	export function wrapService(fn: WritableFS['deleteFolder']): ExposedFn {
		return buf => {
			const { path, removeContent } = requestType.unpack(buf);
			const promise = fn(path, valOfOpt(removeContent));
			return { promise };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): WritableFS['deleteFolder'] {
		const ipcPath = objPath.concat('deleteFolder');
		return (path, removeContent) => caller
		.startPromiseCall(ipcPath, requestType.pack({
			path, removeContent: toOptVal(removeContent)
		})) as Promise<void>;
	}

}
Object.freeze(deleteFolder);


namespace deleteFile {

	export function wrapService(fn: WritableFS['deleteFile']): ExposedFn {
		return buf => {
			const { path } = reqWithPathType.unpack(buf);
			const promise = fn(path);
			return { promise };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): WritableFS['deleteFile'] {
		const ipcPath = objPath.concat('deleteFile');
		return path => caller
		.startPromiseCall(
			ipcPath, reqWithPathType.pack({ path })
		) as Promise<void>;
	}

}
Object.freeze(deleteFile);


namespace deleteLink {

	export function wrapService(fn: WritableFS['deleteLink']): ExposedFn {
		return buf => {
			const { path } = reqWithPathType.unpack(buf);
			const promise = fn(path);
			return { promise };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): WritableFS['deleteLink'] {
		const ipcPath = objPath.concat('deleteLink');
		return path => caller
		.startPromiseCall(
			ipcPath, reqWithPathType.pack({ path })
		) as Promise<void>;
	}

}
Object.freeze(deleteLink);


namespace move {

	interface Request {
		src: string;
		dst: string;
	}

	const requestType = ProtoType.for<Request>(pb.MoveRequestBody);

	export function wrapService(fn: WritableFS['move']): ExposedFn {
		return buf => {
			const { src, dst } = requestType.unpack(buf);
			const promise = fn(src, dst);
			return { promise };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): WritableFS['move'] {
		const ipcPath = objPath.concat('move');
		return (src, dst) => caller
		.startPromiseCall(
			ipcPath, requestType.pack({ src, dst })
		) as Promise<void>;
	}

}
Object.freeze(move);


namespace copyFile {

	interface Request {
		src: string;
		dst: string;
		overwrite?: Value<boolean>;
	}

	const requestType = ProtoType.for<Request>(pb.CopyFileRequestBody);

	export function wrapService(fn: WritableFS['copyFile']): ExposedFn {
		return buf => {
			const { src, dst, overwrite } = requestType.unpack(buf);
			const promise = fn(src, dst, valOfOpt(overwrite));
			return { promise };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): WritableFS['copyFile'] {
		const ipcPath = objPath.concat('copyFile');
		return (src, dst, overwrite) => caller
		.startPromiseCall(ipcPath, requestType.pack({
			src, dst, overwrite: toOptVal(overwrite)
		})) as Promise<void>;
	}

}
Object.freeze(copyFile);


namespace copyFolder {

	interface Request {
		src: string;
		dst: string;
		mergeAndOverwrite?: Value<boolean>;
	}

	const requestType = ProtoType.for<Request>(pb.CopyFolderRequestBody);

	export function wrapService(fn: WritableFS['copyFolder']): ExposedFn {
		return buf => {
			const { src, dst, mergeAndOverwrite } = requestType.unpack(buf);
			const promise = fn(src, dst, valOfOpt(mergeAndOverwrite));
			return { promise };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): WritableFS['copyFolder'] {
		const ipcPath = objPath.concat('copyFolder');
		return (src, dst, mergeAndOverwrite) => caller
		.startPromiseCall(ipcPath, requestType.pack({
			src, dst, mergeAndOverwrite: toOptVal(mergeAndOverwrite)
		})) as Promise<void>;
	}

}
Object.freeze(copyFolder);


namespace saveFile {

	interface Request {
		file: ObjectReference<'FileImpl'>;
		dst: string;
		overwrite?: Value<boolean>;
	}

	const requestType = ProtoType.for<Request>(pb.SaveFileRequestBody);

	export function wrapService(
		fn: WritableFS['saveFile'], expServices: ExposedServices
	): ExposedFn {
		return buf => {
			const { dst, file, overwrite } = requestType.unpack(buf);
			const f = expServices.getOriginalObj<File>(file);
			const promise = fn(f, dst, valOfOpt(overwrite));
			return { promise };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): WritableFS['saveFile'] {
		const ipcPath = objPath.concat('saveFile');
		return (f, dst, overwrite) => caller
		.startPromiseCall(ipcPath, requestType.pack({
			file: caller.srvRefOf(f), dst, overwrite: toOptVal(overwrite)
		})) as Promise<void>;
	}

}
Object.freeze(saveFile);


namespace saveFolder {

	interface Request {
		folder: ObjectReference<'FSImpl'>;
		dst: string;
		overwrite?: Value<boolean>;
	}

	const requestType = ProtoType.for<Request>(pb.SaveFolderRequestBody);

	export function wrapService(
		fn: WritableFS['saveFolder'], expServices: ExposedServices
	): ExposedFn {
		return buf => {
			const { dst, folder: file, overwrite } = requestType.unpack(buf);
			const f = expServices.getOriginalObj<FS>(file);
			const promise = fn(f, dst, valOfOpt(overwrite));
			return { promise };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): WritableFS['saveFolder'] {
		const ipcPath = objPath.concat('saveFolder');
		return (f, dst, overwrite) => caller
		.startPromiseCall(ipcPath, requestType.pack({
			folder: caller.srvRefOf(f), dst, overwrite: toOptVal(overwrite)
		})) as Promise<void>;
	}

}
Object.freeze(saveFolder);


namespace link {

	interface Request {
		path: string;
		target: ObjectReference<'FSImpl'>|ObjectReference<'FileImpl'>;
	}

	const requestType = ProtoType.for<Request>(pb.LinkRequestBody);

	export function wrapService(
		fn: WritableFS['link'], expServices: ExposedServices
	): ExposedFn {
		return buf => {
			const { path, target } = requestType.unpack(buf);
			const f = expServices.getOriginalObj<FS|File>(target);
			const promise = fn(path, f);
			return { promise };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): WritableFS['link'] {
		const ipcPath = objPath.concat('link');
		return (path, f) => caller
		.startPromiseCall(ipcPath, requestType.pack(
			{ path, target: caller.srvRefOf(f) })) as Promise<void>;
	}

}
Object.freeze(link);


interface PathAndFileOpts {
	path: string;
	flags?: FileFlagsMsg;
}

interface FileFlagsMsg {
	truncate?: Value<boolean>;
	create?: Value<boolean>;
	exclusive?: Value<boolean>;
}

const pathAndFileOptsType = ProtoType.for<PathAndFileOpts>(pb.PathAndOptFileFlags);

function packPathAndFlags(path: string, flags: FileFlags|undefined): Buffer {
	return pathAndFileOptsType.pack({ path, flags: optFlagsToMsg(flags) });
}

function unpackPathAndFlags(
	buf: EnvelopeBody
): { path: string; flags?: FileFlags; } {
	const { path, flags } = pathAndFileOptsType.unpack(buf);
	return { path, flags: optFlagsFromMsg(flags) };
}

function optFlagsToMsg(flags: FileFlags|undefined): FileFlagsMsg|undefined {
	return (flags ? {
		create: toOptVal(flags.create),
		exclusive: toOptVal(flags.exclusive),
		truncate: toOptVal(flags.truncate)
	} : undefined)
}

function optFlagsFromMsg(m: FileFlagsMsg|undefined): FileFlags|undefined {
	return (m ? {
		create: valOfOpt(m.create),
		exclusive: valOfOpt(m.exclusive),
		truncate: valOfOpt(m.truncate)
	} : undefined)
}


namespace writableSubRoot {

	export function wrapService(
		fn: WritableFS['writableSubRoot'], expServices: ExposedServices
	): ExposedFn {
		return buf => {
			const { path, flags } = unpackPathAndFlags(buf);
			const promise = fn(path, flags)
			.then(fs => {
				const fsMsg = exposeFSService(fs, expServices);
				return fsMsgType.pack(fsMsg);
			});
			return { promise };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): WritableFS['writableSubRoot'] {
		const ipcPath = objPath.concat('writableSubRoot');
		return (path, flags) => caller
		.startPromiseCall(ipcPath, packPathAndFlags(path, flags))
		.then(buf => {
			const fsMsg = fsMsgType.unpack(buf);
			return makeFSCaller(caller, fsMsg);
		}) as Promise<WritableFS>;
	}

}
Object.freeze(writableSubRoot);


namespace writableFile {

	export function wrapService(
		fn: WritableFS['writableFile'], expServices: ExposedServices
	): ExposedFn {
		return buf => {
			const { path, flags } = unpackPathAndFlags(buf);
			const promise = fn(path, flags)
			.then(file => {
				const fileMsg = exposeFileService(file, expServices);
				return fileMsgType.pack(fileMsg);
			});
			return { promise };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): WritableFS['writableFile'] {
		const ipcPath = objPath.concat('writableFile');
		return (path, flags) => caller
		.startPromiseCall(ipcPath, packPathAndFlags(path, flags))
		.then(buf => {
			const fileMsg = fileMsgType.unpack(buf);
			return makeFileCaller(caller, fileMsg);
		}) as Promise<WritableFile>;
	}

}
Object.freeze(writableFile);


namespace writeJSONFile {

	interface Request {
		path: string;
		json: string;
		flags?: FileFlagsMsg;
	}

	const requestType = ProtoType.for<Request>(pb.WriteJsonFileRequestBody);

	export function wrapService(fn: WritableFS['writeJSONFile']): ExposedFn {
		return buf => {
			const { path, json, flags } = requestType.unpack(buf);
			const promise = fn(path, JSON.parse(json), optFlagsFromMsg(flags));
			return { promise };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): WritableFS['writeJSONFile'] {
		const ipcPath = objPath.concat('writeJSONFile');
		return (path, json, flags) => caller
		.startPromiseCall(ipcPath, requestType.pack({
			path, json: JSON.stringify(json), flags: optFlagsToMsg(flags)
		})) as Promise<void>;
	}

}
Object.freeze(writeJSONFile);


namespace writeTxtFile {

	interface Request {
		path: string;
		txt: string;
		flags?: FileFlagsMsg;
	}

	const requestType = ProtoType.for<Request>(pb.WriteTxtFileRequestBody);

	export function wrapService(fn: WritableFS['writeTxtFile']): ExposedFn {
		return buf => {
			const { path, txt, flags } = requestType.unpack(buf);
			const promise = fn(path, txt, optFlagsFromMsg(flags));
			return { promise };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): WritableFS['writeTxtFile'] {
		const ipcPath = objPath.concat('writeTxtFile');
		return (path, txt, flags) => caller
		.startPromiseCall(ipcPath, requestType.pack({
			path, txt, flags: optFlagsToMsg(flags)
		})) as Promise<void>;
	}

}
Object.freeze(writeTxtFile);


namespace writeBytes {

	interface Request {
		path: string;
		bytes: Buffer;
		flags?: FileFlagsMsg;
	}

	const requestType = ProtoType.for<Request>(pb.WriteBytesRequestBody);

	export function wrapService(fn: WritableFS['writeBytes']): ExposedFn {
		return buf => {
			const { path, bytes, flags } = requestType.unpack(buf);
			const promise = fn(path, bytes, optFlagsFromMsg(flags));
			return { promise };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): WritableFS['writeBytes'] {
		const ipcPath = objPath.concat('writeBytes');
		return (path, bytes, flags) => caller
		.startPromiseCall(ipcPath, requestType.pack({
			path, bytes: bytes as Buffer, flags: optFlagsToMsg(flags)
		})) as Promise<void>;
	}

}
Object.freeze(writeBytes);


namespace getByteSink {

	export function wrapService(
		fn: WritableFS['getByteSink'], expServices: ExposedServices
	): ExposedFn {
		return buf => {
			const { path, flags } = unpackPathAndFlags(buf);
			const promise = fn(path, flags)
			.then(sink => {
				const ref = exposeSinkService(sink, expServices);
				return objRefType.pack(ref);
			});
			return { promise };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): WritableFS['getByteSink'] {
		const ipcPath = objPath.concat('getByteSink');
		return (path, flags) => caller
		.startPromiseCall(ipcPath, packPathAndFlags(path, flags))
		.then(buf => {
			const ref = objRefType.unpack(buf);
			return makeSinkCaller(caller, ref);
		});
	}

}
Object.freeze(getByteSink);


namespace vUpdateXAttrs {

	export function wrapService(
		fn: WritableFSVersionedAPI['updateXAttrs']
	): ExposedFn {
		return buf => {
			const { path, changes } = updateXAttrs.unpackRequest(buf);
			const promise = fn(path, changes)
			.then(packInt);
			return { promise };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): WritableFSVersionedAPI['updateXAttrs'] {
		const ipcPath = objPath.concat('updateXAttrs');
		return (path, changes) => caller
		.startPromiseCall(ipcPath, updateXAttrs.packRequest(path, changes))
		.then(unpackInt);
	}

}
Object.freeze(vUpdateXAttrs);


interface VerFileFlagsMsg extends FileFlagsMsg {
	currentVersion?: Value<number>;
}

function optVerFlagsToMsg(
	f: VersionedFileFlags|undefined
): VerFileFlagsMsg|undefined {
	if (!f) { return; }
	const m = optFlagsToMsg(f) as VerFileFlagsMsg;
	m.currentVersion = toOptVal(f.currentVersion);
	return m;
}

function optVerFlagsFromMsg(
	m: VerFileFlagsMsg|undefined
): VersionedFileFlags|undefined {
	if (!m) { return; }
	const f = optFlagsFromMsg(m) as VersionedFileFlags;
	f.currentVersion = valOfOpt(m.currentVersion);
	return f;
}


namespace vWriteJSONFile {

	interface Request {
		path: string;
		json: string;
		flags?: VerFileFlagsMsg;
	}

	const requestType = ProtoType.for<Request>(
		pb.VersionedWriteJsonFileRequestBody);

	export function wrapService(
		fn: WritableFSVersionedAPI['writeJSONFile']
	): ExposedFn {
		return buf => {
			const { path, json, flags } = requestType.unpack(buf);
			const promise = fn(path, JSON.parse(json), optVerFlagsFromMsg(flags))
			.then(packInt);
			return { promise };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): WritableFSVersionedAPI['writeJSONFile'] {
		const ipcPath = objPath.concat('writeJSONFile');
		return (path, json, flags) => caller
		.startPromiseCall(ipcPath, requestType.pack({
			path, json: JSON.stringify(json), flags: optVerFlagsToMsg(flags)
		}))
		.then(unpackInt);
	}

}
Object.freeze(vWriteJSONFile);


namespace vWriteTxtFile {

	interface Request {
		path: string;
		txt: string;
		flags?: VerFileFlagsMsg;
	}

	const requestType = ProtoType.for<Request>(
		pb.VersionedWriteTxtFileRequestBody);

	export function wrapService(
		fn: WritableFSVersionedAPI['writeTxtFile']
	): ExposedFn {
		return buf => {
			const { path, txt, flags } = requestType.unpack(buf);
			const promise = fn(path, txt, optVerFlagsFromMsg(flags))
			.then(packInt);
			return { promise };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): WritableFSVersionedAPI['writeTxtFile'] {
		const ipcPath = objPath.concat('writeTxtFile');
		return (path, txt, flags) => caller
		.startPromiseCall(ipcPath, requestType.pack({
			path, txt, flags: optVerFlagsToMsg(flags)
		}))
		.then(unpackInt);
	}

}
Object.freeze(vWriteTxtFile);


namespace vWriteBytes {

	interface Request {
		path: string;
		bytes: Buffer;
		flags?: VerFileFlagsMsg;
	}

	const requestType = ProtoType.for<Request>(
		pb.VersionedWriteBytesRequestBody);

	export function wrapService(
		fn: WritableFSVersionedAPI['writeBytes']
	): ExposedFn {
		return buf => {
			const { path, bytes, flags } = requestType.unpack(buf);
			const promise = fn(path, bytes, optVerFlagsFromMsg(flags))
			.then(packInt);
			return { promise };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): WritableFSVersionedAPI['writeBytes'] {
		const ipcPath = objPath.concat('writeBytes');
		return (path, bytes, flags) => caller
		.startPromiseCall(ipcPath, requestType.pack({
			path, bytes: bytes as Buffer, flags: optVerFlagsToMsg(flags)
		}))
		.then(unpackInt);
	}

}
Object.freeze(vWriteBytes);


namespace vGetByteSink {

	interface Request {
		path: string;
		flags?: VerFileFlagsMsg;
	}

	const requestType = ProtoType.for<Request>(
		pb.VersionedGetByteSinkRequestBody);

	export function wrapService(
		fn: WritableFSVersionedAPI['getByteSink'], expServices: ExposedServices
	): ExposedFn {
		return buf => {
			const { path, flags } = requestType.unpack(buf);
			const promise = fn(path, optVerFlagsFromMsg(flags))
			.then(({ version, sink}) => {
				const ref = exposeSinkService(sink, expServices);
				return file.vGetByteSink.replyType.pack({ version, sink: ref });
			});
			return { promise };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): WritableFSVersionedAPI['getByteSink'] {
		const ipcPath = objPath.concat('getByteSink');
		return (path, flags) => caller
		.startPromiseCall(ipcPath, requestType.pack({
			path, flags: optVerFlagsToMsg(flags)
		}))
		.then(buf => {
			const { sink, version: v } = file.vGetByteSink.replyType.unpack(buf);
			return { version: fixInt(v), sink: makeSinkCaller(caller, sink) };
		});
	}

}
Object.freeze(vGetByteSink);


Object.freeze(exports);