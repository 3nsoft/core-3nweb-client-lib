/*
 Copyright (C) 2016 - 2022, 2025 3NSoft Inc.

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

type FS = web3n.files.FS;
type FSType = web3n.files.FSType;
type ReadonlyFS = web3n.files.ReadonlyFS;
type WritableFS = web3n.files.WritableFS;
type ReadonlyFSVersionedAPI = web3n.files.ReadonlyFSVersionedAPI;
type WritableFSVersionedAPI = web3n.files.WritableFSVersionedAPI;
type ReadonlyFSSyncAPI = web3n.files.ReadonlyFSSyncAPI;
type WritableFSSyncAPI = web3n.files.WritableFSSyncAPI;
type File = web3n.files.File;
type ReadonlyFile = web3n.files.ReadonlyFile;
type WritableFile = web3n.files.WritableFile;
type ReadonlyFileVersionedAPI = web3n.files.ReadonlyFileVersionedAPI;
type WritableFileVersionedAPI = web3n.files.WritableFileVersionedAPI;
type ReadonlyFileSyncAPI = web3n.files.ReadonlyFileSyncAPI;
type WritableFileSyncAPI = web3n.files.WritableFileSyncAPI;

export interface LinkParameters<T> {
	storageType: FSType;
	readonly?: boolean;
	isFolder?: boolean;
	isFile?: boolean;
	params: T;
}

/**
 * This interface is applicable to core-side FS and File objects.
 * NOTICE: when renaming this function, ensure renaming in excluded fields,
 * in wrapping for UI app functionality, used in a preload script portion.
 * Raw string is used there, and automagic renaming will not work there.
 */
export interface Linkable {
	getLinkParams(): Promise<LinkParameters<any>>;
}

export function wrapFileImplementation(fImpl: File): File {
	return (fImpl.writable ?
			wrapWritableFile(fImpl as WritableFile) :
			wrapReadonlyFile(fImpl as ReadonlyFile));
}

export function wrapWritableFile(fImpl: WritableFile): WritableFile {
	ensureWritable(fImpl);
	const w: WritableFile = {
		v: wrapWritableFileVersionedAPI(fImpl.v),
		writable: fImpl.writable,
		isNew: fImpl.isNew,
		name: fImpl.name,
		getByteSource: fImpl.getByteSource.bind(fImpl),
		readJSON: fImpl.readJSON.bind(fImpl) as WritableFile['readJSON'],
		readTxt: fImpl.readTxt.bind(fImpl),
		readBytes: fImpl.readBytes.bind(fImpl),
		stat: fImpl.stat.bind(fImpl),
		watch: fImpl.watch.bind(fImpl),
		getByteSink: fImpl.getByteSink.bind(fImpl),
		writeJSON: fImpl.writeJSON.bind(fImpl),
		writeTxt: fImpl.writeTxt.bind(fImpl),
		writeBytes: fImpl.writeBytes.bind(fImpl),
		copy: fImpl.copy.bind(fImpl),
		getXAttr: fImpl.getXAttr.bind(fImpl),
		listXAttrs: fImpl.listXAttrs.bind(fImpl),
		updateXAttrs: fImpl.updateXAttrs.bind(fImpl)
	};
	return addParamsAndFreezeFileWrap(w, fImpl);
}

function ensureWritable(o: { writable: boolean }): void {
	if (!o.writable) {
		throw Error(`File/FS object with unexpected flags is given`);
	}
}

