/*
 Copyright (C) 2020, 2022, 2025 - 2026 3NSoft Inc.
 
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

import { ObjectReference, strArrValType, objRefType, fixInt, fixArray, Value, toOptVal, toVal, valOfOpt, valOfOptInt, toOptJson, valOf, valOfOptJson, packInt, unpackInt, encodeToUtf8, decodeFromUtf8, intValOf, methodPathFor, boolValType } from "../ipc-via-protobuf/protobuf-msg";
import { ProtoType } from '../lib-client/protobuf-type';
import { file as pb } from '../protos/file.proto';
import { common as commonPB } from '../protos/common.proto';
import { checkRefObjTypeIs, ExposedFn, makeIPCException, EnvelopeBody, ExposedObj, Caller, CoreSideServices } from "../ipc-via-protobuf/connector";
import { errWithCause } from "../lib-common/exceptions/error";
import { exposeSrcService, makeSrcCaller, exposeSinkService, makeSinkCaller } from "./bytes";
import { Subject } from "rxjs";
import { map } from "rxjs/operators";
import { toRxObserver } from "../lib-common/utils-for-observables";
import { toBuffer } from "../lib-common/buffer-utils";

type ReadonlyFile = web3n.files.ReadonlyFile;
type ReadonlyFileVersionedAPI = web3n.files.ReadonlyFileVersionedAPI;
type ReadonlyFileSyncAPI = web3n.files.ReadonlyFileSyncAPI;
type WritableFile = web3n.files.WritableFile;
type WritableFileVersionedAPI = web3n.files.WritableFileVersionedAPI;
type WritableFileSyncAPI = web3n.files.WritableFileSyncAPI;
type File = web3n.files.File;
type Stats = web3n.files.Stats;
type SyncBranch = web3n.files.SyncBranch;
type SyncStatus = web3n.files.SyncStatus;
type XAttrsChanges = web3n.files.XAttrsChanges;
type FileEvent = web3n.files.FileEvent;
type RemoteEvent = web3n.files.RemoteEvent;
type SyncVersionsBranch = web3n.files.SyncVersionsBranch;
type OptionsToAdopteRemote = web3n.files.OptionsToAdopteRemote;
type OptionsToUploadLocal = web3n.files.OptionsToUploadLocal;
type VersionedReadFlags = web3n.files.VersionedReadFlags;
type FileDiff = web3n.files.FileDiff;
type CommonDiff = web3n.files.CommonDiff;
type OptionsToDiffFileVersions = web3n.files.OptionsToDiffFileVersions;

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
		const vPath = methodPathFor<ReadonlyFile>(objPath, 'v');
		file.v = {
			getByteSource: vGetByteSource.makeCaller(caller, vPath),
			stat: vStat.makeCaller(caller, vPath),
			getXAttr: vGetXAttr.makeCaller(caller, vPath),
			listXAttrs: vListXAttrs.makeCaller(caller, vPath),
			readBytes: vReadBytes.makeCaller(caller, vPath),
			readJSON: vReadJSON.makeCaller(caller, vPath),
			readTxt: vReadTxt.makeCaller(caller, vPath),
			listVersions: vListVersions.makeCaller(caller, vPath)
		} as WritableFileVersionedAPI;
		if (file.writable) {
			file.v.copy = vCopy.makeCaller(caller, vPath);
			file.v.getByteSink = vGetByteSink.makeCaller(caller, vPath);
			file.v.updateXAttrs = vUpdateXAttrs.makeCaller(caller, vPath);
			file.v.writeBytes = vWriteBytes.makeCaller(caller, vPath);
			file.v.writeJSON = vWriteJSON.makeCaller(caller, vPath);
			file.v.writeTxt = vWriteTxt.makeCaller(caller, vPath);
			file.v.archiveCurrent = vArchiveCurrent.makeCaller(caller, vPath);
		}
		if (fileMsg.isSynced) {
			const vsPath = methodPathFor<ReadonlyFileVersionedAPI>(vPath, 'sync');
			file.v.sync = {
				status: vsStatus.makeCaller(caller, vsPath),
				isRemoteVersionOnDisk: vsIsRemoteVersionOnDisk.makeCaller(caller, vsPath),
				startDownload: vsStartDownload.makeCaller(caller, vsPath),
				adoptRemote: vsAdoptRemote.makeCaller(caller, vsPath),
				diffCurrentAndRemoteVersions: vsDiffCurrentAndRemoteVersions.makeCaller(caller, vsPath)
			} as WritableFileSyncAPI;
			if (file.writable) {
				file.v.sync!.startUpload = vsStartUpload.makeCaller(caller, vsPath);
				file.v.sync!.upload = vsUpload.makeCaller(caller, vsPath);
			}
		}
	}
	caller.registerClientDrop(file, fileMsg.impl, fileMsg);
	return file;
}

export function exposeFileService(
	file: File, expServices: CoreSideServices
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
		implExp.copy = copy.wrapService((file as WritableFile).copy, expServices);
		implExp.getByteSink = getByteSink.wrapService((file as WritableFile).getByteSink, expServices);
		implExp.updateXAttrs = updateXAttrs.wrapService((file as WritableFile).updateXAttrs);
		implExp.writeBytes = writeBytes.wrapService((file as WritableFile).writeBytes);
		implExp.writeJSON = writeJSON.wrapService((file as WritableFile).writeJSON);
		implExp.writeTxt = writeTxt.wrapService((file as WritableFile).writeTxt);
	}
	if (file.v) {
		implExp.v = {
			getByteSource: vGetByteSource.wrapService(file.v.getByteSource, expServices),
			stat: vStat.wrapService(file.v.stat),
			getXAttr: vGetXAttr.wrapService(file.v.getXAttr),
			listXAttrs: vListXAttrs.wrapService(file.v.listXAttrs),
			readBytes: vReadBytes.wrapService(file.v.readBytes),
			readJSON: vReadJSON.wrapService(file.v.readJSON),
			readTxt: vReadTxt.wrapService(file.v.readTxt),
			listVersions: vListVersions.wrapService(file.v.listVersions)
		} as ExposedObj<WritableFileVersionedAPI>;
		if (file.writable) {
			implExp.v.copy = vCopy.wrapService((file.v as WritableFileVersionedAPI).copy, expServices);
			implExp.v.getByteSink = vGetByteSink.wrapService(
				(file.v as WritableFileVersionedAPI).getByteSink, expServices
			);
			implExp.v.updateXAttrs = vUpdateXAttrs.wrapService((file.v as WritableFileVersionedAPI).updateXAttrs);
			implExp.v.writeBytes = vWriteBytes.wrapService((file.v as WritableFileVersionedAPI).writeBytes);
			implExp.v.writeJSON = vWriteJSON.wrapService((file.v as WritableFileVersionedAPI).writeJSON);
			implExp.v.writeTxt = vWriteTxt.wrapService((file.v as WritableFileVersionedAPI).writeTxt);
			implExp.v.archiveCurrent = vArchiveCurrent.wrapService(
				(file.v as WritableFileVersionedAPI).archiveCurrent
			);
		}
		if (file.v.sync) {
			implExp.v.sync = {
				status: vsStatus.wrapService(file.v.sync.status),
				isRemoteVersionOnDisk: vsIsRemoteVersionOnDisk.wrapService(file.v.sync.isRemoteVersionOnDisk),
				startDownload: vsStartDownload.wrapService(file.v.sync.startDownload),
				adoptRemote: vsAdoptRemote.wrapService(file.v.sync.adoptRemote),
				diffCurrentAndRemoteVersions: vsDiffCurrentAndRemoteVersions.wrapService(
					file.v.sync.diffCurrentAndRemoteVersions
				),
			} as ExposedObj<WritableFileSyncAPI>;
			if (file.writable) {
				implExp.v.sync.startedUpload = vsStartUpload.wrapService((file.v.sync as WritableFileSyncAPI).startUpload);
				implExp.v.sync.upload = vsUpload.wrapService((file.v.sync as WritableFileSyncAPI).upload);
			}
		}
	}
	const impl = expServices.exposeDroppableService<'FileImpl'>('FileImpl', implExp, file);
	const fileMsg: FileMsg = {
		impl,
		isNew: file.isNew,
		name: file.name,
		writable: file.writable,
		isVersioned: !!file.v,
		isSynced: !!(file.v && file.v.sync)
	};
	return fileMsg;
}

export interface FileMsg {
	writable: boolean;
	isVersioned: boolean;
	isSynced: boolean;
	name: string;
	isNew: boolean;
	impl: ObjectReference<'FileImpl'>;
}

export const fileMsgType = ProtoType.for<FileMsg>(pb.File);

interface StatsMsg {
	isFile?: Value<boolean>;
	isFolder?: Value<boolean>;
	isLink?: Value<boolean>;
	writable: boolean;
	size?: Value<number>;
	mtime?: Value<number>;
	ctime?: Value<number>;
	version?: Value<number>;
	bytesNeedDownload?: Value<number>;
	versionSyncBranch?: Value<SyncBranch>;
}

const statsMsgType = ProtoType.for<StatsMsg>(pb.StatsMsg);

export function packStats(s: Stats): Buffer {
	return statsMsgType.pack(statsToMsg(s));
}

function statsToMsg(s: Stats): StatsMsg {
	return {
		writable: s.writable,
		isFile: toOptVal(s.isFile),
		isFolder: toOptVal(s.isFolder),
		isLink: toOptVal(s.isLink),
		ctime: (s.ctime ? toVal(s.ctime.valueOf()) : undefined),
		mtime: (s.mtime ? toVal(s.mtime.valueOf()) : undefined),
		size: toOptVal(s.size),
		version: toOptVal(s.version),
		bytesNeedDownload: toOptVal(s.bytesNeedDownload),
		versionSyncBranch: toOptVal(s.versionSyncBranch),
	};
}

export function unpackStats(buf: Buffer|void): Stats {
	return msgToStats(statsMsgType.unpack(buf));
}

function msgToStats(m: StatsMsg): Stats {
	return {
		writable: m.writable,
		isFile: valOfOpt(m.isFile),
		isFolder: valOfOpt(m.isFolder),
		isLink: valOfOpt(m.isLink),
		size: valOfOptInt(m.size),
		version: valOfOptInt(m.version),
		bytesNeedDownload: valOfOptInt(m.bytesNeedDownload),
		versionSyncBranch: valOfOpt(m.versionSyncBranch),
		ctime: (m.ctime ? new Date(valOfOptInt(m.ctime)!) : undefined),
		mtime: (m.mtime ? new Date(valOfOptInt(m.mtime)!) : undefined),
	};
}

interface SyncStatusMsg {
	state: string;
	synced?: SyncVersionsBranchMsg;
	local?: SyncVersionsBranchMsg;
	remote?: SyncVersionsBranchMsg;
	existsInSyncedParent?: Value<boolean>;
	uploading?: UploadingStateMsg;
}

interface SyncVersionsBranchMsg {
	latest?: Value<number>;
	archived?: number[];
	isArchived?: Value<boolean>;
}

interface UploadingStateMsg {
	localVersion: number;
	remoteVersion: number;
	bytesLeftToUpload: number;
	uploadStarted: boolean;
}

function syncStatusToMsg(s: SyncStatus|undefined): SyncStatusMsg|undefined {
	if (!s) { return; }
	return {
		state: s.state,
		local: syncBranchToMsg(s.local),
		synced: syncBranchToMsg(s.synced),
		remote: syncBranchToMsg(s.remote),
		existsInSyncedParent: toOptVal(s.existsInSyncedParent),
		uploading: uploadingToMsg(s.uploading)
	};
}

function msgToSyncStatus(m: SyncStatusMsg|undefined): SyncStatus|undefined {
	if (!m) { return; }
	return {
		state: m.state as SyncStatus['state'],
		local: msgToSyncBranch(m.local),
		synced: msgToSyncBranch(m.synced),
		remote: msgToSyncBranch(m.remote),
		existsInSyncedParent: valOfOpt(m.existsInSyncedParent),
		uploading: msgToUploading(m.uploading)
	};
}

function syncBranchToMsg(
	b: SyncVersionsBranch|undefined
): SyncVersionsBranchMsg|undefined {
	if (!b) { return; }
	return {
		latest: toOptVal(b.latest),
		archived: (b.archived ? b.archived : undefined),
		isArchived: toOptVal(b.isArchived)
	};
}

function msgToSyncBranch(
	m: SyncVersionsBranchMsg|undefined
): SyncVersionsBranch|undefined {
	if (!m) { return; }
	return {
		latest: valOfOptInt(m.latest),
		archived: ((m.archived!.length > 0) ? m.archived!.map(fixInt) : undefined),
		isArchived: valOfOpt(m.isArchived)
	};
}

function uploadingToMsg(u: SyncStatus['uploading']): UploadingStateMsg|undefined {
	if (!u) { return; }
	const { localVersion, remoteVersion, uploadStarted, bytesLeftToUpload } = u;
	return { localVersion, remoteVersion, uploadStarted, bytesLeftToUpload };
}

function msgToUploading(u: UploadingStateMsg|undefined): SyncStatus['uploading'] {
	if (!u) { return; }
	return {
		localVersion: fixInt(u.localVersion),
		remoteVersion: fixInt(u.remoteVersion),
		bytesLeftToUpload: fixInt(u.bytesLeftToUpload),
		uploadStarted: u.uploadStarted
	};
}

const syncStatusMsgType = ProtoType.for<SyncStatusMsg>(pb.SyncStatusMsg);

export function packSyncStatus(s: SyncStatus): Buffer {
	return syncStatusMsgType.pack(syncStatusToMsg(s)!);
}

export function unpackSyncStatus(buf: Buffer|void): SyncStatus {
	return msgToSyncStatus(syncStatusMsgType.unpack(buf))!;
}


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
		const path = methodPathFor<ReadonlyFile>(objPath, 'stat');
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

const xattrValueType = ProtoType.for<XAttrValue>(pb.XAttrValue);

export function packXAttrValue(val: any): EnvelopeBody {
	if (Buffer.isBuffer(val)) {
		return xattrValueType.pack({ bytes: toVal(val) });
	} else if (typeof val === 'string') {
		return xattrValueType.pack({ str: toVal(val) });
	} else if (val === undefined) {
		return xattrValueType.pack({});
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

	const requestType = ProtoType.for<Request>(pb.GetXAttrRequestBody);

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
		const path = methodPathFor<ReadonlyFile>(objPath, 'getXAttr');
		return xaName => caller
		.startPromiseCall(path, requestType.pack({ xaName }))
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
		const path = methodPathFor<ReadonlyFile>(objPath, 'listXAttrs');
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

	const requestType = ProtoType.for<Request>(pb.ReadBytesRequestBody);

	const replyType = ProtoType.for<Reply>(pb.ReadBytesReplyBody);

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
		const path = methodPathFor<ReadonlyFile>(objPath, 'readBytes');
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
			.then(txt => encodeToUtf8(txt) as Buffer);
			return { promise };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): ReadonlyFile['readTxt'] {
		const path = methodPathFor<ReadonlyFile>(objPath, 'readTxt');
		return () => caller
		.startPromiseCall(path, undefined)
		.then(buf => (buf ? decodeFromUtf8(buf) : ''));
	}

}
Object.freeze(readTxt);


export function packJSON(json: any): EnvelopeBody {
	return encodeToUtf8(JSON.stringify(json)) as Buffer;
}

export function unpackJSON(buf: EnvelopeBody): any {
	if (!buf) { throw makeIPCException({ missingBodyBytes: true }); }
	try {
		return JSON.parse(decodeFromUtf8(buf));
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
		const path = methodPathFor<ReadonlyFile>(objPath, 'readJSON');
		return () => caller
		.startPromiseCall(path, undefined)
		.then(unpackJSON);
	}

}
Object.freeze(readJSON);


namespace getByteSource {

	export function wrapService(
		fn: ReadonlyFile['getByteSource'], expServices: CoreSideServices
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
		const path = methodPathFor<ReadonlyFile>(objPath, 'getByteSource');
		return () => caller
		.startPromiseCall(path, undefined)
		.then(buf => {
			const ref = objRefType.unpack(buf);
			return makeSrcCaller(caller, ref);
		});
	}

}
Object.freeze(getByteSource);


const stringValueType = ProtoType.for<Value<string>>(commonPB.StringValue);

export function packEvent<T extends object>(e: T): Buffer {
	return stringValueType.pack(toVal(JSON.stringify(e)));
}

export function unpackEvent<T extends object>(buf: EnvelopeBody): T {
	return JSON.parse(stringValueType.unpack(buf).value);
}


namespace watch {

	export function wrapService(fn: ReadonlyFile['watch']): ExposedFn {
		return buf => {
			const s = new Subject<FileEvent|RemoteEvent>();
			const obs = s.asObservable().pipe(
				map(packEvent)
			);
			const onCancel = fn(s);
			return { obs, onCancel };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): ReadonlyFile['watch'] {
		const path = methodPathFor<ReadonlyFile>(objPath, 'watch');
		return obs => {
			const s = new Subject<EnvelopeBody>();
			const unsub = caller.startObservableCall(path, undefined, s);
			s.asObservable()
			.pipe(
				map(unpackEvent)
			)
			.subscribe(toRxObserver(obs));
			return unsub;
		};
	}

}
Object.freeze(watch);


export interface VersionedReadFlagsMsg {
	archivedVersion?: Value<number>;
	remoteVersion?: Value<number>;
}

export function versionedReadFlagsFromMsg(
	msg: VersionedReadFlagsMsg|undefined
): VersionedReadFlags|undefined {
	if (!msg) { return; }
	return {
		archivedVersion: valOfOptInt(msg.archivedVersion),
		remoteVersion: valOfOptInt(msg.remoteVersion)
	};
}

export function versionedReadFlagsToMsg(
	flags: VersionedReadFlags|undefined
): VersionedReadFlagsMsg|undefined {
	if (!flags) { return; }
	return {
		archivedVersion: toOptVal(flags.archivedVersion),
		remoteVersion: toOptVal(flags.remoteVersion)
	};
}


export namespace vStat {

	export function wrapService(fn: ReadonlyFileVersionedAPI['stat']): ExposedFn {
		return buf => {
			const promise = fn(unpackVersionedReadFlagsRequest(buf!))
			.then(packStats);
			return { promise };
		};
	}

	export function makeCaller(caller: Caller, objPath: string[]): ReadonlyFileVersionedAPI['stat'] {
		const path = methodPathFor<ReadonlyFileVersionedAPI>(objPath, 'stat');
		return flags => caller
		.startPromiseCall(path, packVersionedReadFlagsRequest(flags))
		.then(unpackStats);
	}

}
Object.freeze(vStat);


export namespace vGetXAttr {

	interface Request {
		xaName: string;
		flags?: VersionedReadFlagsMsg;
	}

	const requestType = ProtoType.for<Request>(pb.VersionedGetXAttrRequestBody);

	export interface Reply {
		version: number;
		str?: Value<string>;
		json?: Value<string>;
		bytes?: Value<Buffer>;
	}

	export const replyType = ProtoType.for<Reply>(pb.VersionedGetXAttrReplyBody);

	export function unpackReply(buf: EnvelopeBody): {
		attr: any; version: number;
	} {
		const { json, str, bytes, version: v } = replyType.unpack(buf);
		const version = fixInt(v);
		if (bytes) {
			return { version, attr: valOf(bytes) };
		} else if (str) {
			return { version, attr: valOf(str) };
		} else {
			return { version, attr: valOfOptJson(json) };
		}
	}

	export function wrapService(
		fn: ReadonlyFileVersionedAPI['getXAttr']
	): ExposedFn {
		return buf => {
			const { xaName, flags } = requestType.unpack(buf);
			const promise = fn(xaName, versionedReadFlagsFromMsg(flags))
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
		const path = methodPathFor<ReadonlyFileVersionedAPI>(objPath, 'getXAttr');
		return (xaName, flags) => caller
		.startPromiseCall(path, requestType.pack({
			xaName, flags: versionedReadFlagsToMsg(flags)
		}))
		.then(unpackReply);
	}

}
Object.freeze(vGetXAttr);


const requestWithReadFlags = ProtoType.for<{
	flags?: VersionedReadFlagsMsg;
}>(pb.RequestWithVersionedReadFlags);

function packVersionedReadFlagsRequest(
	flags: VersionedReadFlags|undefined
): Buffer {
	return requestWithReadFlags.pack({
		flags: versionedReadFlagsToMsg(flags)
	});
}

function unpackVersionedReadFlagsRequest(
	buf: Buffer
): VersionedReadFlags|undefined {
	const { flags } = requestWithReadFlags.unpack(buf);
	return versionedReadFlagsFromMsg(flags);
}


export namespace vListXAttrs {

	export interface Reply {
		version: number;
		xaNames: string[];
	}

	export const replyType = ProtoType.for<Reply>(
		pb.VersionedListXAttrsReplyBody
	);

	export function wrapService(
		fn: ReadonlyFileVersionedAPI['listXAttrs']
	): ExposedFn {
		return buf => {
			const promise = fn(unpackVersionedReadFlagsRequest(buf!))
			.then(({ version, lst }) => replyType.pack({ version, xaNames: lst }));
			return { promise };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): ReadonlyFileVersionedAPI['listXAttrs'] {
		const path = methodPathFor<ReadonlyFile>(objPath, 'listXAttrs');
		return flags => caller
		.startPromiseCall(path, packVersionedReadFlagsRequest(flags))
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
		flags?: VersionedReadFlagsMsg;
	}

	const requestType = ProtoType.for<Request>(pb.VersionedReadBytesRequestBody);

	interface Reply {
		version: number;
		bytes?: Value<Uint8Array>;
	}

	const replyType = ProtoType.for<Reply>(pb.VersionedReadBytesReplyBody);

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
			const { start, end, flags } = requestType.unpack(buf);
			const promise = fn(
				valOfOptInt(start), valOfOptInt(end),
				versionedReadFlagsFromMsg(flags)
			)
			.then(packReply);
			return { promise };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): ReadonlyFileVersionedAPI['readBytes'] {
		const path = methodPathFor<ReadonlyFile>(objPath, 'readBytes');
		return (start, end, flags) => caller
		.startPromiseCall(path, requestType.pack({
			start: toOptVal(start), end: toOptVal(end),
			flags: versionedReadFlagsToMsg(flags)
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

	export const replyType = ProtoType.for<Reply>(pb.VersionedReadTxtReplyBody);

	export function wrapService(
		fn: ReadonlyFileVersionedAPI['readTxt']
	): ExposedFn {
		return buf => {
			const promise = fn(unpackVersionedReadFlagsRequest(buf!))
			.then(verAndTxt => replyType.pack(verAndTxt));
			return { promise };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): ReadonlyFileVersionedAPI['readTxt'] {
		const path = methodPathFor<ReadonlyFile>(objPath, 'readTxt');
		return flags => caller
		.startPromiseCall(path, packVersionedReadFlagsRequest(flags))
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

	export const replyType = ProtoType.for<Reply>(pb.VersionedReadJsonReplyBody);

	export function wrapService(
		fn: ReadonlyFileVersionedAPI['readJSON']
	): ExposedFn {
		return buf => {
			const promise = fn(unpackVersionedReadFlagsRequest(buf!))
			.then(({ version, json }) => {
				return replyType.pack({ version, json: JSON.stringify(json) });
			});
			return { promise };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): ReadonlyFileVersionedAPI['readJSON'] {
		const path = methodPathFor<ReadonlyFile>(objPath, 'readJSON');
		return flags => caller
		.startPromiseCall(path, packVersionedReadFlagsRequest(flags))
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
		src: ObjectReference<'FileByteSource'>;
	}

	export const replyType = ProtoType.for<Reply>(
		pb.VersionedGetByteSourceReplyBody
	);

	export function wrapService(
		fn: ReadonlyFileVersionedAPI['getByteSource'],
		expServices: CoreSideServices
	): ExposedFn {
		return buf => {
			const promise = fn(unpackVersionedReadFlagsRequest(buf!))
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
		const path = methodPathFor<ReadonlyFile>(objPath, 'getByteSource');
		return flags => caller
		.startPromiseCall(path, packVersionedReadFlagsRequest(flags))
		.then(buf => {
			const { version: v, src: ref } = replyType.unpack(buf);
			return { version: fixInt(v), src: makeSrcCaller(caller, ref) };
		});
	}

}
Object.freeze(vGetByteSource);


export interface XAttrMsg {
	xaName: string;
	str?: Value<string>;
	json?: Value<string>;
	bytes?: Value<Buffer>;
}

export function xattrToMsg(xaName: string, val: any): XAttrMsg {
	const msg: XAttrMsg = { xaName };
	if (Buffer.isBuffer(val)) {
		msg.bytes = toVal(val);
	} else if (ArrayBuffer.isView(val)) {
		msg.bytes = toVal(toBuffer(val as Uint8Array));
	} else if (typeof val === 'string') {
		msg.str = toVal(val);
	} else {
		msg.json = toOptJson(val);
	}
	return msg;
}

export function xattrFromMsg(msg: XAttrMsg): { name: string; value: any; } {
	const { xaName: name } = msg;
	if (msg.bytes) {
		return { name, value: valOf(msg.bytes) };
	} else if (msg.str) {
		return { name, value: valOf(msg.str) };
	} else {
		return { name, value: valOfOptJson(msg.json) };
	}
}


export namespace updateXAttrs {

	export interface Request {
		changes: {
			set: XAttrMsg[];
			remove: string[];
		};
	}
	
	const requestType = ProtoType.for<Request>(pb.UpdateXAttrsRequestBody);

	export function fromReqChanges(r: Request['changes']): XAttrsChanges {
		const attrs: XAttrsChanges = {};
		if (r.set) {
			attrs.set = {};
			for (const xattr of r.set) {
				const { name, value } = xattrFromMsg(xattr);
				attrs.set[name] = value;
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
				r.set.push(xattrToMsg(xaName, val));
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
		const path = methodPathFor<WritableFile>(objPath, 'updateXAttrs');
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

	const requestType = ProtoType.for<Request>(pb.WriteBytesRequestBody);

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
		const path = methodPathFor<WritableFile>(objPath, 'writeBytes');
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

	const requestType = ProtoType.for<Request>(pb.WriteTxtRequestBody);

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
		const path = methodPathFor<WritableFile>(objPath, 'writeTxt');
		return txt => caller
		.startPromiseCall(path, requestType.pack({ txt })) as Promise<void>;
	}

}
Object.freeze(writeTxt);


namespace writeJSON {

	interface Request {
		json: string;
	}

	const requestType = ProtoType.for<Request>(pb.WriteJsonRequestBody);

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
		const path = methodPathFor<WritableFile>(objPath, 'writeJSON');
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

	const requestType = ProtoType.for<Request>(pb.GetByteSinkRequestBody);

	export function wrapService(
		fn: WritableFile['getByteSink'], expServices: CoreSideServices
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
		const path = methodPathFor<WritableFile>(objPath, 'getByteSink');
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
		file: ObjectReference<'FileImpl'>;
	}

	export const requestType = ProtoType.for<Request>(pb.CopyRequestBody);

	export function wrapService(
		fn: WritableFile['copy'], expServices: CoreSideServices
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
		const path = methodPathFor<WritableFile>(objPath, 'copy');
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
		fn: WritableFileVersionedAPI['copy'], expServices: CoreSideServices
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
		const path = methodPathFor<WritableFileVersionedAPI>(objPath, 'copy');
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
		const path = methodPathFor<WritableFileVersionedAPI>(
			objPath, 'updateXAttrs'
		);
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

	const requestType = ProtoType.for<Request>(pb.WriteBytesRequestBody);

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
		const path = methodPathFor<WritableFileVersionedAPI>(
			objPath, 'writeBytes'
		);
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

	const requestType = ProtoType.for<Request>(pb.WriteTxtRequestBody);

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
		const path = methodPathFor<WritableFileVersionedAPI>(
			objPath, 'writeTxt'
		);
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

	const requestType = ProtoType.for<Request>(pb.WriteJsonRequestBody);

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
		const path = methodPathFor<WritableFileVersionedAPI>(
			objPath, 'writeJSON'
		);
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

	const requestType = ProtoType.for<Request>(
		pb.VersionedGetByteSinkRequestBody);

	export interface Reply {
		version: number;
		sink: ObjectReference<'FileByteSink'>;
	}

	export const replyType = ProtoType.for<Reply>(
		pb.VersionedGetByteSinkReplyBody);

	export function wrapService(
		fn: WritableFileVersionedAPI['getByteSink'], expServices: CoreSideServices
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
		const path = methodPathFor<WritableFileVersionedAPI>(
			objPath, 'getByteSink'
		);
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


namespace vsStatus {

	export function wrapService(fn: ReadonlyFileSyncAPI['status']): ExposedFn {
		return buf => {
			const promise = fn(boolValType.unpack(buf).value)
			.then(packSyncStatus);
			return { promise };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): ReadonlyFileSyncAPI['status'] {
		const path = methodPathFor<ReadonlyFileSyncAPI>(objPath, 'status');
		return (skipServerCheck) => caller
		.startPromiseCall(path, boolValType.pack(toVal(!!skipServerCheck)))
		.then(unpackSyncStatus);
	}

}
Object.freeze(vsStatus);


namespace vsIsRemoteVersionOnDisk {

	const requestType = ProtoType.for<{
		version: number;
	}>(pb.FileSyncIsOnDiskRequestBody);

	const replyType = ProtoType.for<{
		status: 'partial'|'complete'|'none'
	}>(pb.FileSyncIsOnDiskReplyBody);

	export function wrapService(
		fn: ReadonlyFileSyncAPI['isRemoteVersionOnDisk']
	): ExposedFn {
		return buf => {
			const { version } = requestType.unpack(buf);
			const promise = fn(fixInt(version))
			.then(status => replyType.pack({ status }));
			return { promise };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): ReadonlyFileSyncAPI['isRemoteVersionOnDisk'] {
		const path = methodPathFor<ReadonlyFileSyncAPI>(
			objPath, 'isRemoteVersionOnDisk'
		);
		return version => caller
		.startPromiseCall(path, requestType.pack({ version }))
		.then(buf => replyType.unpack(buf).status);
	}

}
Object.freeze(vsIsRemoteVersionOnDisk);


export namespace vsStartDownload {

	const requestType = ProtoType.for<{
		version: number;
	}>(pb.FileSyncStartDownloadRequestBody);

	export const replyType = ProtoType.for<{
		startedDownload?: {
			downloadTaskId: number;
		};
	}>(pb.FileSyncStartDownloadReplyBody);

	export function wrapService(fn: ReadonlyFileSyncAPI['startDownload']): ExposedFn {
		return buf => {
			const { version } = requestType.unpack(buf);
			const promise = fn(fixInt(version))
			.then(startedDownload => replyType.pack({ startedDownload }));
			return { promise };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): ReadonlyFileSyncAPI['startDownload'] {
		const path = methodPathFor<ReadonlyFileSyncAPI>(objPath, 'startDownload');
		return version => caller
		.startPromiseCall(path, requestType.pack({ version }))
		.then(buf => {
			const { startedDownload } = replyType.unpack(buf);
			if (startedDownload) {
				return {
					downloadTaskId: fixInt(startedDownload.downloadTaskId)
				};
			}
		});		
	}

}
Object.freeze(vsStartDownload);


export interface OptionsToUploadLocalMsg {
	localVersion?: Value<number>;
	uploadVersion?: Value<number>;
}

export function optionsToUploadLocalToMsg(
	opts?: OptionsToUploadLocal
): OptionsToUploadLocalMsg|undefined {
	if (!opts) { return; }
	return {
		localVersion: toOptVal(opts.localVersion),
		uploadVersion: toOptVal(opts.uploadVersion)
	};
}

export function optionsToUploadLocalFromMsg(
	opts?: OptionsToUploadLocalMsg
): OptionsToUploadLocal|undefined {
	if (!opts) { return; }
	return {
		localVersion: valOfOptInt(opts.localVersion),
		uploadVersion: valOfOptInt(opts.uploadVersion)
	};
}


export namespace vsStartUpload {

	export const requestType = ProtoType.for<{
		opts?: OptionsToUploadLocalMsg;
	}>(pb.FileSyncUploadRequestBody);

	export const replyType = ProtoType.for<{
		startedUpload?: {
			uploadVersion: number;
			uploadTaskId: number;
		};
	}>(pb.FileSyncStartUploadReplyBody);

	export function wrapService(fn: WritableFileSyncAPI['startUpload']): ExposedFn {
		return buf => {
			const { opts } = requestType.unpack(buf);
			const promise = fn(optionsToUploadLocalFromMsg(opts))
			.then(startedUpload => replyType.pack({ startedUpload }));
			return { promise };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): WritableFileSyncAPI['startUpload'] {
		const path = methodPathFor<WritableFileSyncAPI>(objPath, 'startUpload');
		return opts => caller
		.startPromiseCall(path, requestType.pack({
			opts: optionsToUploadLocalToMsg(opts)
		}))
		.then(buf => {
			const { startedUpload } = replyType.unpack(buf);
			if (startedUpload) {
				const { uploadTaskId, uploadVersion } = startedUpload;
				return {
					uploadVersion: fixInt(uploadVersion),
					uploadTaskId: fixInt(uploadTaskId)
				}
			}
		});
	}

}
Object.freeze(vsStartUpload);


export namespace vsUpload {

	export const replyType = ProtoType.for<{
		uploadedVersion?: Value<number>;
	}>(pb.FileSyncUploadReplyBody);

	export function wrapService(fn: WritableFileSyncAPI['upload']): ExposedFn {
		return buf => {
			const { opts } = vsStartUpload.requestType.unpack(buf);
			const promise = fn(optionsToUploadLocalFromMsg(opts))
			.then(uploadedVersion => replyType.pack({
				uploadedVersion: toOptVal(uploadedVersion)
			}));
			return { promise };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): WritableFileSyncAPI['upload'] {
		const path = methodPathFor<WritableFileSyncAPI>(objPath, 'upload');
		return opts => caller
		.startPromiseCall(path, vsStartUpload.requestType.pack({
			opts: optionsToUploadLocalToMsg(opts)
		}))
		.then(buf => valOfOptInt(replyType.unpack(buf).uploadedVersion));
	}

}
Object.freeze(vsUpload);


export interface OptionsToAdopteRemoteMsg {
	dropLocalVer?: Value<boolean>;
	remoteVersion?: Value<number>;
}

export function remoteAdoptionOptsToMsg(
	opts: OptionsToAdopteRemote|undefined
): OptionsToAdopteRemoteMsg|undefined {
	if (!opts) { return; }
	return {
		// dropLocalVer: toOptVal(opts.dropLocalVer),
		remoteVersion: toOptVal(opts.remoteVersion)
	};
}

export function remoteAdoptionOptsFromMsg(
	msg: OptionsToAdopteRemoteMsg|undefined
): OptionsToAdopteRemote|undefined {
	if (!msg) { return; }
	return {
		// dropLocalVer: valOfOpt(msg.dropLocalVer),
		remoteVersion: valOfOptInt(msg.remoteVersion)
	}
}


namespace vsAdoptRemote {

	const requestType = ProtoType.for<{
		opts?: OptionsToAdopteRemoteMsg;
	}>(pb.AdoptRemoteRequestBody);

	export function wrapService(
		fn: ReadonlyFileSyncAPI['adoptRemote']
	): ExposedFn {
		return buf => {
			const { opts } = requestType.unpack(buf);
			const promise = fn(remoteAdoptionOptsFromMsg(opts));
			return { promise };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): ReadonlyFileSyncAPI['adoptRemote'] {
		const path = methodPathFor<ReadonlyFileSyncAPI>(objPath, 'adoptRemote');
		return opts => caller
		.startPromiseCall(path, requestType.pack({
			opts: remoteAdoptionOptsToMsg(opts)
		})) as Promise<void>;
	}

}
Object.freeze(vsAdoptRemote);


export namespace vListVersions {

	const replyType = ProtoType.for<{
		current?: Value<number>;
		archived?: number[];
	}>(pb.ListVersionsReplyBody);

	export function packReply(
		v: { current?: number; archived?: number[]; }
	): Buffer {
		return replyType.pack({
			current: toOptVal(v.current),
			archived: v.archived
		});
	}

	export function unpackReply(
		b: Buffer
	): { current?: number; archived?: number[]; } {
		const r = replyType.unpack(b);
		return {
			current: valOfOptInt(r.current),
			archived: ((r.archived!.length > 0) ?
				r.archived!.map(fixInt) : undefined)
		};
	}

	export function wrapService(
		fn: ReadonlyFileVersionedAPI['listVersions']
	): ExposedFn {
		return () => {
			const promise = fn()
			.then(packReply);
			return { promise };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): ReadonlyFileVersionedAPI['listVersions'] {
		const path = methodPathFor<ReadonlyFileVersionedAPI>(
			objPath, 'listVersions'
		);
		return () => caller
		.startPromiseCall(path)
		.then(unpackReply);
	}

}
Object.freeze(vListVersions);


namespace vArchiveCurrent {

	const requestType = ProtoType.for<{
		version?: Value<number>;
	}>(pb.ArchiveCurrentRequestBody);

	export function wrapService(
		fn: WritableFileVersionedAPI['archiveCurrent']
	): ExposedFn {
		return buf => {
			const { version } = requestType.unpack(buf);
			const promise = fn(valOfOptInt(version))
			.then(packInt);
			return { promise };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): WritableFileVersionedAPI['archiveCurrent'] {
		const path = methodPathFor<WritableFileVersionedAPI>(
			objPath, 'archiveCurrent'
		);
		return version => caller
		.startPromiseCall(path, requestType.pack({ version: toOptVal(version) }))
		.then(unpackInt);
	}

}
Object.freeze(vArchiveCurrent);


export interface CommonDiffMsg {
	remoteVersion?: Value<number>;
	currentVersion: number;
	syncedVersion?: Value<number>;
	isCurrentLocal: boolean;
	isRemoteRemoved: boolean;
	ctime?: DiffTimeStampsMsg;
	mtime?: DiffTimeStampsMsg;
	xattrs?: {
		name: string;
		addedIn?: Value<'l'|'r'|'l&r'>;
		removedIn?: Value<'l'|'r'>;
		changedIn?: Value<'l'|'r'|'l&r'>;
	}[];
}

export interface DiffTimeStampsMsg {
	remote: number;
	current: number;
	synced: number;
}

export interface FileDiffMsg extends CommonDiffMsg {
	areContentsSame: boolean;
	size?: {
		remote: number;
		current: number;
	};
}

function diffTStoMsg(diffTS: CommonDiff['ctime']): CommonDiffMsg['ctime'] {
	return (diffTS ? {
		current: diffTS.current.valueOf(),
		remote: diffTS.remote.valueOf(),
		synced: diffTS.synced.valueOf(),
	} : undefined);
}

function diffTSfromMsg(msg: CommonDiffMsg['ctime']): CommonDiff['ctime'] {
	return (msg ? {
		current: new Date(fixInt(msg.current)),
		remote: new Date(fixInt(msg.remote)),
		synced: new Date(fixInt(msg.synced)),
	} : undefined);
}

export function commonDiffToMsg(diff: CommonDiff): CommonDiffMsg {
	return {
		remoteVersion: toOptVal(diff.remoteVersion),
		currentVersion: diff.currentVersion,
		syncedVersion: toOptVal(diff.syncedVersion),
		isCurrentLocal: diff.isCurrentLocal,
		isRemoteRemoved: diff.isRemoteRemoved,
		ctime: diffTStoMsg((diff.ctime)),
		mtime: diffTStoMsg(diff.mtime),
		xattrs: (diff.xattrs ? Object.entries(diff.xattrs).map(([name, { addedIn, changedIn, removedIn }]) => ({
			name,
			addedIn: toOptVal(addedIn),
			changedIn: toOptVal(changedIn),
			removedIn: toOptVal(removedIn)
		})) : undefined)
	};
}

export function commonDiffFromMsg(msg: CommonDiffMsg): CommonDiff {
	let xattrs: CommonDiff['xattrs'] = undefined;
	if (msg.xattrs && (msg.xattrs.length > 0)) {
		xattrs = {};
		for (const { name, addedIn, changedIn, removedIn } of msg.xattrs) {
			xattrs[name] = {
				addedIn: valOfOpt(addedIn),
				changedIn: valOfOpt(changedIn),
				removedIn: valOfOpt(removedIn),
			};
		}
	}
	return {
		remoteVersion: valOfOptInt(msg.remoteVersion),
		currentVersion: fixInt(msg.currentVersion),
		syncedVersion: valOfOptInt(msg.syncedVersion),
		isCurrentLocal: msg.isCurrentLocal,
		isRemoteRemoved: msg.isRemoteRemoved,
		ctime: diffTSfromMsg(msg.ctime),
		mtime: diffTSfromMsg(msg.mtime),
		xattrs
	};
}

export function fileDiffToMsg(diff: FileDiff|undefined): FileDiffMsg|undefined {
	if (!diff) { return; }
	return {
		...commonDiffToMsg(diff),
		areContentsSame: diff.areContentsSame,
		size: diff.size
	};
}

export function fileDiffFromMsg(msg: FileDiffMsg|undefined): FileDiff|undefined {
	if (!msg) { return; }
	return {
		...commonDiffFromMsg(msg),
		areContentsSame: msg.areContentsSame,
		size: (msg.size ? {
			current: fixInt(msg.size.current),
			remote: fixInt(msg.size.remote)
		} : undefined)
	};
}


export namespace vsDiffCurrentAndRemoteVersions {

	export interface OptionsMsg {
		remoteVersion?: Value<number>;
		compareContentIfSameMTime?: Value<boolean>;
	}

	export function optsFromMsg(opts: OptionsMsg|undefined): OptionsToDiffFileVersions|undefined {
		return (opts ? {
			remoteVersion: valOfOptInt(opts.remoteVersion),
			compareContentIfSameMTime: valOfOpt(opts.compareContentIfSameMTime)
		} : undefined);
	}

	export function optsToMsg(opts: OptionsToDiffFileVersions|undefined): OptionsMsg|undefined {
		return (opts ? {
			remoteVersion: toOptVal(opts.remoteVersion),
			compareContentIfSameMTime: toOptVal(opts.compareContentIfSameMTime)
		} : undefined);
	}

	const requestType = ProtoType.for<{
		opts?: OptionsMsg;
	}>(pb.DiffCurrentAndRemoteRequestBody);

	export const replyType = ProtoType.for<{
		diff?: FileDiffMsg;
	}>(pb.DiffCurrentAndRemoteReplyBody);

	export function wrapService(
		fn: ReadonlyFileSyncAPI['diffCurrentAndRemoteVersions']
	): ExposedFn {
		return buf => {
			const { opts } = requestType.unpack(buf);
			const promise = fn(optsFromMsg(opts))
			.then(diff => replyType.pack({ diff: fileDiffToMsg(diff) }));
			return { promise };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): ReadonlyFileSyncAPI['diffCurrentAndRemoteVersions'] {
		const ipcPath = methodPathFor<ReadonlyFileSyncAPI>(
			objPath, 'diffCurrentAndRemoteVersions'
		);
		return opts => caller
		.startPromiseCall(ipcPath, requestType.pack({ opts: optsToMsg(opts) }))
		.then(buf => fileDiffFromMsg(replyType.unpack(buf).diff));
	}

}
Object.freeze(vsDiffCurrentAndRemoteVersions);


Object.freeze(exports);