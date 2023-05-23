/*
 Copyright (C) 2016 - 2018, 2020, 2022 3NSoft Inc.

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


declare namespace web3n.files {

	interface FileException extends RuntimeException, FileExceptionFlag {
		type: 'file';
		code: string|undefined;
		path: string;
		fsEtityType?: 'file' | 'link' | 'folder';
	}

	interface FileExceptionFlag {
		notFound?: true;
		alreadyExists?: true;
		notDirectory?: true;
		notFile?: true;
		notLink?: true;
		isDirectory?: true;
		notEmpty?: true;
		endOfFile?: true;
		opNotPermitted?: true;
		busy?: true;
		ioError?: true;
		inconsistentStateOfFS?: true;
		concurrentUpdate?: true;
		parsingError?: true;
		notImplemented?: true;
		attrsNotEnabledInFS?: true;
		versionMismatch?: true;
		isEndless?: true;
		storageClosed?: true;
		remoteNotSet?: true;
	}

	interface exceptionCode {
		notFound: 'ENOENT';
		alreadyExists: 'EEXIST';
		notDirectory: 'ENOTDIR';
		notFile: 'ENOTFILE';
		isDirectory: 'EISDIR';
		notEmpty: 'ENOTEMPTY';
		endOfFile: 'EEOF';
		opNotPermitted: 'EPERM';
		busy: 'EBUSY';
		ioError: 'EIO';
		notImplemented: 'ENOSYS';
	}

	interface FSSyncException extends RuntimeException {
		type: 'fs-sync';
		path: string;
		localVersion?: number;
		remoteVersion?: number;
		alreadyUploading?: true;
		versionNotFound?: true;
		childNeverUploaded?: true;
		childName?: string;
		removedOnServer?: true;
		versionMismatch?: true;
		conflict?: true;
		notSynced?: true;
		remoteIsArchived?: true;
		remoteFolderItemNotFound?: true;
	}

	/**
	 * Instances of this interface are produced by folder listing method(s).
	 */
	interface ListingEntry {

		/**
		 * This is name of an entity in its parent folder.
		 */
		name: string;

		/**
		 * When present with true value, it indicates that an entity is a folder.
		 */
		isFolder?: boolean;

		/**
		 * When present with true value, it indicates that an entity is a file.
		 */
		isFile?: boolean;

		/**
		 * When present with true value, it indicates that an entity is a link.
		 */
		isLink?: boolean;
	}

	interface Stats {

		isFile?: boolean;

		isFolder?: boolean;

		isLink?: boolean;

		writable: boolean;

		/**
		 * File size in bytes.
		 */
		size?: number;

		/**
		 * Flag indicating if file is an endless (unknown place of end) stream.
		 */
		isEndless?: boolean;

		/**
		 * Last content modification time stamp.
		 * If such information cannot be provided, this field will be absent.
		 */
		mtime?: Date;

		/**
		 * Last change of metadata time stamp.
		 * If such information cannot be provided, this field will be absent.
		 */
		ctime?: Date;

		/**
		 * This tells object's version.
		 * If such information cannot be provided, this field will be absent.
		 */
		version?: number;

	}

	/**
	 * Sync status contains info about possible version branches with possible
	 * states:
	 * 1. unsynced - have local branch, and possibly synced one.
	 *    Local version(s) should be uploaded to get into synced state.
	 * 2. synced - have only synced branch.
	 * 3. behind - have both synced and remote branches.
	 *    Should explicitly advance to newer version to get into synced state.
	 * 4. conflicting - have conflicting local and remote branches, with possible
	 *    common synced history branch.
	 *    Conflict gets fixed by uploading some local version with value greater
	 *    than remote's latest. Making this version is a custom magic of
	 *    conflict resolution that you do for your app.
	 */
	interface SyncStatus {
		state: SyncState;
		synced?: SyncVersionsBranch;
		local?: LocalVersion;
		remote?: SyncVersionsBranch;
		existsInSyncedParent?: boolean;
	}

	interface LocalVersion {
		latest?: number;
		isArchived?: boolean;
	}

	interface SyncVersionsBranch {
		latest?: number;
		archived?: number[];
		isArchived?: boolean;
	}

	type SyncState = 'synced' | 'behind' | 'unsynced' | 'conflicting';

	interface FileByteSource {

		/**
		 * This reads file bytes from a current position. Read advances current
		 * position. Seek method sets position to a particular value. Initial
		 * value of current read position is zero.
		 * Returned promise resolves to either read bytes, or undefined.
		 * If byte array has same length as given read limit, there may be more
		 * bytes to read. Otherwise, all bytes are read to the end of file.
		 * Undefined is returned when there are no bytes to read, starting from
		 * the current read position.
		 * @param len maximum number of bytes to read from file. If undefine is
		 * given, all bytes are read from current postion to the end of file.
		 */
		readNext(len: number|undefined): Promise<Uint8Array|undefined>;

		/**
		 * This moves current position to a given value and read given number of
		 * bytes. It is equivalent to calling seek() and readNext() with
		 * respective arguments.
		 * @param pos is a position at which to start read.
		 * @param len maximum number of bytes to read from file. If undefine is
		 * given, all bytes are read from current postion to the end of file.
		 */
		readAt(pos: number, len: number|undefined): Promise<Uint8Array|undefined>;

		/**
		 * This returns a promise, resolvable to the size of this file.
		 */
		getSize(): Promise<number>;

		/**
		 * This sets read position to a given value.
		 * @param offset is new read position
		 */
		seek(offset: number): Promise<void>;

		/**
		 * This returns a promise, resolvable to current read position.
		 */
		getPosition(): Promise<number>;
	}

	interface LayoutSection {
		src: 'new' | 'base' | 'empty';
		ofs: number;
		len: number;
	}

	interface FileLayout {
		base?: number;
		sections: LayoutSection[];
	}

	interface FileByteSink {

		/**
		 * This returns a promise, resolvable to current size. This size changes
		 * when sink is splice and truncated.
		 */
		getSize(): Promise<number>;

		/**
		 * This splices file. It removes bytes, and inserts new ones. Note that
		 * it is an insertion of bytes, and not over-writing.
		 * @param pos in file at which deletion should occur, followed by
		 * insertion of given bytes, if any given. If position is greater than
		 * current size, empty section will be inserted up to it.
		 * @param del number of bytes to cut at given position.
		 * @param bytes when given, these bytes are inserted into file at given
		 * position, after deletion.
		 */
		splice(pos: number, del: number, bytes?: Uint8Array): Promise<void>;

		/**
		 * This truncates file to a given size. If size is reduced, bytes are cut.
		 * If size grows, empty section is added up to new end of file.
		 * @param size 
		 */
		truncate(size: number): Promise<void>;

		/**
		 * This returns a promise, resolvable to current file layout. Returned
		 * layout is not a shared object, and any new changes will be reflected
		 * in layouts from following calls of this method.
		 */
		showLayout(): Promise<FileLayout>;

		/**
		 * This completes sink. Completion with error cancels file writing.
		 * Regular completion may get an error thrown back, while canceling will
		 * not.
		 * @param err an optional error, presence of which indicates closing of
		 * sink with this error. When err is given, no errors will be thrown back
		 * to this call.
		 */
		done(err?: any, xattrChanges?: XAttrsChanges): Promise<void>;

	}

	type Linkable = File | FS;

	/**
	 * This is an interface for a symbolic link.
	 * In unix file systems there are both symbolic and hard links. We do not
	 * have hard links here, but we need to highlight that nature of links here
	 * is symbolic. For example, when a target is deleted, symbolic link becomes
	 * broken. 
	 */
	interface SymLink {

		/**
		 * Flag that indicates if access to link's target is readonly (true), or
		 * can be writable (false value).
		 */
		readonly: boolean;

		/**
		 * Indicates with true value if target is a file
		 */
		isFile?: boolean;

		/**
		 * Indicates with true value if target is a folder
		 */
		isFolder?: boolean;

		target(): Promise<Linkable>;
	}

	type File = ReadonlyFile | WritableFile;

	interface ReadonlyFile {

		writable: boolean;

		v?: ReadonlyFileVersionedAPI;

		/**
		 * Is a file name, given by the outside to this file. It may, or may not,
		 * be the same as an actual file name in the file system. It may also be
		 * null.
		 */
		name: string;

		/**
		 * Is a flag that says, whether file existed at the moment of this
		 * object's creation.
		 */
		isNew: boolean;

		/**
		 * This returns a promise, resolvable to file stats.
		 */
		stat(): Promise<Stats>;

		/**
		 * This returns an extended attribute value. Undefined is returned when
		 * attribute is not known.
		 * @param xaName 
		 */
		getXAttr(xaName: string): Promise<any>;

		/**
		 * This returns an array of set extended attributes.
		 */
		listXAttrs(): Promise<string[]>;

		/**
		 * This returns a promise, resolvable to either non-empty byte array, or
		 * undefined.
		 * @param start optional parameter, setting a beginning of read. If
		 * missing, read will be done as if neither start, nor end parameters
		 * are given.
		 * @param end optional parameter, setting an end of read. If end is
		 * greater than file length, all available bytes are read. If parameter
		 * is missing, read will be done to file's end.
		 */
		readBytes(start?: number, end?: number): Promise<Uint8Array|undefined>;

		/**
		 * This returns a promise, resolvable to text, read from file, assuming
		 * utf8 encoding.
		 */
		readTxt(): Promise<string>;

		/**
		 * This returns a promise, resolvable to json, read from file
		 */
		readJSON<T>(): Promise<T>;

		/**
		 * This returns a promise, resolvable to bytes source with seek, which
		 * allows random reads.
		 */
		getByteSource(): Promise<FileByteSource>;

		watch(observer: Observer<FileEvent|RemoteEvent>): () => void;

	}

	interface WritableFile extends ReadonlyFile {

		v?: WritableFileVersionedAPI;

		/**
		 * This updates extended attributes.
		 * @param changes is an object with changes to attributes. Note these are
		 * explicit changes of extended attributes, not an implicit replacement.
		 */
		updateXAttrs(changes: XAttrsChanges): Promise<void>;

		/**
		 * This returns a promise, resolvable when file is written
		 * @param bytes is a complete file content to write
		 * @param xattrChanges is optional changes to xattrs, to pack them in the
		 * same go
		 */
		writeBytes(
			bytes: Uint8Array, xattrChanges?: XAttrsChanges
		): Promise<void>;

		/**
		 * This returns a promise, resolvable when file is written
		 * @param txt to write to file, using utf8 encoding
		 * @param xattrChanges is optional changes to xattrs, to pack them in the
		 * same go
		 */
		writeTxt(txt: string, xattrChanges?: XAttrsChanges): Promise<void>;

		/**
		 * This returns a promise, resolvable when file is written
		 * @param json
		 * @param xattrChanges is optional changes to xattrs, to pack them in the
		 * same go
		 */
		writeJSON(json: any, xattrChanges?: XAttrsChanges): Promise<void>;

		/**
		 * This returns a promise, resolvable to byte sink with seek
		 * @param truncateFile is an optional flag that truncates file content
		 * before any bytes are writen to produced sink. When flag is false,
		 * produced sink updates existing bytes. Default value is true.
		 */
		getByteSink(truncateFile?: boolean): Promise<FileByteSink>;

		/**
		 * This returns a promise, resolvable when copying is done.
		 * @param file which content will be copied into this file
		 */
		copy(file: File): Promise<void>;

	}

	interface XAttrsChanges {
		set?: { [xaName: string]: any|undefined; };
		remove?: string[];
	}

	interface ReadonlyFileVersionedAPI {

		getXAttr(
			xaName: string, flags?: VersionedReadFlags
		): Promise<{ attr: any; version: number; }>;
	
		listXAttrs(
			flags?: VersionedReadFlags
		): Promise<{ lst: string[]; version: number; }>;
	
		/**
		 * This returns a promise, resolvable to either non-empty byte array, or
		 * undefined.
		 * @param start optional parameter, setting a beginning of read. If
		 * missing, read will be done as if neither start, nor end parameters
		 * are given.
		 * @param end optional parameter, setting an end of read. If end is
		 * greater than file length, all available bytes are read. If parameter
		 * is missing, read will be done to file's end.
		 * @param flags are optional flags to read archived or remote versions.
		 */
		readBytes(
			start?: number, end?: number, flags?: VersionedReadFlags
		): Promise<{ bytes: Uint8Array|undefined; version: number; }>;

		/**
		 * This returns a promise, resolvable to text, read from file, assuming
		 * utf8 encoding.
		 * @param flags are optional flags to read archived or remote versions.
		 */
		readTxt(
			flags?: VersionedReadFlags
		): Promise<{ txt: string; version: number; }>;

		/**
		 * This returns a promise, resolvable to json, read from file
		 * @param flags are optional flags to read archived or remote versions.
		 */
		readJSON<T>(
			flags?: VersionedReadFlags
		): Promise<{ json: T; version: number; }>;

		/**
		 * This returns a promise, resolvable to bytes source with seek, which
		 * allows random reads, and a file version
		 * @param flags are optional flags to read archived or remote versions.
		 */
		getByteSource(
			flags?: VersionedReadFlags
		): Promise<{ src: FileByteSource; version: number; }>;

		listVersions(
			flags?: VersionedReadFlags
		): Promise<{ current?: number; archived?: number[]; }>;

		sync?: ReadonlyFileSyncAPI;

	}

	interface VersionedReadFlags {
		archivedVersion?: number;
		remoteVersion?: number;
	}

	interface WritableFileVersionedAPI extends ReadonlyFileVersionedAPI {

		/**
		 * This updates extended attributes.
		 * @param changes is an object with changes to attributes. Note these are
		 * explicit changes of extended attributes, not an implicit replacement.
		 */
		updateXAttrs(changes: XAttrsChanges): Promise<number>;
		
		/**
		 * This returns a promise, resolvable to new file's version when file is
		 * written
		 * @param bytes is a complete file content to write
		 * @param xattrChanges is optional changes to xattrs, to pack them into
		 * the same file version
		 */
		writeBytes(
			bytes: Uint8Array, xattrChanges?: XAttrsChanges
		): Promise<number>;

		/**
		 * This returns a promise, resolvable to new file's version when file is
		 * written
		 * @param txt to write to file, using utf8 encoding
		 * @param xattrChanges is optional changes to xattrs, to pack them into
		 * the same file version
		 */
		writeTxt(txt: string, xattrChanges?: XAttrsChanges): Promise<number>;

		/**
		 * This returns a promise, resolvable to new file's version when file is
		 * written
		 * @param json
		 * @param xattrChanges is optional changes to xattrs, to pack them into
		 * the same file version
		 */
		writeJSON(json: any, xattrChanges?: XAttrsChanges): Promise<number>;

		/**
		 * This returns a promise, resolvable to byte sink with seek, and a file
		 * version
		 * @param truncateFile is an optional flag that truncates file content
		 * before any bytes are writen to produced sink. When flag is false,
		 * produced sink updates existing bytes. Default value is true.
		 * @param currentVersion is an optional parameter, for non-truncated sink.
		 * When current version is given, an error is thrown, if file version at
		 * the moment of writing is different.
		 */
		getByteSink(
			truncateFile?: boolean, currentVersion?: number
		): Promise<{ sink: FileByteSink; version: number; }>;

		/**
		 * This returns a promise, resolvable to new file's version when copying
		 * is done.
		 * @param file which content will be copied into this file
		 */
		copy(file: File): Promise<number>;

		archiveCurrent(version?: number): Promise<number>;

		sync?: WritableFileSyncAPI;

	}

	interface ReadonlyFileSyncAPI {

		/**
		 * Returns synchronization status of this object, as is currently known
		 * here without checking remote server.
		 */
		status(): Promise<SyncStatus>;

		updateStatusInfo(): Promise<SyncStatus>;

		isRemoteVersionOnDisk(
			version: number
		): Promise<'partial'|'complete'|'none'>;

		download(version: number): Promise<void>;

		adoptRemote(opts?: OptionsToAdopteRemote): Promise<void>;

	}

	interface OptionsToAdopteRemote {
		dropLocalVer?: boolean;
		remoteVersion?: number;
		download?: boolean;
	}

	interface WritableFileSyncAPI extends ReadonlyFileSyncAPI {

		upload(opts?: OptionsToUploadLocal): Promise<number|undefined>;

	}

	interface OptionsToUploadLocal {
		localVersion?: number;
		uploadVersion?: number;
	}

	type FSType = 'device' | 'synced' | 'local' | 'share' | 'asmail-msg';

	type FS = ReadonlyFS | WritableFS;

	interface ReadonlyFS {

		type: FSType;

		v?: ReadonlyFSVersionedAPI;
		
		writable: boolean;

		/**
		 * Is a folder name, given by the outside to this file system. It may, or
		 * may not, be the same as an actual folder name. It may also be null.
		 */
		name: string;
		
		/**
		 * This returns a promise, resolvable to true, if folder exists, and to
		 * false, if folder is not found.
		 * @param path of a folder, which presence we want to check
		 * @param throwIfMissing is an optional flag, which forces with true value
		 * throwing of an exception, when folder does not exist. Default value is
		 * false.
		 */
		checkFolderPresence(
			path: string, throwIfMissing?: boolean
		): Promise<boolean>;
		
		/**
		 * This returns a promise, resolvable to true, if file exists, and to
		 * false, if file is not found.
		 * @param path of a file, which presence we want to check
		 * @param throwIfMissing is an optional flag, which forces with true value
		 * throwing of an exception, when file does not exist. Default value is
		 * false.
		 */
		checkFilePresence(
			path: string, throwIfMissing?: boolean
		): Promise<boolean>;
		
		/**
		 * This returns a promise, resolvable to true, if link exists, and to
		 * false, if link is not found.
		 * @param path of a link, which presence we want to check
		 * @param throwIfMissing is an optional flag, which forces with true value
		 * throwing of an exception, when link does not exist. Default value is
		 * false.
		 */
		checkLinkPresence(
			path: string, throwIfMissing?: boolean
		): Promise<boolean>;
		
		/**
		 * This returns a promise, resolvable to stats of an entity at a given
		 * path.
		 * @param path
		 */
		stat(path: string): Promise<Stats>;

		/**
		 * This returns an extended attribute value. Undefined is returned when
		 * attribute is not known.
		 * @param path
		 * @param xaName 
		 */
		getXAttr(path: string, xaName: string): Promise<any>;

		/**
		 * This returns an array of set extended attributes.
		 * @param path
		 */
		listXAttrs(path: string): Promise<string[]>;

		readLink(path: string): Promise<SymLink>;

		watchFolder(
			path: string, observer: Observer<FolderEvent|RemoteEvent>
		): () => void;

		watchFile(
			path: string, observer: Observer<FileEvent|RemoteEvent>
		): () => void;

		watchTree(
			path: string, depth: number|undefined,
			observer: Observer<FolderEvent|FileEvent|RemoteEvent>
		): () => void;

		close(): Promise<void>;

		/**
		 * This returns a promise, resolvable to a file system object, rooted to a
		 * given folder.
		 * @param folder is a path of a root folder.
		 */
		readonlySubRoot(folder: string): Promise<ReadonlyFS>;

		/**
		 * This returns a promise, resolvable to a list of informational objects
		 * for entries in the folder.
		 * @param path of a folder that should be listed
		 */
		listFolder(folder: string): Promise<ListingEntry[]>;

		/**
		 * This returns a promise, resolvable to json, read from file
		 * @param path of a file from which to read json
		 */
		readJSONFile<T>(path: string): Promise<T>;

		/**
		 * This returns a promise, resolvable to text, read from file, assuming
		 * utf8 encoding.
		 * @param path of a file from which to read text
		 */
		readTxtFile(path: string): Promise<string>;

		/**
		 * This returns a promise, resolvable to either non-empty byte array, or
		 * undefined.
		 * @param path of a file from which to read bytes
		 * @param start optional parameter, setting a beginning of read. If
		 * missing, read will be done as if neither start, nor end parameters
		 * are given.
		 * @param end optional parameter, setting an end of read. If end is
		 * greater than file length, all available bytes are read. If parameter
		 * is missing, read will be done to file's end.
		 */
		readBytes(
			path: string, start?: number, end?: number
		): Promise<Uint8Array|undefined>;

		/**
		 * This returns a promise, resolvable to bytes source with seek, which
		 * allows random reads.
		 * @param path of a file from which to read bytes
		 */
		getByteSource(path: string): Promise<FileByteSource>;

		/**
		 * This returns a promise, resolvable to readonly file object.
		 * @param path
		 */
		readonlyFile(path: string): Promise<ReadonlyFile>;

		/**
		 * This function selects items inside given path, following given
		 * criteria. It start selection process, which may be long, and returns a
		 * promise, resolvable to items collection into selected items will
		 * eventually be placed, and a completion promise, that resolves when
		 * selection/search process completes.
		 * Note that collection can be watched for changes as they happen.
		 * @param path 
		 * @param criteria 
		 */
		select(
			path: string, criteria: SelectCriteria
		): Promise<{ items: FSCollection; completion: Promise<void>; }>;

	}

	interface SelectCriteria {

		/**
		 * This is a match for name. There are three match types:
		 * pattern, regexp and exact.
		 * 1) Pattern is a common cli search like "*.png" that treats *-symbol as
		 * standing for anything. Search isn't case-sensitive.
		 * When name field is a string, it is assumed to be this pattern type.
		 * 2) Regexp is used directly to make a match.
		 * 3) Exact matches given string exactly to names of fs items.
		 */
		name: string | {
			p: string;
			type: 'pattern' | 'regexp' | 'exact';
		};

		/**
		 * depth number, if present, limits search to folder depth in a file tree.
		 */
		depth?: number;

		/**
		 * type identifies type or types of elements this criteria should match.
		 * If missing, all fs types are considered for further matching.
		 */
		type?: FSItemType | FSItemType[];

		/**
		 * action specifies what happens with items that match given criteria:
		 * include or exclude from search results. Selection with include action
		 * returns only items that match criteria. Selection with exclude action
		 * returns all items that don't match criteria.
		 */
		action: 'include' | 'exclude';
	}

	type FSItemType = 'folder' | 'file' | 'link';

	interface FSItem {
		isFile?: boolean;
		isFolder?: boolean;
		isLink?: boolean;
		isCollection?: boolean;
		item?: FS|File|FSCollection;
		location?: {
			fs: FS;
			path: string;
			storageUse?: storage.StorageUse;
			storageType?: storage.StorageType;
		};
	}
	
	interface FSCollection {
		get(name: string): Promise<FSItem|undefined>;
		getAll(): Promise<[ string, FSItem ][]>;
		entries(): Promise<AsyncIterator<[ string, FSItem ]>>;
		watch(observer: Observer<CollectionEvent>): () => void;
		set?: (name: string, f: FSItem) => Promise<void>;
		remove?: (name: string) => Promise<boolean>;
		clear?: () => Promise<void>;
	}

	interface CollectionItemRemovalEvent {
		type: 'entry-removal';
		path?: string;
	}

	interface CollectionItemAdditionEvent {
		type: 'entry-addition';
		path: string;
		item: FSItem;
	}

	type CollectionEvent = CollectionItemAdditionEvent |
		CollectionItemRemovalEvent;

	interface WritableFS extends ReadonlyFS {

		v?: WritableFSVersionedAPI;

		/**
		 * This updates extended attributes.
		 * @param path
		 * @param changes is an object with changes to attributes. Note these are
		 * explicit changes of extended attributes, not an implicit replacement.
		 */
		updateXAttrs(path: string, changes: XAttrsChanges): Promise<void>;

		/**
		 * This either finds existing, or creates new folder, asynchronously.
		 * @param path of a folder that should be created
		 * @param exclusive is an optional flag, which when set to true, throws
		 * if folder already exists. Default value is false, i.e. if folder
		 * exists, nothing happens.
		 */
		makeFolder(path: string, exclusive?: boolean): Promise<void>;

		/**
		 * This returns a promise, resolvable when folder has been removed
		 * @param path of a folder that should be removed
		 * @param removeContent is an optional flag, which true values forces
		 * recursive removal of all content in the folder. Default value is false.
		 * If folder is not empty, and content removal flag is not set, then an
		 * error is thrown.
		 */
		deleteFolder(path: string, removeContent?: boolean): Promise<void>;

		/**
		 * This returns a promise, resolvable when file has been removed
		 * @param path of a file that should be removed
		 */
		deleteFile(path: string): Promise<void>;

		/**
		 * This returns a promise, resolvable when file (or folder) has been
		 * moved.
		 * @param src is an initial path of a file (or folder)
		 * @param dst is a new path of a file (or folder)
		 */
		move(src: string, dst: string): Promise<void>;

		/**
		 * This returns a promise, resolvable when file has been copied.
		 * @param src is an initial path of a file
		 * @param dst is a path of a file
		 * @param overwrite is a flag that with a true value allows
		 * overwrite of existing dst file. Default value is false.
		 */
		copyFile(
			src: string, dst: string, overwrite?: boolean
		): Promise<void>;

		/**
		 * This returns a promise, resolvable when folder has been recursively
		 * copied.
		 * @param src is an initial path of a folder
		 * @param dst is a path of a folder
		 * @param mergeAndOverwrite is a flag that with true value allows
		 * merge into existing folder and files overwriting inside. Default
		 * value is false.
		 */
		copyFolder(
			src: string, dst: string, mergeAndOverwrite?: boolean
		): Promise<void>;

		/**
		 * This returns a promise, resolvable when file has been saved.
		 * @param file is a file to save
		 * @param dst is a path where to save given file
		 * @param overwrite is a flag that with a true value allows
		 * overwrite of existing dst file. Default value is false.
		 */
		saveFile(file: File, dst: string, overwrite?: boolean): Promise<void>;

		/**
		 * This returns a promise, resolvable when folder has been recursively
		 * saved.
		 * @param folder is a folder to save
		 * @param dst is a path where to save given folder
		 * @param mergeAndOverwrite is a flag that with true value allows
		 * merge into existing folder and files overwriting inside. Default
		 * value is false.
		 */
		saveFolder(
			folder: FS, dst: string, mergeAndOverwrite?: boolean
		): Promise<void>;

		/**
		 * This returns a promise, resolvable when file has been removed
		 * @param path of a link that should be removed
		 */
		deleteLink(path: string): Promise<void>;

		link(path: string, target: File | FS): Promise<void>;

		/**
		 * This returns a promise, resolvable to a file system object, rooted to a
		 * given folder.
		 * @param folder is a path of a root folder.
		 * @param flags are optional flags. Default flags are create=true,
		 * exclusive=false.
		 */
		writableSubRoot(folder: string, flags?: FileFlags): Promise<WritableFS>;

		/**
		 * This returns a promise, resolvable when file is written
		 * @param path of a file to write given json
		 * @param json
		 * @param flags are optional flags. Default flags are create=true,
		 * exclusive=false.
		 */
		writeJSONFile(path: string, json: any, flags?: FileFlags): Promise<void>;

		/**
		 * This returns a promise, resolvable when file is written
		 * @param path of a file to write given text
		 * @param txt to write to file, using utf8 encoding
		 * @param flags are optional flags. Default flags are create=true,
		 * exclusive=false.
		 */
		writeTxtFile(path: string, txt: string, flags?: FileFlags): Promise<void>;

		/**
		 * This returns a promise, resolvable when file is written
		 * @param path of a file to write
		 * @param bytes to write to file. This is a whole of file content.
		 * @param flags are optional flags. Default flags are create=true,
		 * exclusive=false.
		 */
		writeBytes(
			path: string, bytes: Uint8Array, flags?: FileFlags
		): Promise<void>;

		/**
		 * This returns a promise, resolvable to byte sink with seek
		 * @param path of a file for which we want to get a writable byte sink
		 * @param flags are optional flags. Default flags are create=true,
		 * exclusive=false, truncate=true.
		 */
		getByteSink(path: string, flags?: FileFlags): Promise<FileByteSink>;

		/**
		 * This returns a promise, resolvable to file object.
		 * @param path
		 * @param flags are optional flags. Default flags are create=true,
		 * exclusive=false.
		 */
		writableFile(path: string, flags?: FileFlags): Promise<WritableFile>;

	}

	interface FileFlags {

		/**
		 * truncate flag is optional. True value forces truncation of file, if it
		 * already exists. Default value is true.
		 */
		truncate?: boolean;

		/**
		 * create flag is optional. True value forces creation of file, if it is
		 * missing. Default value is true.
		 */
		create?: boolean;

		/**
		 * exclusive flag is optional. This flag is applicable when create is
		 * true. True value ensures that file doesn't exist, and an error is
		 * thrown, when file exists. Default value is false.
		 */
		exclusive?: boolean;

	}

	interface VersionedFileWriteFlags extends FileFlags {

		/**
		 * currentVersion flag is optional. This flag is applicable to existing
		 * file. An error is thrown when at the time of writing current file
		 * version is different from a given value.
		 */
		currentVersion?: number;

	}

	interface ReadonlyFSVersionedAPI {

		getXAttr(
			path: string, xaName: string, flags?: VersionedReadFlags
		): Promise<{ attr: any; version: number; }>;
	
		listXAttrs(
			path: string, flags?: VersionedReadFlags
		): Promise<{ lst: string[]; version: number; }>;

		/**
		 * This returns a promise, resolvable to a list of informational objects
		 * for entries in the folder, and a folder's version.
		 * @param path of a folder that should be listed
		 * @param flags are optional flags to read archived or remote versions.
		 */
		listFolder(
			path: string, flags?: VersionedReadFlags
		): Promise<{ lst: ListingEntry[]; version: number; }>;

		/**
		 * This returns a promise, resolvable to json, read from file, and a
		 * version of file.
		 * @param path of a file from which to read json
		 * @param flags are optional flags to read archived or remote versions.
		 */
		readJSONFile<T>(
			path: string, flags?: VersionedReadFlags
		): Promise<{ json: T; version: number; }>;

		/**
		 * This returns a promise, resolvable to text, read from file, assuming
		 * utf8 encoding, and version of file.
		 * @param path of a file from which to read text
		 * @param flags are optional flags to read archived or remote versions.
		 */
		readTxtFile(
			path: string, flags?: VersionedReadFlags
		): Promise<{ txt: string; version: number; }>;

		/**
		 * This returns a promise, resolvable to bytes, that is either non-empty
		 * byte array, or an undefined, and version of file.
		 * @param path of a file from which to read bytes
		 * @param start optional parameter, setting a beginning of read. If
		 * missing, read will be done as if neither start, nor end parameters
		 * are given.
		 * @param end optional parameter, setting an end of read. If end is
		 * greater than file length, all available bytes are read. If parameter
		 * is missing, read will be done to file's end.
		 * @param flags are optional flags to read archived or remote versions.
		 */
		readBytes(
			path: string, start?: number, end?: number,
			flags?: VersionedReadFlags
		): Promise<{ bytes: Uint8Array|undefined; version: number; }>;

		/**
		 * This returns a promise, resolvable to bytes source with seek, which
		 * allows random reads, and a file version
		 * @param path of a file from which to read bytes
		 * @param flags are optional flags to read archived or remote versions.
		 */
		getByteSource(
			path: string, flags?: VersionedReadFlags
		): Promise<{ src: FileByteSource; version: number; }>;

		listVersions(
			path: string
		): Promise<{ current?: number; archived?: number[]; }>;

		sync?: ReadonlyFSSyncAPI;

	}

	interface WritableFSVersionedAPI  extends ReadonlyFSVersionedAPI {

		/**
		 * This updates extended attributes.
		 * @param path
		 * @param changes is an object with changes to attributes. Note these are
		 * explicit changes of extended attributes, not an implicit replacement.
		 */
		updateXAttrs(path: string, changes: XAttrsChanges): Promise<number>;

		/**
		 * This returns a promise, resolvable to new file's version when file is
		 * written.
		 * @param path of a file to write given json
		 * @param json
		 * @param flags are optional flags. Default flags are create=true,
		 * exclusive=false.
		 */
		writeJSONFile(
			path: string, json: any, flags?: VersionedFileWriteFlags
		): Promise<number>;

		/**
		 * This returns a promise, resolvable to new file's version when file is
		 * written
		 * @param path of a file to write given text
		 * @param txt to write to file, using utf8 encoding
		 * @param flags are optional flags. Default flags are create=true,
		 * exclusive=false.
		 */
		writeTxtFile(
			path: string, txt: string, flags?: VersionedFileWriteFlags
		): Promise<number>;

		/**
		 * This returns a promise, resolvable to new file's version when file is
		 * written
		 * @param path of a file to write
		 * @param bytes to write to file. This is a whole of file content.
		 * @param flags are optional flags. Default flags are create=true,
		 * exclusive=false.
		 */
		writeBytes(
			path: string, bytes: Uint8Array, flags?: VersionedFileWriteFlags
		): Promise<number>;

		/**
		 * This returns a promise, resolvable to byte sink with seek, and a file
		 * version
		 * @param path of a file for which we want to get a writable byte sink
		 * @param flags are optional flags. Default flags are create=true,
		 * exclusive=false, truncate=true.
		 */
		getByteSink(
			path: string, flags?: VersionedFileWriteFlags
		): Promise<{ sink: FileByteSink; version: number; }>;

		archiveCurrent(path: string, version?: number): Promise<number>;

		sync?: WritableFSSyncAPI;

	}

	interface ReadonlyFSSyncAPI {

		/**
		 * Returns synchronization status of this object, as is currently known
		 * here without checking remote server.
		 */
		status(path: string): Promise<SyncStatus>;

		updateStatusInfo(path: string): Promise<SyncStatus>;

		isRemoteVersionOnDisk(
			path: string, version: number
		): Promise<'partial'|'complete'|'none'>;

		download(path: string, version: number): Promise<void>;

		adoptRemote(path: string, opts?: OptionsToAdopteRemote): Promise<void>;

		diffCurrentAndRemoteFolderVersions(
			path: string, remoteVersion?: number
		): Promise<FolderDiff|undefined>;

	}

	interface FolderDiff {
		currentVersion: number;
		isCurrentLocal: boolean;
		remoteVersion?: number;
		isRemoteArchived: boolean;
		inCurrent?: ListingEntry[];
		inRemote?: ListingEntry[];
		nameOverlaps?: string[];
		ctime: {
			remote?: Date;
			current: Date;
		};
		mtime: {
			remote?: Date;
			current: Date;
		};
		xattrs?: {
			inCurrent?: { name: string; value: any; }[];
			inRemote?: { name: string; value: any; }[];
			nameOverlaps?: string[];
		};
	}

	interface WritableFSSyncAPI extends ReadonlyFSSyncAPI {

		upload(
			path: string, opts?: OptionsToUploadLocal
		): Promise<number|undefined>;

		adoptRemoteFolderItem(
			path: string, itemName: string, opts?: OptionsToAdoptRemoteItem
		): Promise<number>;

	}

	interface OptionsToAdoptRemoteItem {
		localVersion?: number;
		remoteVersion?: number;
	}

	interface FSEvent {
		path: string;
	}

	interface FSChangeEvent {
		path: string;
		src: 'local'|'sync';
	}

	interface RemovedEvent extends FSChangeEvent {
		type: 'removed';
	}

	interface VersionChangeOnUpload extends FSChangeEvent {
		type: 'version-change-on-upload';
		src: 'sync';
		newVersion: number;
	}

	type FolderEvent = EntryRemovalEvent | EntryAdditionEvent |
		EntryRenamingEvent | RemovedEvent | VersionChangeOnUpload;

	interface EntryRemovalEvent extends FSChangeEvent {
		type: 'entry-removal';
		name: string;
		moveLabel?: number;
		newVersion?: number;
	}

	interface EntryAdditionEvent extends FSChangeEvent {
		type: 'entry-addition';
		entry: ListingEntry;
		moveLabel?: number;
		newVersion?: number;
	}

	interface EntryRenamingEvent extends FSChangeEvent {
		type: 'entry-renaming';
		oldName: string;
		newName: string;
		newVersion?: number;
	}

	type FileEvent = FileChangeEvent | RemovedEvent | VersionChangeOnUpload;

	interface FileChangeEvent extends FSChangeEvent {
		type: 'file-change';
		newVersion?: number;
	}

	type RemoteEvent = RemoteVersionArchivalEvent | RemoteArchVerRemovalEvent |
		RemoteRemovalEvent | RemoteChangeEvent;

	interface RemoteVersionArchivalEvent extends FSEvent {
		type: 'remote-version-archival';
		archivedVersion: number;
	}

	interface RemoteArchVerRemovalEvent extends FSEvent {
		type: 'remote-arch-ver-removal';
		removedArchVer: number;
	}

	interface RemoteRemovalEvent extends FSEvent {
		type: 'remote-removal';
	}

	interface RemoteChangeEvent extends FSEvent {
		type: 'remote-change';
		newVersion: number;
	}

}