function wrapWritableFileVersionedAPI(
	vImpl: WritableFileVersionedAPI|undefined
): WritableFileVersionedAPI|undefined {
	if (!vImpl) { return; }
	const w: WritableFileVersionedAPI = {
		stat: vImpl.stat.bind(vImpl),
		getXAttr: vImpl.getXAttr.bind(vImpl),
		listXAttrs: vImpl.listXAttrs.bind(vImpl),
		updateXAttrs: vImpl.updateXAttrs.bind(vImpl),
		copy: vImpl.copy.bind(vImpl),
		getByteSink: vImpl.getByteSink.bind(vImpl),
		getByteSource: vImpl.getByteSource.bind(vImpl),
		readBytes: vImpl.readBytes.bind(vImpl),
		readJSON: vImpl.readJSON.bind(vImpl) as WritableFileVersionedAPI['readJSON'],
		readTxt: vImpl.readTxt.bind(vImpl),
		writeBytes: vImpl.writeBytes.bind(vImpl),
		writeJSON: vImpl.writeJSON.bind(vImpl),
		writeTxt: vImpl.writeTxt.bind(vImpl),
		archiveCurrent: vImpl.archiveCurrent.bind(vImpl),
		listVersions: vImpl.listVersions.bind(vImpl),
		sync: wrapWritableFileSyncAPI(vImpl.sync)
	};
	return Object.freeze(w);
}

function wrapWritableFileSyncAPI(
	sImpl: WritableFileSyncAPI|undefined
): WritableFileSyncAPI|undefined {
	if (!sImpl) { return; }
	const w: WritableFileSyncAPI = {
		status: sImpl.status.bind(sImpl),
		startDownload: sImpl.startDownload.bind(sImpl),
		isRemoteVersionOnDisk: sImpl.isRemoteVersionOnDisk.bind(sImpl),
		startUpload: sImpl.startUpload.bind(sImpl),
		upload: sImpl.upload.bind(sImpl),
		adoptRemote: sImpl.adoptRemote.bind(sImpl),
	};
	return Object.freeze(w);
}

function addParamsAndFreezeFileWrap<T extends ReadonlyFile>(w: T, fImpl: T): T {
	(w as any as Linkable).getLinkParams =
		(fImpl as any as Linkable).getLinkParams.bind(fImpl);
	return Object.freeze(w);
}

export function wrapReadonlyFile(fImpl: ReadonlyFile): ReadonlyFile {
	const w: ReadonlyFile = {
		v: wrapReadonlyFileVersionedAPI(fImpl.v),
		writable: false,
		isNew: fImpl.isNew,
		name: fImpl.name,
		getByteSource: fImpl.getByteSource.bind(fImpl),
		readJSON: fImpl.readJSON.bind(fImpl) as ReadonlyFile['readJSON'],
		readTxt: fImpl.readTxt.bind(fImpl),
		readBytes: fImpl.readBytes.bind(fImpl),
		stat: fImpl.stat.bind(fImpl),
		watch: fImpl.watch.bind(fImpl),
		getXAttr: fImpl.getXAttr.bind(fImpl),
		listXAttrs: fImpl.listXAttrs.bind(fImpl),
	};
	return addParamsAndFreezeFileWrap(w, fImpl);
}

function wrapReadonlyFileVersionedAPI(
	vImpl: ReadonlyFileVersionedAPI|undefined
): ReadonlyFileVersionedAPI|undefined {
	if (!vImpl) { return; }
	const w: ReadonlyFileVersionedAPI = {
		stat: vImpl.stat.bind(vImpl),
		getXAttr: vImpl.getXAttr.bind(vImpl),
		listXAttrs: vImpl.listXAttrs.bind(vImpl),
		getByteSource: vImpl.getByteSource.bind(vImpl),
		readBytes: vImpl.readBytes.bind(vImpl),
		readJSON: vImpl.readJSON.bind(vImpl) as ReadonlyFileVersionedAPI['readJSON'],
		readTxt: vImpl.readTxt.bind(vImpl),
		listVersions: vImpl.listVersions.bind(vImpl),
		sync: wrapReadonlyFileSyncAPI(vImpl.sync)
	};
	return Object.freeze(w);
}

function wrapReadonlyFileSyncAPI(
	sImpl: ReadonlyFileSyncAPI|undefined
): ReadonlyFileSyncAPI|undefined {
	if (!sImpl) { return; }
	const w: ReadonlyFileSyncAPI = {
		status: sImpl.status.bind(sImpl),
		startDownload: sImpl.startDownload.bind(sImpl),
		isRemoteVersionOnDisk: sImpl.isRemoteVersionOnDisk.bind(sImpl),
		adoptRemote: sImpl.adoptRemote.bind(sImpl),
	};
	return Object.freeze(w);
}

