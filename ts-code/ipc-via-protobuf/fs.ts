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

import { ObjectReference, ProtoType, boolValType, strArrValType, objRefType, fixInt, fixArray, Value, valOfOpt, toOptVal, toVal, valOfOptInt, valOf, packInt, unpackInt } from "./protobuf-msg";
import { checkRefObjTypeIs, ObjectsConnector, ExposedFn, ExposedObj, EnvelopeBody, makeIPCException } from "./connector";
import { join, resolve } from "path";
import { packStats, unpackStats, packXAttrValue, unpackXAttrValue, exposeFileService, FileMsg, makeFileCaller, packJSON, unpackJSON, fileMsgType, unpackFileEvent, packFileEvent } from "./file";
import * as file from "./file";
import { assert } from "../lib-common/assert";
import { exposeSrcService, makeSrcCaller, exposeSinkService, makeSinkCaller } from "./bytes";
import { Subject } from "rxjs";
import { defer, Deferred } from "../lib-common/processes";
import { map } from "rxjs/operators";

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
type SyncedEvent = web3n.files.SyncedEvent;
type UnsyncedEvent = web3n.files.UnsyncedEvent;
type ConflictEvent = web3n.files.ConflictEvent;
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

export function makeFSCaller(connector: ObjectsConnector, fsMsg: FSMsg): FS {
	checkRefObjTypeIs('FSImpl', fsMsg.impl);
	const objPath = fsMsg.impl.path;
	const fs = {
		name: fsMsg.name,
		type: fsMsg.type,
		writable: fsMsg.writable,
		checkFilePresence: checkPresence.makeFileCaller(connector, objPath),
		checkFolderPresence: checkPresence.makeFolderCaller(connector, objPath),
		checkLinkPresence: checkPresence.makeLinkCaller(connector, objPath),
		close: close.makeCaller(connector, objPath),
		getByteSource: getByteSource.makeCaller(connector, objPath),
		getXAttr: getXAttr.makeCaller(connector, objPath),
		listXAttrs: listXAttrs.makeCaller(connector, objPath),
		listFolder: listFolder.makeCaller(connector, objPath),
		readBytes: readBytes.makeCaller(connector, objPath),
		readLink: readLink.makeCaller(connector, objPath),
		readJSONFile: readJSONFile.makeCaller(connector, objPath),
		readTxtFile: readTxtFile.makeCaller(connector, objPath),
		readonlyFile: readonlyFile.makeCaller(connector, objPath),
		readonlySubRoot: readonlySubRoot.makeCaller(connector, objPath),
		select: select.makeCaller(connector, objPath),
		stat: stat.makeCaller(connector, objPath),
		watchFolder: watch.makeFolderCaller(connector, objPath),
		watchFile: watch.makeFileCaller(connector, objPath),
		watchTree: watch.makeTreeCaller(connector, objPath),
	} as WritableFS;
	if (fsMsg.writable) {
		fs.copyFile = copyFile.makeCaller(connector, objPath);
		fs.copyFolder = copyFolder.makeCaller(connector, objPath);
		fs.deleteFile = deleteFile.makeCaller(connector, objPath);
		fs.deleteFolder = deleteFolder.makeCaller(connector, objPath);
		fs.deleteLink = deleteLink.makeCaller(connector, objPath);
		fs.getByteSink = getByteSink.makeCaller(connector, objPath);
		fs.link = link.makeCaller(connector, objPath);
		fs.makeFolder = makeFolder.makeCaller(connector, objPath);
		fs.move = move.makeCaller(connector, objPath);
		fs.saveFile = saveFile.makeCaller(connector, objPath);
		fs.saveFolder = saveFolder.makeCaller(connector, objPath);
		fs.updateXAttrs = updateXAttrs.makeCaller(connector, objPath);
		fs.writableFile = writableFile.makeCaller(connector, objPath);
		fs.writableSubRoot = writableSubRoot.makeCaller(connector, objPath);
		fs.writeBytes = writeBytes.makeCaller(connector, objPath);
		fs.writeJSONFile = writeJSONFile.makeCaller(connector, objPath);
		fs.writeTxtFile = writeTxtFile.makeCaller(connector, objPath);
	}
	if (fsMsg.isVersioned) {
		const vPath = objPath.concat('v');
		fs.v = {
			getByteSource: vGetByteSource.makeCaller(connector, vPath),
			getXAttr: vGetXAttr.makeCaller(connector, vPath),
			listXAttrs: vListXAttrs.makeCaller(connector, vPath),
			listFolder: vListFolder.makeCaller(connector, vPath),
			readBytes: vReadBytes.makeCaller(connector, vPath),
			readJSONFile: vReadJSONFile.makeCaller(connector, vPath),
			readTxtFile: vReadTxtFile.makeCaller(connector, vPath),
		} as WritableFSVersionedAPI;
		if (fsMsg.writable) {
			fs.v.getByteSink = vGetByteSink.makeCaller(connector, vPath);
			fs.v.writeBytes = vWriteBytes.makeCaller(connector, vPath);
			fs.v.writeJSONFile = vWriteJSONFile.makeCaller(connector, vPath);
			fs.v.writeTxtFile = vWriteTxtFile.makeCaller(connector, vPath);
			fs.v.updateXAttrs = vUpdateXAttrs.makeCaller(connector, vPath);
		}
	}
	connector.registerClientDrop(fs, fsMsg.impl);
	return fs;
}