export function wrapFSImplementation(fsImpl: FS): FS {
	return (fsImpl.writable ?
			wrapWritableFS(fsImpl as WritableFS) :
			wrapReadonlyFS(fsImpl as ReadonlyFS));
}

export function wrapWritableFS(fsImpl: WritableFS): WritableFS {
	ensureWritable(fsImpl);
	const w: WritableFS = {
		type: fsImpl.type,
		writable: fsImpl.writable,
		v: wrapWritableFSVersionedAPI(fsImpl.v),
		name: fsImpl.name,
		getByteSource: fsImpl.getByteSource.bind(fsImpl),
		readBytes: fsImpl.readBytes.bind(fsImpl),
		readTxtFile: fsImpl.readTxtFile.bind(fsImpl),
		readJSONFile: fsImpl.readJSONFile.bind(fsImpl) as WritableFS['readJSONFile'],
		listFolder: fsImpl.listFolder.bind(fsImpl),
		checkFolderPresence: fsImpl.checkFolderPresence.bind(fsImpl),
		checkFilePresence: fsImpl.checkFilePresence.bind(fsImpl),
		stat: fsImpl.stat.bind(fsImpl),
		readonlyFile: fsImpl.readonlyFile.bind(fsImpl),
		readonlySubRoot: fsImpl.readonlySubRoot.bind(fsImpl),
		close: fsImpl.close.bind(fsImpl),
		checkLinkPresence: fsImpl.checkLinkPresence.bind(fsImpl),
		readLink: fsImpl.readLink.bind(fsImpl),
		getByteSink: fsImpl.getByteSink.bind(fsImpl),
		writeBytes: fsImpl.writeBytes.bind(fsImpl),
		writeTxtFile: fsImpl.writeTxtFile.bind(fsImpl),
		writeJSONFile: fsImpl.writeJSONFile.bind(fsImpl),
		makeFolder: fsImpl.makeFolder.bind(fsImpl),
		deleteFile: fsImpl.deleteFile.bind(fsImpl),
		deleteFolder: fsImpl.deleteFolder.bind(fsImpl),
		move: fsImpl.move.bind(fsImpl),
		copyFile: fsImpl.copyFile.bind(fsImpl),
		copyFolder: fsImpl.copyFolder.bind(fsImpl),
		writableFile: fsImpl.writableFile.bind(fsImpl),
		writableSubRoot: fsImpl.writableSubRoot.bind(fsImpl),
		saveFile: fsImpl.saveFile.bind(fsImpl),
		saveFolder: fsImpl.saveFolder.bind(fsImpl),
		link: fsImpl.link.bind(fsImpl),
		deleteLink: fsImpl.deleteLink.bind(fsImpl),
		watchFolder: fsImpl.watchFolder.bind(fsImpl),
		watchFile: fsImpl.watchFile.bind(fsImpl),
		watchTree: fsImpl.watchTree.bind(fsImpl),
		select: fsImpl.select.bind(fsImpl),
		getXAttr: fsImpl.getXAttr.bind(fsImpl),
		listXAttrs: fsImpl.listXAttrs.bind(fsImpl),
		updateXAttrs: fsImpl.updateXAttrs.bind(fsImpl)
	};
	return addParamsAndFreezeFSWrap(w, fsImpl);
}

function addParamsAndFreezeFSWrap<T extends ReadonlyFS>(w: T, fsImpl: T): T {
	if (typeof (fsImpl as any as Linkable).getLinkParams === 'function') {
		(w as any as Linkable).getLinkParams =
			(fsImpl as any as Linkable).getLinkParams.bind(fsImpl);
	}
	return Object.freeze(w);
}