export function exposeFSService(fs: FS, connector: ObjectsConnector): FSMsg {
	const implExp = {
		checkFilePresence: checkPresence.wrapService(fs.checkFilePresence),
		checkFolderPresence: checkPresence.wrapService(fs.checkFolderPresence),
		checkLinkPresence: checkPresence.wrapService(fs.checkLinkPresence),
		close: close.wrapService(fs.close),
		getByteSource: getByteSource.wrapService(fs.getByteSource, connector),
		getXAttr: getXAttr.wrapService(fs.getXAttr),
		listXAttrs: listXAttrs.wrapService(fs.listXAttrs),
		listFolder: listFolder.wrapService(fs.listFolder),
		readBytes: readBytes.wrapService(fs.readBytes),
		readLink: readLink.wrapService(fs.readLink, connector),
		readJSONFile: readJSONFile.wrapService(fs.readJSONFile),
		readTxtFile: readTxtFile.wrapService(fs.readTxtFile),
		readonlyFile: readonlyFile.wrapService(fs.readonlyFile, connector),
		readonlySubRoot: readonlySubRoot.wrapService(
			fs.readonlySubRoot, connector),
		select: select.wrapService(fs.select, connector),
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
			(fs as WritableFS).getByteSink, connector);
		implExp.link = link.wrapService((fs as WritableFS).link, connector);
		implExp.makeFolder = makeFolder.wrapService(
			(fs as WritableFS).makeFolder);
		implExp.move = move.wrapService((fs as WritableFS).move);
		implExp.saveFile = saveFile.wrapService(
			(fs as WritableFS).saveFile, connector);
		implExp.saveFolder = saveFolder.wrapService(
			(fs as WritableFS).saveFolder, connector);
		implExp.updateXAttrs = updateXAttrs.wrapService(
			(fs as WritableFS).updateXAttrs);
		implExp.writableFile = writableFile.wrapService(
			(fs as WritableFS).writableFile, connector);
		implExp.writableSubRoot = writableSubRoot.wrapService(
			(fs as WritableFS).writableSubRoot, connector);
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
				fs.v.getByteSource, connector),
			getXAttr: vGetXAttr.wrapService(fs.v.getXAttr),
			listXAttrs: vListXAttrs.wrapService(fs.v.listXAttrs),
			listFolder: vListFolder.wrapService(fs.v.listFolder),
			readBytes: vReadBytes.wrapService(fs.v.readBytes),
			readJSONFile: vReadJSONFile.wrapService(fs.v.readJSONFile),
			readTxtFile: vReadTxtFile.wrapService(fs.v.readTxtFile),
		} as ExposedObj<WritableFSVersionedAPI>;
		if (fs.writable) {
			implExp.v.getByteSink = vGetByteSink.wrapService(
				(fs.v as WritableFSVersionedAPI).getByteSink, connector);
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
	const impl = connector.exposedObjs.exposeDroppableService(
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
	impl: ObjectReference;
}

function makeFSType<T extends object>(type: string): ProtoType<T> {
	return ProtoType.makeFrom<T>('fs.proto', `fs.${type}`);
}

export const fsMsgType = makeFSType<FSMsg>('FS');


namespace checkPresence {

	interface Request {
		path: string;
		throwIfMissing?: Value<boolean>;
	}

	const requestType = makeFSType<Request>('CheckPresenceRequestBody');

	export function wrapService(fn: ReadonlyFS['checkFilePresence']): ExposedFn {
		return buf => {
			const { path, throwIfMissing } = requestType.unpack(buf);
			const promise = fn(path, valOfOpt(throwIfMissing))
			.then(found => boolValType.pack({ value: found }));
			return { promise };
		};
	}

	function makeCaller(
		connector: ObjectsConnector, objPath: string[]
	): ReadonlyFS['checkFilePresence'] {
		return (path, throwIfMissing) => connector
		.startPromiseCall(objPath, requestType.pack({
			path, throwIfMissing: toOptVal(throwIfMissing)
		}))
		.then(buf => boolValType.unpack(buf).value);
	}

	export function makeFileCaller(
		connector: ObjectsConnector, objPath: string[]
	): ReadonlyFS['checkFilePresence'] {
		return makeCaller(connector, objPath.concat('checkFilePresence'));
	}

	export function makeFolderCaller(
		connector: ObjectsConnector, objPath: string[]
	): ReadonlyFS['checkFolderPresence'] {
		return makeCaller(connector, objPath.concat('checkFolderPresence'));
	}

	export function makeLinkCaller(
		connector: ObjectsConnector, objPath: string[]
	): ReadonlyFS['checkLinkPresence'] {
		return makeCaller(connector, objPath.concat('checkLinkPresence'));
	}

}
Object.freeze(checkPresence);


interface RequestWithPath {
	path: string;
}

const reqWithPathType = makeFSType<RequestWithPath>('PathOnlyRequestBody');


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
		connector: ObjectsConnector, objPath: string[]
	): ReadonlyFS['stat'] {
		const ipcPath = objPath.concat('stat');
		return path => connector
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

	export const requestType = makeFSType<Request>('GetXAttrRequestBody');

	export function wrapService(fn: ReadonlyFS['getXAttr']): ExposedFn {
		return buf => {
			const { path, xaName } = requestType.unpack(buf);
			const promise = fn(path, xaName)
			.then(packXAttrValue);
			return { promise };
		};
	}

	export function makeCaller(
		connector: ObjectsConnector, objPath: string[]
	): ReadonlyFS['getXAttr'] {
		const ipcPath = objPath.concat('getXAttr');
		return (path, xaName) => connector
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
		connector: ObjectsConnector, objPath: string[]
	): ReadonlyFS['listXAttrs'] {
		const ipcPath = objPath.concat('listXAttrs');
		return path => connector
		.startPromiseCall(ipcPath, reqWithPathType.pack({ path }))
		.then(buf => fixArray(strArrValType.unpack(buf).values));
	}

}
Object.freeze(listXAttrs);


interface SymLinkMsg {
	readonly: boolean;
	isFile?: Value<boolean>;
	isFolder?: Value<boolean>;
	target: ObjectReference;
}
const symLinkMsgType = makeFSType<SymLinkMsg>('SymLink');

interface SymLinkTarget {
	fs?: FSMsg;
	file?: FileMsg;
}
const symLinkTargetType = makeFSType<SymLinkTarget>('SymLinkTargetReplyBody');

function exposeSymLink(
	link: SymLink, connector: ObjectsConnector
): SymLinkMsg {
	const exp: ExposedFn = () => {
		if (link.isFile) {
			const promise = link.target()
			.then(f => {
				const file = exposeFileService(f as File, connector);
				return symLinkTargetType.pack({ file });
			});
			return { promise };
		} else if (link.isFolder) {
			const promise = link.target()
			.then(f => {
				const fs = exposeFSService(f as FS, connector);
				return symLinkTargetType.pack({ fs });
			});
			return { promise };
		} else {
			assert(false);
		}
	};
	const ref = connector.exposedObjs.exposeDroppableService(
		'SymLinkImpl', exp, link);
	const msg: SymLinkMsg = {
		readonly: link.readonly,
		isFile: toOptVal(link.isFile),
		isFolder: toOptVal(link.isFolder),
		target: ref
	};
	return msg;
}

function makeSymLinkCaller(
	connector: ObjectsConnector, linkMsg: SymLinkMsg
): SymLink {
	const link: SymLink = {
		readonly: linkMsg.readonly,
		target: () => connector
		.startPromiseCall(linkMsg.target.path, undefined)
		.then(buf => {
			const { file, fs } = symLinkTargetType.unpack(buf);
			if (file) {
				return makeFileCaller(connector, file);
			} else if (fs) {
				return makeFSCaller(connector, fs);
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
		fn: ReadonlyFS['readLink'], connector: ObjectsConnector
	): ExposedFn {
		return buf => {
			const { path } = reqWithPathType.unpack(buf);
			const promise = fn(path)
			.then(link => {
				const msg = exposeSymLink(link, connector);
				return symLinkMsgType.pack(msg);
			});
			return { promise };
		};
	}

	export function makeCaller(
		connector: ObjectsConnector, objPath: string[]
	): ReadonlyFS['readLink'] {
		const ipcPath = objPath.concat('readLink');
		return path => connector
		.startPromiseCall(ipcPath, reqWithPathType.pack({ path }))
		.then(buf => {
			const linkMsg = symLinkMsgType.unpack(buf);
			return makeSymLinkCaller(connector, linkMsg);
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
	entry?: Value<ListingEntryMsg>;
	current?: Value<number>;
	lastSynced?: Value<number>;
	remoteVersion?: Value<number>;
}

const fsEventMsgType = makeFSType<FSEventMsg>('FSEventMsg');

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
			toVal(lsEntryToMsg((e as EntryAdditionEvent).entry)) : undefined),
		current: toOptVal((e as SyncedEvent).current),
		lastSynced: toOptVal((e as UnsyncedEvent).lastSynced),
		remoteVersion: toOptVal((e as ConflictEvent).remoteVersion)
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
		entry: (m.entry ? lsEntryFromMsg(m.entry.value): undefined),
		current: valOfOptInt(m.current),
		lastSynced: valOfOptInt(m.lastSynced),
		remoteVersion: valOfOptInt(m.remoteVersion)
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
	return {
		name: m.name,
		isFile: valOfOpt(m.isFile),
		isFolder: valOfOpt(m.isFolder),
		isLink: valOfOpt(m.isLink)
	};
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
		connector: ObjectsConnector, ipcPath: string[],
		unpackEvent: (buf: EnvelopeBody) => E
	): watchFn {
		return (path, obs) => {
			const s = new Subject<EnvelopeBody>();
			const unsub = connector.startObservableCall(
				ipcPath, reqWithPathType.pack({ path }), s);
			s.subscribe({
				next: buf => {
					if (obs.next) {
						obs.next(unpackEvent(buf));
					}
				},
				complete: obs.complete,
				error: obs.error
			});
			return unsub;
		};
	}

	export function makeFolderCaller(
		connector: ObjectsConnector, objPath: string[]
	): ReadonlyFS['watchFolder'] {
		const ipcPath = objPath.concat('watchFolder');
		return makeCaller(
			connector, ipcPath, unpackFSEvent) as ReadonlyFS['watchFolder'];
	}

	export function makeTreeCaller(
		connector: ObjectsConnector, objPath: string[]
	): ReadonlyFS['watchTree'] {
		const ipcPath = objPath.concat('watchTree');
		return makeCaller(
			connector, ipcPath, unpackFSEvent) as ReadonlyFS['watchTree'];
	}

	export function makeFileCaller(
		connector: ObjectsConnector, objPath: string[]
	): ReadonlyFS['watchFile'] {
		const ipcPath = objPath.concat('watchFile');
		return makeCaller(
			connector, ipcPath, unpackFileEvent) as ReadonlyFS['watchFile'];
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
		connector: ObjectsConnector, objPath: string[]
	): ReadonlyFS['close'] {
		const path = objPath.concat('close');
		return () => connector
		.startPromiseCall(path, undefined) as Promise<undefined>;
	}

}
Object.freeze(close);


namespace readonlySubRoot {

	export function wrapService(
		fn: ReadonlyFS['readonlySubRoot'], connector: ObjectsConnector
	): ExposedFn {
		return buf => {
			const { path } = reqWithPathType.unpack(buf);
			const promise = fn(path)
			.then(fs => {
				const msg = exposeFSService(fs, connector);
				return fsMsgType.pack(msg);
			});
			return { promise };
		};
	}

	export function makeCaller(
		connector: ObjectsConnector, objPath: string[]
	): ReadonlyFS['readonlySubRoot'] {
		const ipcPath = objPath.concat('readonlySubRoot');
		return path => connector
		.startPromiseCall(ipcPath, reqWithPathType.pack({ path }))
		.then(buf => {
			const fsMsg = fsMsgType.unpack(buf);
			return makeFSCaller(connector, fsMsg);
		});
	}

}
Object.freeze(readonlySubRoot);


namespace listFolder {

	interface Reply {
		entries: ListingEntryMsg[];
	}

	const requestType = makeFSType<Reply>('ListFolderReplyBody');

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
		connector: ObjectsConnector, objPath: string[]
	): ReadonlyFS['listFolder'] {
		const ipcPath = objPath.concat('listFolder');
		return path => connector
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
		connector: ObjectsConnector, objPath: string[]
	): ReadonlyFS['readJSONFile'] {
		const ipcPath = objPath.concat('readJSONFile');
		return path => connector
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
			.then(txt => Buffer.from(txt, 'utf8'));
			return { promise };
		};
	}

	export function makeCaller(
		connector: ObjectsConnector, objPath: string[]
	): ReadonlyFS['readTxtFile'] {
		const ipcPath = objPath.concat('readTxtFile');
		return path => connector
		.startPromiseCall(ipcPath, reqWithPathType.pack({ path }))
		.then(buf => (buf ? buf.toString('utf8') : ''));
	}

}
Object.freeze(readTxtFile);


namespace readBytes {

	export interface Request {
		path: string;
		start?: Value<number>;
		end?: Value<number>;
	}

	export const requestType = makeFSType<Request>('ReadBytesRequestBody');

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
		connector: ObjectsConnector, objPath: string[]
	): ReadonlyFS['readBytes'] {
		const ipcPath = objPath.concat('readBytes');
		return (path, start, end) => connector
		.startPromiseCall(ipcPath, requestType.pack({
			path, start: toOptVal(start), end: toOptVal(end)
		}))
		.then(file.readBytes.unpackReply);
	}

}
Object.freeze(readBytes);