function wrapWritableFSVersionedAPI(
	vImpl: WritableFSVersionedAPI|undefined
): WritableFSVersionedAPI|undefined {
	if (!vImpl) { return; }
	const w: WritableFSVersionedAPI = {
		stat: vImpl.stat.bind(vImpl),
		getXAttr: vImpl.getXAttr.bind(vImpl),
		listXAttrs: vImpl.listXAttrs.bind(vImpl),
		updateXAttrs: vImpl.updateXAttrs.bind(vImpl),
		getByteSink: vImpl.getByteSink.bind(vImpl),
		getByteSource: vImpl.getByteSource.bind(vImpl),
		readBytes: vImpl.readBytes.bind(vImpl),
		writeBytes: vImpl.writeBytes.bind(vImpl),
		listFolder: vImpl.listFolder.bind(vImpl),
		readJSONFile: vImpl.readJSONFile.bind(vImpl) as WritableFSVersionedAPI['readJSONFile'],
		readTxtFile: vImpl.readTxtFile.bind(vImpl),
		writeJSONFile: vImpl.writeJSONFile.bind(vImpl),
		writeTxtFile: vImpl.writeTxtFile.bind(vImpl),
		archiveCurrent: vImpl.archiveCurrent.bind(vImpl),
		listVersions: vImpl.listVersions.bind(vImpl),
		sync: wrapWritableFSSyncAPI(vImpl.sync)
	};
	return Object.freeze(w);
}

function wrapWritableFSSyncAPI(
	sImpl: WritableFSSyncAPI|undefined
): WritableFSSyncAPI|undefined {
	if (!sImpl) { return; }
	const w: WritableFSSyncAPI = {
		status: sImpl.status.bind(sImpl),
		startDownload: sImpl.startDownload.bind(sImpl),
		isRemoteVersionOnDisk: sImpl.isRemoteVersionOnDisk.bind(sImpl),
		adoptRemote: sImpl.adoptRemote.bind(sImpl),
		diffCurrentAndRemoteFolderVersions: sImpl.diffCurrentAndRemoteFolderVersions.bind(sImpl),
		startUpload: sImpl.startUpload.bind(sImpl),
		upload: sImpl.upload.bind(sImpl),
		adoptRemoteFolderItem: sImpl.adoptRemoteFolderItem.bind(sImpl),
	};
	return Object.freeze(w);
}

export function wrapReadonlyFS(fsImpl: ReadonlyFS): ReadonlyFS {
	const w: ReadonlyFS = {
		type: fsImpl.type,
		writable: false,
		v: wrapReadonlyFSVersionedAPI(fsImpl.v),
		name: fsImpl.name,
		getByteSource: fsImpl.getByteSource.bind(fsImpl),
		readBytes: fsImpl.readBytes.bind(fsImpl),
		readTxtFile: fsImpl.readTxtFile.bind(fsImpl),
		readJSONFile: fsImpl.readJSONFile.bind(fsImpl) as ReadonlyFS['readJSONFile'],
		listFolder: fsImpl.listFolder.bind(fsImpl),
		checkFolderPresence: fsImpl.checkFolderPresence.bind(fsImpl),
		checkFilePresence: fsImpl.checkFilePresence.bind(fsImpl),
		stat: fsImpl.stat.bind(fsImpl),
		readonlyFile: fsImpl.readonlyFile.bind(fsImpl),
		readonlySubRoot: fsImpl.readonlySubRoot.bind(fsImpl),
		close: fsImpl.close.bind(fsImpl),
		checkLinkPresence: fsImpl.checkLinkPresence.bind(fsImpl),
		readLink: fsImpl.readLink.bind(fsImpl),
		watchFolder: fsImpl.watchFolder.bind(fsImpl),
		watchFile: fsImpl.watchFile.bind(fsImpl),
		watchTree: fsImpl.watchTree.bind(fsImpl),
		select: fsImpl.select.bind(fsImpl),
		getXAttr: fsImpl.getXAttr.bind(fsImpl),
		listXAttrs: fsImpl.listXAttrs.bind(fsImpl)
	};
	return addParamsAndFreezeFSWrap(w, fsImpl);
}

function wrapReadonlyFSVersionedAPI(
	vImpl: ReadonlyFSVersionedAPI|undefined
): ReadonlyFSVersionedAPI|undefined {
	if (!vImpl) { return; }
	const w: ReadonlyFSVersionedAPI = {
		stat: vImpl.stat.bind(vImpl),
		getXAttr: vImpl.getXAttr.bind(vImpl),
		listXAttrs: vImpl.listXAttrs.bind(vImpl),
		getByteSource: vImpl.getByteSource.bind(vImpl),
		readBytes: vImpl.readBytes.bind(vImpl),
		listFolder: vImpl.listFolder.bind(vImpl),
		readJSONFile: vImpl.readJSONFile.bind(vImpl) as ReadonlyFSVersionedAPI['readJSONFile'],
		readTxtFile: vImpl.readTxtFile.bind(vImpl),
		listVersions: vImpl.listVersions.bind(vImpl),
		sync: wrapReadonlyFSSyncAPI(vImpl.sync)
	};
	return Object.freeze(w);
}

function wrapReadonlyFSSyncAPI(
	sImpl: ReadonlyFSSyncAPI|undefined
): ReadonlyFSSyncAPI|undefined {
	if (!sImpl) { return; }
	const w: ReadonlyFSSyncAPI = {
		status: sImpl.status.bind(sImpl),
		startDownload: sImpl.startDownload.bind(sImpl),
		isRemoteVersionOnDisk: sImpl.isRemoteVersionOnDisk.bind(sImpl),
		adoptRemote: sImpl.adoptRemote.bind(sImpl),
		diffCurrentAndRemoteFolderVersions:
			sImpl.diffCurrentAndRemoteFolderVersions.bind(sImpl),
	};
	return Object.freeze(w);
}

/**
 * This wraps given versioned fs into readonly versionless fs that will fail to
 * be linked. So, use this function for non linkable storages like asmail-msg.
 * @param fs to wrap
 */
export function wrapIntoVersionlessReadonlyFS(
	fs: ReadonlyFS, type?: FSType
): ReadonlyFS {
	const w: ReadonlyFS = {
		name: fs.name,
		v: undefined,
		writable: false,
		type: (type ? type : fs.type),
		getByteSource: fs.getByteSource.bind(fs),
		readBytes: fs.readBytes.bind(fs),
		readTxtFile: fs.readTxtFile.bind(fs),
		readJSONFile: fs.readJSONFile.bind(fs) as ReadonlyFS['readJSONFile'],
		listFolder: fs.listFolder.bind(fs),
		checkFolderPresence: fs.checkFolderPresence.bind(fs),
		checkFilePresence: fs.checkFilePresence.bind(fs),
		stat: async (path: string) => {
			const stats = await fs.stat(path);
			delete stats.version;
			return stats;
		},
		readonlyFile: async (path: string) => toVersionlessReadonlyFile(
			await fs.readonlyFile(path)),
		readonlySubRoot: async (path: string) => wrapIntoVersionlessReadonlyFS(
			await fs.readonlySubRoot(path)),
		close: fs.close.bind(fs),
		checkLinkPresence: fs.checkLinkPresence.bind(fs),
		readLink: fs.readLink.bind(fs),
		watchFolder: fs.watchFolder.bind(fs),
		watchFile: fs.watchFile.bind(fs),
		watchTree: fs.watchTree.bind(fs),
		select: fs.select.bind(fs),
		getXAttr: fs.getXAttr.bind(fs),
		listXAttrs: fs.listXAttrs.bind(fs)
	};
	return Object.freeze(w);
}

/**
 * This wraps given versioned file into readonly versionless file that will fail
 * to be linked. So, use this function for non linkable storages like
 * asmail-msg.
 * @param f 
 */
function toVersionlessReadonlyFile(f: ReadonlyFile): ReadonlyFile {
	const w: ReadonlyFile = {
		isNew: f.isNew,
		name: f.name,
		v: undefined,
		writable: false,
		getByteSource: f.getByteSource.bind(f),
		readJSON: f.readJSON.bind(f) as ReadonlyFile['readJSON'],
		readTxt: f.readTxt.bind(f),
		readBytes: f.readBytes.bind(f),
		stat: async () => {
			const stats = await f.stat();
			delete stats.version;
			return stats;
		},
		watch: f.watch.bind(f),
		getXAttr: f.getXAttr.bind(f),
		listXAttrs: f.listXAttrs.bind(f)
	};
	return Object.freeze(w);
}


Object.freeze(exports);