namespace getByteSource {

	export function wrapService(
		fn: ReadonlyFS['getByteSource'], connector: ObjectsConnector
	): ExposedFn {
		return buf => {
			const { path } = reqWithPathType.unpack(buf);
			const promise = fn(path)
			.then(src => {
				const ref = exposeSrcService(src, connector);
				return objRefType.pack(ref);
			});
			return { promise };
		};
	}

	export function makeCaller(
		connector: ObjectsConnector, objPath: string[]
	): ReadonlyFS['getByteSource'] {
		const ipcPath = objPath.concat('getByteSource');
		return path => connector
		.startPromiseCall(ipcPath, reqWithPathType.pack({ path }))
		.then(buf => {
			const ref = objRefType.unpack(buf);
			return makeSrcCaller(connector, ref);
		});
	}

}
Object.freeze(getByteSource);


namespace readonlyFile {

	export function wrapService(
		fn: ReadonlyFS['readonlyFile'], connector: ObjectsConnector
	): ExposedFn {
		return buf => {
			const { path } = reqWithPathType.unpack(buf);
			const promise = fn(path)
			.then(file => {
				const fileMsg = exposeFileService(file, connector);
				return fileMsgType.pack(fileMsg);
			});
			return { promise };
		};
	}

	export function makeCaller(
		connector: ObjectsConnector, objPath: string[]
	): ReadonlyFS['readonlyFile'] {
		const ipcPath = objPath.concat('readonlyFile');
		return path => connector
		.startPromiseCall(ipcPath, reqWithPathType.pack({ path }))
		.then(buf => {
			const fileMsg = fileMsgType.unpack(buf);
			return makeFileCaller(connector, fileMsg);
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

	const requestType = makeFSType<Request>('SelectRequestBody');

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
		fn: ReadonlyFS['select'], connector: ObjectsConnector
	): ExposedFn {
		return buf => {
			const { path, criteria } = requestType.unpack(buf);
			const s = new Subject<EnvelopeBody>();
			fn(path, criteriaFromMsg(criteria))
			.then(({ completion, items }) => {
				const ref = fsCollection.exposeCollectionService(items, connector);
				s.next(objRefType.pack(ref));
				completion.then(() => s.complete(), err => s.error(err));
			}, err => s.error(err));
			return { obs: s.asObservable() };
		};
	}

	export function makeCaller(
		connector: ObjectsConnector, objPath: string[]
	): ReadonlyFS['select'] {
		const ipcPath = objPath.concat('select');
		return async (path, criteria) => {
			const req: Request = { path, criteria: criteriaToMsg(criteria) };
			const s = new Subject<EnvelopeBody>();
			connector.startObservableCall(ipcPath, requestType.pack(req), s);
			const reply = defer<FSCollection>();
			let completion: Deferred<void>|undefined = undefined;
			s.subscribe({
				next: buf => {
					const ref = objRefType.unpack(buf);
					const collection = fsCollection.makeCollectionCaller(
						ref, connector);
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
		collection: FSCollection, connector: ObjectsConnector
	): ObjectReference {
		const exp: ExposedObj<FSCollection> = {
			get: get.wrapService(collection.get, connector),
			getAll: getAll.wrapService(collection.getAll, connector),
			entries: entries.wrapService(collection.entries, connector),
			watch: watch.wrapService(collection.watch, connector)
		};
		const ref = connector.exposedObjs.exposeDroppableService(
			'FSCollection', exp, collection);
		return ref;
	}

	export function makeCollectionCaller(
		ref: ObjectReference, connector: ObjectsConnector
	): FSCollection {
		checkRefObjTypeIs('FSCollection', ref);
		const objPath = ref.path;
		const collection: FSCollection = {
			get: get.makeCaller(connector, objPath),
			getAll: getAll.makeCaller(connector, objPath),
			entries: entries.makeCaller(connector, objPath),
			watch: watch.makeCaller(connector, objPath)
		}
		connector.registerClientDrop(collection, ref);
		return collection;
	}


	namespace get {

		interface Request {
			name: string;
		}

		const requestType = makeFSType<Request>('FSCGetRequestBody');

		interface Reply {
			item?: fsItem.FSItemMsg;
		}

		const replyType = makeFSType<Reply>('FSCGetReplyBody');

		export function wrapService(
			fn: FSCollection['get'], connector: ObjectsConnector
		): ExposedFn {
			return buf => {
				const { name } = requestType.unpack(buf);
				const promise = fn(name)
				.then(item => {
					const reply = (item ?
						{ item: fsItem.exposeFSItem(connector, item) } : {});
					return replyType.pack(reply);
				});
				return { promise };
			};
		}

		export function makeCaller(
			connector: ObjectsConnector, objPath: string[]
		): FSCollection['get'] {
			const ipcPath = objPath.concat('get');
			return name => connector
			.startPromiseCall(ipcPath, requestType.pack({ name }))
			.then(buf => {
				const { item } = replyType.unpack(buf);
				return (item ? fsItem.fsItemFromMsg(connector, item) : undefined);
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

		const replyType = makeFSType<Reply>('FSCGetAllReplyBody');

		export function wrapService(
			fn: FSCollection['getAll'], connector: ObjectsConnector
		): ExposedFn {
			return buf => {
				const promise = fn()
				.then(items => {
					const reply: Reply = { items: [] };
					for (const [ name, item ] of items) {
						reply.items.push({
							name, item: fsItem.exposeFSItem(connector, item)
						});
					}
					return replyType.pack(reply);
				});
				return { promise };
			};
		}

		export function makeCaller(
			connector: ObjectsConnector, objPath: string[]
		): FSCollection['getAll'] {
			const ipcPath = objPath.concat('getAll');
			return () => connector
			.startPromiseCall(ipcPath, undefined)
			.then(buf => {
				const items = fixArray(replyType.unpack(buf).items);
				const pairs: [ string, FSItem ][] = [];
				for (const { name, item } of items) {
					pairs.push([ name, fsItem.fsItemFromMsg(connector, item) ]);
				}
				return pairs;
			});
		}

	}
	Object.freeze(getAll);


	namespace entries {

		type Iter = web3n.AsyncIterator<[ string, FSItem ]>;

		function exposeIter(
			iter: Iter, connector: ObjectsConnector
		): ObjectReference {
			const exp: ExposedObj<Iter> = {
				next: wrapIterNext(iter.next, connector)
			};
			const ref = connector.exposedObjs.exposeDroppableService(
				'FSItemsIter', exp, iter);
			return ref;
		}

		function makeIterCaller(
			ref: ObjectReference, connector: ObjectsConnector
		): Iter {
			checkRefObjTypeIs('FSItemsIter', ref);
			const objPath = ref.path;
			const iter: Iter = {
				next: makeIterNextCaller(connector, objPath)
			};
			connector.registerClientDrop(iter, ref);
			return iter;
		}

		interface IterResMsg {
			done?: Value<boolean>;
			value?: NameAndItem;
		}
		const iterResMsgType = makeFSType<IterResMsg>('IterResMsg');

		function packIterRes(
			res: IteratorResult<[string, FSItem]>, connector: ObjectsConnector
		): Buffer {
			let msg: IterResMsg;
			if (res.done) {
				msg = { done: toVal(true) };
			} else {
				const itemRef = fsItem.exposeFSItem(connector, res.value[1]);
				msg = { value: { name: res.value[0], item: itemRef } };
			}
			return iterResMsgType.pack(msg);
		}

		function unpackIterRes(
			buf: EnvelopeBody, connector: ObjectsConnector
		): IteratorResult<[string, FSItem]> {
			const msg = iterResMsgType.unpack(buf);
			if (msg.done) {
				return { done: true } as IteratorResult<[string, FSItem]>;
			} else {
				const v = msg.value!;
				const item = fsItem.fsItemFromMsg(connector, v.item);
				return { value: [ v.name, item ] };
			}
		}

		function wrapIterNext(
			fn: Iter['next'], connector: ObjectsConnector
		): ExposedFn {
			return () => {
				const promise = fn()
				.then(res => packIterRes(res, connector));
				return { promise };
			};
		}

		function makeIterNextCaller(
			connector: ObjectsConnector, objPath: string[]
		): Iter['next'] {
			const ipcPath = objPath.concat('next');
			return () => connector
			.startPromiseCall(ipcPath, undefined)
			.then(buf => unpackIterRes(buf, connector));
		}

		export function wrapService(
			fn: FSCollection['entries'], connector: ObjectsConnector
		): ExposedFn {
			return () => {
				const promise = fn()
				.then(iter => {
					const ref = exposeIter(iter, connector);
					return objRefType.pack(ref);
				});
				return { promise };
			};
		}

		export function makeCaller(
			connector: ObjectsConnector, objPath: string[]
		): FSCollection['entries'] {
			const ipcPath = objPath.concat('entries');
			return () => connector
			.startPromiseCall(ipcPath, undefined)
			.then(buf => {
				const ref = objRefType.unpack(buf);
				return makeIterCaller(ref, connector);
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

		const eventType = makeFSType<CollectionEventMsg>('CollectionEvent');

		export function wrapService(
			fn: FSCollection['watch'], connector: ObjectsConnector
		): ExposedFn {
			return () => {
				const s = new Subject<CollectionEvent>();
				const obs = s.asObservable().pipe(
					map(event => packEvent(event, connector))
				);
				const onCancel = fn(s);
				return { obs, onCancel };
			};
		}

		function packEvent(
			event: CollectionEvent, connector: ObjectsConnector
		): Buffer {
			const msg: CollectionEventMsg = {
				type: event.type,
				path: toOptVal(event.path)
			};
			if ((event as any).item) {
				msg.item = fsItem.exposeFSItem(connector, (event as any).item);
			}
			return eventType.pack(msg);
		}

		function unpackEvent(
			buf: EnvelopeBody, connector: ObjectsConnector
		): CollectionEvent {
			const msg = eventType.unpack(buf);
			const event: CollectionEvent = {
				type: msg.type as any,
				path: valOfOpt(msg.path)
			};
			if (msg.item) {
				(event as any).item = fsItem.fsItemFromMsg(
					connector, msg.item);
			}
			return event;
		}
	
		export function makeCaller(
			connector: ObjectsConnector, objPath: string[]
		): FSCollection['watch'] {
			const path = objPath.concat('watch');
			return obs => {
				const s = new Subject<EnvelopeBody>();
				const unsub = connector.startObservableCall(path, undefined, s);
				s.subscribe({
					next: buf => {
						if (obs.next) {
							obs.next(unpackEvent(buf, connector));
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
			collection?: ObjectReference;
		};
		location?: {
			fs: FSMsg;
			path: string;
			storageUse: NonNullable<FSItem['location']>['storageUse'];
			storageType: NonNullable<FSItem['location']>['storageType'];
		};
	}

	export const msgType = makeFSType<FSItemMsg>('FSItem');

	export function exposeFSItem(
		connector: ObjectsConnector, item: FSItem
	): FSItemMsg {
		const msg: FSItemMsg = {
			isLink: toOptVal(item.isLink)
		};
		if (item.isFile) {
			msg.isFile = toVal(true);
			if (item.item) {
				msg.item = {
					file: exposeFileService(item.item as File, connector)
				};
			}
		} else if (item.isFolder) {
			msg.isFolder = toVal(true);
			if (item.item) {
				msg.item = {
					fs: exposeFSService(item.item as FS, connector)
				};
			}
		} else if (item.isCollection) {
			msg.isCollection = toVal(true);
			if (item.item) {
				msg.item = {
					collection: fsCollection.exposeCollectionService(
						item.item as FSCollection, connector)
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
				fs: exposeFSService(item.location.fs, connector)
			};
		}
		return msg;
	}

	export function fsItemFromMsg(
		connector: ObjectsConnector, msg: FSItemMsg
	): FSItem {
		const item: FSItem = {
			isLink: valOfOpt(msg.isLink)
		};
		if (valOfOpt(msg.isFile)) {
			item.isFile = true;
			if (msg.item) {
				item.item = makeFileCaller(connector, msg.item.file!);
			}
		} else if (valOfOpt(msg.isFolder)) {
			item.isFolder = true;
			if (msg.item) {
				item.item = makeFSCaller(connector, msg.item.fs!);
			}
		} else if (valOfOpt(msg.isCollection)) {
			item.isCollection = true;
			if (msg.item) {
				item.item = fsCollection.makeCollectionCaller(
					msg.item.collection!, connector);
			}
		} else {
			throw new TypeError(`Missing type flag in FSItem`);
		}
		if (msg.location) {
			item.location = {
				path: msg.location.path,
				storageType: msg.location.storageType,
				storageUse: msg.location.storageUse,
				fs: makeFSCaller(connector, msg.location.fs)
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
		connector: ObjectsConnector, objPath: string[]
	): ReadonlyFSVersionedAPI['getXAttr'] {
		const ipcPath = objPath.concat('getXAttr');
		return (path, xaName) => connector
		.startPromiseCall(ipcPath, getXAttr.requestType.pack({ path, xaName }))
		.then(unpackXAttrValue);
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
		connector: ObjectsConnector, objPath: string[]
	): ReadonlyFSVersionedAPI['listXAttrs'] {
		const ipcPath = objPath.concat('listXAttrs');
		return path => connector
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

	const replyType = makeFSType<Reply>('VersionedListFolderReplyBody');

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
		connector: ObjectsConnector, objPath: string[]
	): ReadonlyFSVersionedAPI['listFolder'] {
		const ipcPath = objPath.concat('listFolder');
		return path => connector
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
		connector: ObjectsConnector, objPath: string[]
	): ReadonlyFSVersionedAPI['readJSONFile'] {
		const ipcPath = objPath.concat('readJSONFile');
		return path => connector
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
		connector: ObjectsConnector, objPath: string[]
	): ReadonlyFSVersionedAPI['readTxtFile'] {
		const ipcPath = objPath.concat('readTxtFile');
		return path => connector
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
		connector: ObjectsConnector, objPath: string[]
	): ReadonlyFSVersionedAPI['readBytes'] {
		const ipcPath = objPath.concat('readBytes');
		return (path, start, end) => {
		return connector
		.startPromiseCall(ipcPath, readBytes.requestType.pack({
			path, start: toOptVal(start), end: toOptVal(end) }))
		.then(file.vReadBytes.unpackReply);
		};
	}

}
Object.freeze(vReadBytes);


namespace vGetByteSource {

	export function wrapService(
		fn: ReadonlyFSVersionedAPI['getByteSource'], connector: ObjectsConnector
	): ExposedFn {
		return buf => {
			const { path } = reqWithPathType.unpack(buf);
			const promise = fn(path)
			.then(({ version, src }) => {
				const ref = exposeSrcService(src, connector);
				return file.vGetByteSource.replyType.pack({ version, src: ref });
			});
			return { promise };
		};
	}

	export function makeCaller(
		connector: ObjectsConnector, objPath: string[]
	): ReadonlyFSVersionedAPI['getByteSource'] {
		const ipcPath = objPath.concat('getByteSource');
		return path => connector
		.startPromiseCall(ipcPath, reqWithPathType.pack({ path }))
		.then(buf => {
			const { version: v, src } = file.vGetByteSource.replyType.unpack(buf);
			return { version: fixInt(v), src: makeSrcCaller(connector, src) };
		});
	}

}
Object.freeze(vGetByteSource);


namespace updateXAttrs {

	export interface Request extends file.updateXAttrs.Request {
		path: string;
	}

	const requestType = makeFSType<Request>('UpdateXAttrsRequestBody');

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
		connector: ObjectsConnector, objPath: string[]
	): WritableFS['updateXAttrs'] {
		const ipcPath = objPath.concat('updateXAttrs');
		return (path, changes) => connector
		.startPromiseCall(ipcPath, packRequest(path, changes)) as Promise<void>;
	}

}
Object.freeze(updateXAttrs);


namespace makeFolder {

	interface Request {
		path: string;
		exclusive?: Value<boolean>;
	}

	const requestType = makeFSType<Request>('MakeFolderRequestBody');

	export function wrapService(fn: WritableFS['makeFolder']): ExposedFn {
		return buf => {
			const { path, exclusive } = requestType.unpack(buf);
			const promise = fn(path, valOfOpt(exclusive));
			return { promise };
		};
	}

	export function makeCaller(
		connector: ObjectsConnector, objPath: string[]
	): WritableFS['makeFolder'] {
		const ipcPath = objPath.concat('makeFolder');
		return (path, exclusive) => connector
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

	const requestType = makeFSType<Request>('DeleteFolderRequestBody');

	export function wrapService(fn: WritableFS['deleteFolder']): ExposedFn {
		return buf => {
			const { path, removeContent } = requestType.unpack(buf);
			const promise = fn(path, valOfOpt(removeContent));
			return { promise };
		};
	}

	export function makeCaller(
		connector: ObjectsConnector, objPath: string[]
	): WritableFS['deleteFolder'] {
		const ipcPath = objPath.concat('deleteFolder');
		return (path, removeContent) => connector
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
		connector: ObjectsConnector, objPath: string[]
	): WritableFS['deleteFile'] {
		const ipcPath = objPath.concat('deleteFile');
		return path => connector
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
		connector: ObjectsConnector, objPath: string[]
	): WritableFS['deleteLink'] {
		const ipcPath = objPath.concat('deleteLink');
		return path => connector
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

	const requestType = makeFSType<Request>('MoveRequestBody');

	export function wrapService(fn: WritableFS['move']): ExposedFn {
		return buf => {
			const { src, dst } = requestType.unpack(buf);
			const promise = fn(src, dst);
			return { promise };
		};
	}

	export function makeCaller(
		connector: ObjectsConnector, objPath: string[]
	): WritableFS['move'] {
		const ipcPath = objPath.concat('move');
		return (src, dst) => connector
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

	const requestType = makeFSType<Request>('CopyFileRequestBody');

	export function wrapService(fn: WritableFS['copyFile']): ExposedFn {
		return buf => {
			const { src, dst, overwrite } = requestType.unpack(buf);
			const promise = fn(src, dst, valOfOpt(overwrite));
			return { promise };
		};
	}

	export function makeCaller(
		connector: ObjectsConnector, objPath: string[]
	): WritableFS['copyFile'] {
		const ipcPath = objPath.concat('copyFile');
		return (src, dst, overwrite) => connector
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

	const requestType = makeFSType<Request>('CopyFolderRequestBody');

	export function wrapService(fn: WritableFS['copyFolder']): ExposedFn {
		return buf => {
			const { src, dst, mergeAndOverwrite } = requestType.unpack(buf);
			const promise = fn(src, dst, valOfOpt(mergeAndOverwrite));
			return { promise };
		};
	}

	export function makeCaller(
		connector: ObjectsConnector, objPath: string[]
	): WritableFS['copyFolder'] {
		const ipcPath = objPath.concat('copyFolder');
		return (src, dst, mergeAndOverwrite) => connector
		.startPromiseCall(ipcPath, requestType.pack({
			src, dst, mergeAndOverwrite: toOptVal(mergeAndOverwrite)
		})) as Promise<void>;
	}

}
Object.freeze(copyFolder);


namespace saveFile {

	interface Request {
		file: ObjectReference;
		dst: string;
		overwrite?: Value<boolean>;
	}

	const requestType = makeFSType<Request>('SaveFileRequestBody');

	export function wrapService(
		fn: WritableFS['saveFile'], connector: ObjectsConnector
	): ExposedFn {
		return buf => {
			const { dst, file, overwrite } = requestType.unpack(buf);
			const f = connector.exposedObjs.getOriginalObj<File>(file);
			const promise = fn(f, dst, valOfOpt(overwrite));
			return { promise };
		};
	}

	export function makeCaller(
		connector: ObjectsConnector, objPath: string[]
	): WritableFS['saveFile'] {
		const ipcPath = objPath.concat('saveFile');
		return (f, dst, overwrite) => connector
		.startPromiseCall(ipcPath, requestType.pack({
			file: connector.srvRefOf(f), dst, overwrite: toOptVal(overwrite)
		})) as Promise<void>;
	}

}
Object.freeze(saveFile);


namespace saveFolder {

	interface Request {
		folder: ObjectReference;
		dst: string;
		overwrite?: Value<boolean>;
	}

	const requestType = makeFSType<Request>('SaveFolderRequestBody');

	export function wrapService(
		fn: WritableFS['saveFolder'], connector: ObjectsConnector
	): ExposedFn {
		return buf => {
			const { dst, folder: file, overwrite } = requestType.unpack(buf);
			const f = connector.exposedObjs.getOriginalObj<FS>(file);
			const promise = fn(f, dst, valOfOpt(overwrite));
			return { promise };
		};
	}

	export function makeCaller(
		connector: ObjectsConnector, objPath: string[]
	): WritableFS['saveFolder'] {
		const ipcPath = objPath.concat('saveFolder');
		return (f, dst, overwrite) => connector
		.startPromiseCall(ipcPath, requestType.pack({
			folder: connector.srvRefOf(f), dst, overwrite: toOptVal(overwrite)
		})) as Promise<void>;
	}

}
Object.freeze(saveFolder);


namespace link {

	interface Request {
		path: string;
		target: ObjectReference;
	}

	const requestType = makeFSType<Request>('LinkRequestBody');

	export function wrapService(
		fn: WritableFS['link'], connector: ObjectsConnector
	): ExposedFn {
		return buf => {
			const { path, target } = requestType.unpack(buf);
			const f = connector.exposedObjs.getOriginalObj<FS|File>(target);
			const promise = fn(path, f);
			return { promise };
		};
	}

	export function makeCaller(
		connector: ObjectsConnector, objPath: string[]
	): WritableFS['link'] {
		const ipcPath = objPath.concat('link');
		return (path, f) => connector
		.startPromiseCall(ipcPath, requestType.pack(
			{ path, target: connector.srvRefOf(f) })) as Promise<void>;
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

const pathAndFileOptsType = makeFSType<PathAndFileOpts>('PathAndOptFileFlags');

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
		fn: WritableFS['writableSubRoot'], connector: ObjectsConnector
	): ExposedFn {
		return buf => {
			const { path, flags } = unpackPathAndFlags(buf);
			const promise = fn(path, flags)
			.then(fs => {
				const fsMsg = exposeFSService(fs, connector);
				return fsMsgType.pack(fsMsg);
			});
			return { promise };
		};
	}

	export function makeCaller(
		connector: ObjectsConnector, objPath: string[]
	): WritableFS['writableSubRoot'] {
		const ipcPath = objPath.concat('writableSubRoot');
		return (path, flags) => connector
		.startPromiseCall(ipcPath, packPathAndFlags(path, flags))
		.then(buf => {
			const fsMsg = fsMsgType.unpack(buf);
			return makeFSCaller(connector, fsMsg);
		}) as Promise<WritableFS>;
	}

}
Object.freeze(writableSubRoot);


namespace writableFile {

	export function wrapService(
		fn: WritableFS['writableFile'], connector: ObjectsConnector
	): ExposedFn {
		return buf => {
			const { path, flags } = unpackPathAndFlags(buf);
			const promise = fn(path, flags)
			.then(file => {
				const fileMsg = exposeFileService(file, connector);
				return fileMsgType.pack(fileMsg);
			});
			return { promise };
		};
	}

	export function makeCaller(
		connector: ObjectsConnector, objPath: string[]
	): WritableFS['writableFile'] {
		const ipcPath = objPath.concat('writableFile');
		return (path, flags) => connector
		.startPromiseCall(ipcPath, packPathAndFlags(path, flags))
		.then(buf => {
			const fileMsg = fileMsgType.unpack(buf);
			return makeFileCaller(connector, fileMsg);
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

	const requestType = makeFSType<Request>('WriteJsonFileRequestBody');

	export function wrapService(fn: WritableFS['writeJSONFile']): ExposedFn {
		return buf => {
			const { path, json, flags } = requestType.unpack(buf);
			const promise = fn(path, JSON.parse(json), optFlagsFromMsg(flags));
			return { promise };
		};
	}

	export function makeCaller(
		connector: ObjectsConnector, objPath: string[]
	): WritableFS['writeJSONFile'] {
		const ipcPath = objPath.concat('writeJSONFile');
		return (path, json, flags) => connector
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

	const requestType = makeFSType<Request>('WriteTxtFileRequestBody');

	export function wrapService(fn: WritableFS['writeTxtFile']): ExposedFn {
		return buf => {
			const { path, txt, flags } = requestType.unpack(buf);
			const promise = fn(path, txt, optFlagsFromMsg(flags));
			return { promise };
		};
	}

	export function makeCaller(
		connector: ObjectsConnector, objPath: string[]
	): WritableFS['writeTxtFile'] {
		const ipcPath = objPath.concat('writeTxtFile');
		return (path, txt, flags) => connector
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

	const requestType = makeFSType<Request>('WriteBytesRequestBody');

	export function wrapService(fn: WritableFS['writeBytes']): ExposedFn {
		return buf => {
			const { path, bytes, flags } = requestType.unpack(buf);
			const promise = fn(path, bytes, optFlagsFromMsg(flags));
			return { promise };
		};
	}

	export function makeCaller(
		connector: ObjectsConnector, objPath: string[]
	): WritableFS['writeBytes'] {
		const ipcPath = objPath.concat('writeBytes');
		return (path, bytes, flags) => connector
		.startPromiseCall(ipcPath, requestType.pack({
			path, bytes: bytes as Buffer, flags: optFlagsToMsg(flags)
		})) as Promise<void>;
	}

}
Object.freeze(writeBytes);


namespace getByteSink {

	export function wrapService(
		fn: WritableFS['getByteSink'], connector: ObjectsConnector
	): ExposedFn {
		return buf => {
			const { path, flags } = unpackPathAndFlags(buf);
			const promise = fn(path, flags)
			.then(sink => {
				const ref = exposeSinkService(sink, connector);
				return objRefType.pack(ref);
			});
			return { promise };
		};
	}

	export function makeCaller(
		connector: ObjectsConnector, objPath: string[]
	): WritableFS['getByteSink'] {
		const ipcPath = objPath.concat('getByteSink');
		return (path, flags) => connector
		.startPromiseCall(ipcPath, packPathAndFlags(path, flags))
		.then(buf => {
			const ref = objRefType.unpack(buf);
			return makeSinkCaller(connector, ref);
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
		connector: ObjectsConnector, objPath: string[]
	): WritableFSVersionedAPI['updateXAttrs'] {
		const ipcPath = objPath.concat('updateXAttrs');
		return (path, changes) => connector
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

	const requestType = makeFSType<Request>('VersionedWriteJsonFileRequestBody');

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
		connector: ObjectsConnector, objPath: string[]
	): WritableFSVersionedAPI['writeJSONFile'] {
		const ipcPath = objPath.concat('writeJSONFile');
		return (path, json, flags) => connector
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

	const requestType = makeFSType<Request>('VersionedWriteTxtFileRequestBody');

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
		connector: ObjectsConnector, objPath: string[]
	): WritableFSVersionedAPI['writeTxtFile'] {
		const ipcPath = objPath.concat('writeTxtFile');
		return (path, txt, flags) => connector
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

	const requestType = makeFSType<Request>('VersionedWriteBytesRequestBody');

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
		connector: ObjectsConnector, objPath: string[]
	): WritableFSVersionedAPI['writeBytes'] {
		const ipcPath = objPath.concat('writeBytes');
		return (path, bytes, flags) => connector
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

	const requestType = makeFSType<Request>('VersionedGetByteSinkRequestBody');

	export function wrapService(
		fn: WritableFSVersionedAPI['getByteSink'], connector: ObjectsConnector
	): ExposedFn {
		return buf => {
			const { path, flags } = requestType.unpack(buf);
			const promise = fn(path, optVerFlagsFromMsg(flags))
			.then(({ version, sink}) => {
				const ref = exposeSinkService(sink, connector);
				return file.vGetByteSink.replyType.pack({ version, sink: ref });
			});
			return { promise };
		};
	}

	export function makeCaller(
		connector: ObjectsConnector, objPath: string[]
	): WritableFSVersionedAPI['getByteSink'] {
		const ipcPath = objPath.concat('getByteSink');
		return (path, flags) => connector
		.startPromiseCall(ipcPath, requestType.pack({
			path, flags: optVerFlagsToMsg(flags)
		}))
		.then(buf => {
			const { sink, version: v } = file.vGetByteSink.replyType.unpack(buf);
			return { version: fixInt(v), sink: makeSinkCaller(connector, sink) };
		});
	}

}
Object.freeze(vGetByteSink);


Object.freeze(exports);