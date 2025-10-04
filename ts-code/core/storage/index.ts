/*
 Copyright (C) 2015 - 2017, 2019 - 2022, 2025 3NSoft Inc.
 
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

import { GetSigner } from '../id-manager';
import { GenerateKey } from '../startup/sign-in';
import { SyncedStorage, Storage, StorageGetter } from '../../lib-client/xsp-fs/common';
import { XspFS as xspFS } from '../../lib-client/xsp-fs/fs';
import { SyncedStore } from './synced/storage';
import { LocalStorage } from './local/storage';
import { ServiceLocator } from '../../lib-client/service-locator';
import { ScryptGenParams } from '../../lib-client/key-derivation';
import { FileException, makeFileException } from '../../lib-common/exceptions/file';
import { AsyncSBoxCryptor } from 'xsp-files';
import { makeFSCollection, readonlyWrapFSCollection } from '../../lib-client/fs-utils/fs-collection';
import { asyncFind } from '../../lib-common/async-iter';
import { join } from 'path';
import * as fs from '../../lib-common/async-fs-node';
import { errWithCause } from '../../lib-common/exceptions/error';
import { StoragePathForUser } from '../app-files';
import { LogError } from '../../lib-client/logging/log-to-file';
import { MakeNet } from '..';
import { initSysFolders, sysFilesOnDevice, sysFolders, userFilesOnDevice } from './system-folders';
import { AppDataFolders } from './system-folders/apps-data';
import { CORE_APPS_PREFIX } from './common/constants';
import { assert } from '../../lib-common/assert';

type EncryptionException = web3n.EncryptionException;
type WritableFS = web3n.files.WritableFS;
type FS = web3n.files.FS;
type FSType = web3n.files.FSType;
type StorageType = web3n.storage.StorageType;
type FSCollection = web3n.files.FSCollection;
type FSItem = web3n.files.FSItem;
type StorageException = web3n.storage.StorageException;

function makeBadAppNameExc(appName: string): StorageException {
	return {
		runtimeException: true,
		type: 'storage',
		storageSegment: 'app',
		badAppName: true,
		appName
	};
}

function makeNotAllowedToOpenAppFSExc(appFolder: string): StorageException {
	return {
		runtimeException: true,
		type: 'storage',
		storageSegment: 'app',
		notAllowedToOpenFS: true,
		appName: reverseDomain(appFolder)
	};
}

function makeNotAllowedToOpenUserFSExc(
	storageType: StorageType
): StorageException {
	return {
		runtimeException: true,
		type: 'storage',
		storageSegment: 'user',
		notAllowedToOpenFS: true,
		storageType
	};
}

function makeNotAllowedToOpenSysFSExc(
	storageType: StorageType
): StorageException {
	return {
		runtimeException: true,
		type: 'storage',
		storageSegment: 'system',
		notAllowedToOpenFS: true,
		storageType
	};
}

const KD_PARAMS_FILE_NAME = 'kd-params';
const LOCAL_STORAGE_DIR = 'local';
const SYNCED_STORAGE_DIR = 'synced';

/**
 * This function tries to get key derivation parameters from cache on a disk.
 * If not found, function will return undefined.
 * @param folder 
 */
async function readRootKeyDerivParamsFromCache(
	folder: string
): Promise<ScryptGenParams|undefined> {
	try {
		const str = await fs.readFile(
			join(folder, KD_PARAMS_FILE_NAME),
			{ encoding: 'utf8' });
		return JSON.parse(str) as ScryptGenParams;
	} catch (err) {
		if ((err as FileException).notFound) { return undefined; }
		throw errWithCause(err, `Can't read and parse content of obj status file ${KD_PARAMS_FILE_NAME} in folder ${folder}`);
	}

}

async function getAndCacheRootKeyDerivParamsFromServer(
	folder: string, getFromServer: () => Promise<ScryptGenParams>
): Promise<ScryptGenParams> {
	const params = await getFromServer();
	await saveRootKeyDerivParamsToDisk(folder, params);
	return params;
}

async function saveRootKeyDerivParamsToDisk(
	folder: string, params: ScryptGenParams
): Promise<void> {
	await fs.writeFile(
		join(folder, KD_PARAMS_FILE_NAME),
		JSON.stringify(params),
		{ encoding: 'utf8' }
	);
}


class StorageAndFS<T extends Storage> {
	
	rootFS: WritableFS = (undefined as any);

	private syncedAppDataRoots: AppDataFolders|undefined = undefined;
	
	private constructor(
		public storage: T
	) {
		Object.seal(this);
	}

	static async existing<T extends Storage>(
		storage: T, key: Uint8Array
	): Promise<StorageAndFS<T>|undefined> {
		const s = new StorageAndFS(storage);
		try {
			s.rootFS = await xspFS.fromExistingRoot(s.storage, key);
			if (s.rootFS.v?.sync) {
				s.syncedAppDataRoots = await AppDataFolders.make(s.rootFS);
			}
			return s;
		} catch (err) {
			if ((err as EncryptionException).failedCipherVerification) {
				return;
			} else {
				throw err;
			}
		}
	}

	static async makeNew<T extends Storage>(
		storage: T, key: Uint8Array
	): Promise<StorageAndFS<T>|undefined> {
		const s = new StorageAndFS(storage);
		s.rootFS = await xspFS.makeNewRoot(s.storage, key);
		await initSysFolders(s.rootFS);
		if (s.rootFS.v?.sync) {
			s.syncedAppDataRoots = await AppDataFolders.make(s.rootFS);
		}
		return s;
	}

	/**
	 * This creates app data folder.
	 * Folder objects are uploaded, if this is a synced storage.
	 * @param appFolder 
	 */
	async makeAppFS(appFolder: string): Promise<WritableFS> {
		if (('string' !== typeof appFolder) || (appFolder.length === 0)
		|| (appFolder.indexOf('/') >= 0)
		|| (appFolder === '.') || (appFolder === '..')) {
			throw makeBadAppNameExc(appFolder);
		}
		if (!this.rootFS) { throw new Error('Storage is not initialized.'); }
		const appDataFS = await (this.syncedAppDataRoots ?
			this.syncedAppDataRoots.getOrMake(appFolder) :
			this.rootFS.writableSubRoot(`${sysFolders.appData}/${appFolder}`)
		);
		return appDataFS;
	}

	userFS(): Promise<WritableFS> {
		return this.rootFS.writableSubRoot(sysFolders.userFiles);
	}

	async sysFSs(): Promise<FSCollection> {
		const folders = [
			sysFolders.appData, sysFolders.apps,
			sysFolders.packages,
			sysFolders.sharedLibs
		];
		const c = makeFSCollection();
		for (let fsName of folders) {
			await c.set!(fsName, {
				isFolder: true,
				item: await this.rootFS.writableSubRoot(fsName)
			});
		}
		return c;
	}

	async close(): Promise<void> {
		if (!this.rootFS) { return; }
		this.syncedAppDataRoots?.stopSync();
		await this.rootFS.close();
		await this.storage.close();
		this.syncedAppDataRoots = undefined;
		this.rootFS = (undefined as any);
		this.storage = (undefined as any);
	}

	/**
	 * Moves src to dst if dst doesn't exist.
	 * @param src is a path starting with core app folder name
	 * @param dst is a path starting with core app folder name
	 */
	async migrateCoreAppDataOnFirstRun(src: string, dst: string): Promise<void> {
		assert(
			src.startsWith(CORE_APPS_PREFIX) && !src.includes('..') &&
			dst.startsWith(CORE_APPS_PREFIX) && !dst.includes('..'),
			`Invalid core app data migration paths`
		);
		if (!(await this.rootFS.checkFolderPresence(src))
		|| !(await this.rootFS.checkFilePresence(src))
		|| (await this.rootFS.checkFolderPresence(dst))
		|| (await this.rootFS.checkFilePresence(dst))) {
			return;
		}
		await this.rootFS.move(
			`${sysFolders.appData}/${src}`,
			`${sysFolders.appData}/${dst}`
		);
	}

}
Object.freeze(StorageAndFS.prototype);
Object.freeze(StorageAndFS);


export class Storages implements FactoryOfFSs {

	private synced: StorageAndFS<SyncedStorage>|undefined = undefined;
	
	private local: StorageAndFS<Storage>|undefined = undefined;

	private preCloseWaits = new Set<Promise<void>>();

	constructor(
		private cryptor: AsyncSBoxCryptor,
		private storageDirForUser: StoragePathForUser
	) {
		Object.seal(this);
	}

	makeStorageCAP(
		appDomain: string, policy: StoragePolicy
	): { cap: Service; close: () => void; } {
		return (new PerAppStorage(this, appDomain, policy)).wrap();
	}

	addPreCloseWait(wait: Promise<void>): void {
		const detachWait = () => {
			this.preCloseWaits.delete(promise);
		};
		const promise = wait.then(detachWait, detachWait);
		this.preCloseWaits.add(promise);
	}

	storageGetterForASMail(): StorageGetter {
		return (type: FSType, location?: string): Storage => {
			if (type === 'share') {
				// TODO implement returning shared storage
				throw new Error(`Providing shared storage is not implemented, yet`);
			} else {
				throw new Error(`Cannot provide ${type} storage via asmail message storage`);
			}
		};
	}

	/**
	 * This is a storage getter for links and linking in local storage.
	 */
	private storageGetterForLocalStorage: StorageGetter = (type) => {
		if (type === 'local') {
			return this.local!.storage;	// TypeError can be due to no init
		} else if (type === 'synced') {
			return this.synced!.storage;	// TypeError can be due to no init
		} else if (type === 'share') {
			// TODO implement returning shared storage
			throw new Error(`Providing shared storage is not implemented, yet`);
		} else {
			throw new Error(`Cannot provide ${type} storage via local storage`);
		}
	};

	/**
	 * This is a storage getter for links and linking in synced storage.
	 */
	private storageGetterForSyncedStorage: StorageGetter = (type) => {
		if (type === 'synced') {
			return this.synced!.storage;	// TypeError can be due to no init
		} else if (type === 'share') {
			// TODO implement returning shared storage
			throw new Error(`Providing shared storage is not implemented, yet`);
		} else {
			throw new Error(`Cannot provide ${type} storage via synced storage`);
		}
	};

	async startInitFromCache(
		user: string, keyGen: GenerateKey,
		makeNet: MakeNet, resolver: ServiceLocator, logError: LogError
	): Promise<((getSigner: GetSigner) => void)|undefined> {
		const storageDir = this.storageDirForUser(user);
		const params = await readRootKeyDerivParamsFromCache(storageDir);
		if (!params) { return; }
		const key = await keyGen(params);
		this.local = await StorageAndFS.existing(
			await LocalStorage.makeAndStart(
				join(storageDir, LOCAL_STORAGE_DIR),
				this.storageGetterForLocalStorage,
				this.cryptor, logError
			),
			key
		);
		if (!this.local) { return; }

		const {
			syncedStore, setupRemoteAndStartObjProcs
		} = await SyncedStore.makeAndStartWithoutRemote(
			join(storageDir, SYNCED_STORAGE_DIR),
			user,
			this.storageGetterForSyncedStorage,
			this.cryptor,
			() => resolver(user), makeNet(),
			logError
		);
		this.synced = await StorageAndFS.existing(syncedStore, key);
		key.fill(0);
		if (!this.synced) { return; }

		return setupRemoteAndStartObjProcs;
	}

	async initFromRemote(
		user: string, getSigner: GetSigner, generateKey: GenerateKey,
		makeNet: MakeNet, resolver: ServiceLocator, logError: LogError
	): Promise<boolean> {
		const storageDir = this.storageDirForUser(user);
		const { startObjProcs, syncedStore } = await SyncedStore.makeAndStart(
			join(storageDir, SYNCED_STORAGE_DIR),
			user, getSigner,
			this.storageGetterForSyncedStorage,
			this.cryptor,
			() => resolver(user), makeNet(),
			logError
		);
		const params = await getAndCacheRootKeyDerivParamsFromServer(
			storageDir, syncedStore.getRootKeyDerivParamsFromServer
		);
		const key = await generateKey(params);
		this.synced = await StorageAndFS.existing(syncedStore, key);
		this.local = await StorageAndFS.makeNew(
			await LocalStorage.makeAndStart(
				join(storageDir, LOCAL_STORAGE_DIR),
				this.storageGetterForLocalStorage,
				this.cryptor, logError
			),
			key
		);
		key.fill(0);
		startObjProcs();
		return (!!this.synced && !!this.local);
	}

	async initFreshForNewUser(
		user: string, getSigner: GetSigner,
		params: ScryptGenParams, key: Uint8Array,
		makeNet: MakeNet, resolver: ServiceLocator, logError: LogError
	): Promise<boolean> {
		const storageDir = this.storageDirForUser(user);
		const { startObjProcs, syncedStore } = await SyncedStore.makeAndStart(
			join(storageDir, SYNCED_STORAGE_DIR),
			user, getSigner,
			this.storageGetterForSyncedStorage,
			this.cryptor,
			() => resolver(user), makeNet(),
			logError
		);
		this.synced = await StorageAndFS.makeNew(syncedStore, key);
		this.local = await StorageAndFS.makeNew(
			await LocalStorage.makeAndStart(
				join(storageDir, LOCAL_STORAGE_DIR),
				this.storageGetterForLocalStorage,
				this.cryptor, logError
			),
			key
		);
		key.fill(0);
		await saveRootKeyDerivParamsToDisk(storageDir, params);
		startObjProcs();
		return (!!this.synced && !!this.local);
	}

	makeSyncedFSForApp(appFolder: string): Promise<WritableFS> {
		// TypeError for undefined synced can be due to no init
		return this.synced!.makeAppFS(appFolder);
	}

	makeLocalFSForApp(appFolder: string): Promise<WritableFS> {
		// TypeError for undefined local can be due to no init
		return this.local!.makeAppFS(appFolder);
	}

	async getUserFS(type: StorageType): Promise<FSItem> {
		let fs: WritableFS;
		if (type === 'synced') {
			// TypeError for undefined synced can be due to no init
			 fs = await this.synced!.userFS();
		} else if (type === 'local') {
			// TypeError for undefined local can be due to no init
			fs = await this.local!.userFS();
		} else if (type === 'device') {
			fs = await userFilesOnDevice();
		} else {
			throw new Error(`Unknown storage type ${type}`);
		}
		return {
			isFolder: true,
			item: fs
		};
	}

	async getSysFSs(type: StorageType): Promise<FSItem> {
		if (type === 'synced') {
			return {
				isCollection: true,
				// TypeError for undefined synced can be due to no init
				item: await this.synced!.sysFSs()
			};
		} else if (type === 'local') {
			return {
				isCollection: true,
				// TypeError for undefined local can be due to no init
				item: await this.local!.sysFSs()
			};
		} else if (type === 'device') {
			return sysFilesOnDevice();
		} else {
			throw new Error(`Unknown storage type ${type}`);
		}
	}

	async close(): Promise<void> {
		if (!this.local) { return; }
		if (this.synced) {
			await this.synced.close();
		}
		await this.local.close();
		this.synced = undefined;
		this.local = undefined;
	}

	wrap(): FactoryOfFSs {
		return {
			addPreCloseWait: this.addPreCloseWait.bind(this),
			getSysFSs: this.getSysFSs.bind(this),
			getUserFS: this.getUserFS.bind(this),
			makeLocalFSForApp: this.makeLocalFSForApp.bind(this),
			makeSyncedFSForApp: this.makeSyncedFSForApp.bind(this)
		}
	}

	/**
	 * This is a migration used for developing/evolving core's apps.
	 * @param src is a path starting with core app folder name
	 * @param dst is a path starting with core app folder name
	 */
	async migrateCoreAppDataOnFirstRun(
		type: StorageType, src: string, dst: string
	): Promise<void> {
		if (type === 'synced') {
			await this.synced!.migrateCoreAppDataOnFirstRun(src, dst);
		} else if (type === 'local') {
			await this.local!.migrateCoreAppDataOnFirstRun(src, dst);
		}
	}

	suspendNetworkActivity(): void {
		this.synced?.storage.suspendNetworkActivity();
	}

	resumeNetworkActivity(): void {
		this.synced?.storage.resumeNetworkActivity();
	}

}
Object.freeze(Storages.prototype);
Object.freeze(Storages);


export interface FactoryOfFSs {
	makeSyncedFSForApp(appFolder: string): Promise<WritableFS>;
	makeLocalFSForApp(appFolder: string): Promise<WritableFS>;
	addPreCloseWait(wait: Promise<void>): void;
	getUserFS(type: StorageType): Promise<FSItem>;
	getSysFSs(type: StorageType): Promise<FSItem>;
}

export function reverseDomain(domain: string): string {
	return domain.split('.').reverse().join('.');
}

type Service = web3n.storage.Service;
type StoragePolicy = web3n.caps.common.StoragePolicy;


class PerAppStorage {

	private readonly appFSs = new Map<string, WritableFS>();
	private readonly revAppDomain: string;

	constructor(
		private readonly appFSsFactory: FactoryOfFSs,
		appDomain: string,
		private readonly policy: StoragePolicy
	) {
		this.revAppDomain = reverseDomain(appDomain);
		Object.seal(this);
	}

	wrap(): ReturnType<Storages['makeStorageCAP']> {
		const cap: Service = {
			getAppLocalFS: this.getAppLocalFS.bind(this),
			getAppSyncedFS: this.getAppSyncedFS.bind(this)
		};
		if (this.policy.canOpenUserFS) {
			cap.getUserFS = this.getUserFS.bind(this);
		}
		if (this.policy.canOpenSysFS) {
			cap.getSysFS = this.getSysFS.bind(this);
		}
		Object.freeze(cap);
		return { cap, close: () => this.close() };
	}

	private async getAppSyncedFS(appName?: string): Promise<WritableFS> {
		if (!appName) {
			appName = this.revAppDomain;
		}
		this.ensureAppFSAllowed(appName, 'synced');
		let appFS = this.appFSs.get(appName);
		if (!appFS) {
			appFS = await this.appFSsFactory.makeSyncedFSForApp(appName);
		}
		return appFS;
	}

	private async getAppLocalFS(appName?: string): Promise<WritableFS> {
		if (!appName) {
			appName = this.revAppDomain;
		}
		this.ensureAppFSAllowed(appName, 'local');
		let appFS = this.appFSs.get(appName);
		if (!appFS) {
			appFS = await this.appFSsFactory.makeLocalFSForApp(appName);
		}
		return appFS;
	}

	/**
	 * This throws up, if given file system is not allowed to be opened.
	 * @param appFolder 
	 * @param type 
	 */
	private ensureAppFSAllowed(appFolder: string, type: 'local'|'synced'): void {
		if (typeof appFolder !== 'string') { throw makeBadAppNameExc(appFolder); }
		if (appFolder.startsWith(CORE_APPS_PREFIX)) {
			throw makeNotAllowedToOpenAppFSExc(appFolder);
		}
		if (!this.policy.canOpenAppFS(appFolder, type)) {
			throw makeNotAllowedToOpenAppFSExc(appFolder); }
	}

	private async getUserFS(
		type: StorageType, path?: string
	): Promise<FSItem> {
		if (!this.policy.canOpenUserFS) {
			throw makeNotAllowedToOpenUserFSExc(type);
		}
		const policy = this.policy.canOpenUserFS(type);
		if (!policy) { throw makeNotAllowedToOpenUserFSExc(type); }

		const userFS = await this.appFSsFactory.getUserFS(type);
		return applyPolicyToFSItem(userFS, policy, path);
	}

	private async getSysFS(type: StorageType, path?: string): Promise<FSItem> {
		if (!this.policy.canOpenSysFS) {
			throw makeNotAllowedToOpenSysFSExc(type);
		}
		const policy = this.policy.canOpenSysFS(type);
		if (!policy) { throw makeNotAllowedToOpenSysFSExc(type); }

		const sysFS = await this.appFSsFactory.getSysFSs(type);
		return applyPolicyToFSItem(sysFS, policy, path);
	}
	
	private close(): void {
		for (const fs of this.appFSs.values()) {
			this.appFSsFactory.addPreCloseWait(fs.close());
		}
		this.appFSs.clear();
	}

}
Object.freeze(PerAppStorage.prototype);
Object.freeze(PerAppStorage);


async function applyPolicyToFSItem(
	fsi: FSItem, policy: 'w'|'r', path?: string
): Promise<FSItem> {
	if (fsi.isFolder) {
		return {
			isFolder: true,
			item: await applyPolicyToFS(fsi.item as WritableFS, policy, path)
		};
	} else if (fsi.isCollection) {
		return await applyPolicyToFSCollection(
			fsi.item as FSCollection, policy, path
		);
	} else {
		throw new Error(`Given fs item is neither folder, nor fs collection`);
	}
}

async function applyPolicyToFS(
	fs: WritableFS, policy: 'w'|'r', path?: string
): Promise<FS> {
	if (policy === 'w') {
		return ((path === undefined) ? fs : fs.writableSubRoot(path));
	} else {
		if (path === undefined) {
			path = '/';
		}
		return fs.readonlySubRoot(path);
	}
}

async function applyPolicyToFSCollection(
	c: FSCollection, policy: 'w'|'r', path?: string
): Promise<FSItem> {
	if (path === undefined) {
		if (policy === 'w') {
			return { isCollection: true, item: readonlyWrapFSCollection(c) };
		} else {
			const roFSs = makeFSCollection();
			for (const v of (await c.getAll())) {
				const fs = (v[1].item as WritableFS);
				if (!v[1].isFolder || !fs || !fs.listFolder) {
					throw new Error('Expected item to be a folder object');
				}
				v[1].item = await (v[1].item! as FS).readonlySubRoot('/');
				await roFSs.set!(v[0], v[1]);
			}
			return { isCollection: true, item: readonlyWrapFSCollection(roFSs) };
		}
	}

	if (path.startsWith('/')) {
		path = path.substring(1);
	}
	const nameAndItem = await asyncFind(
		await c.entries(), v => path!.startsWith(v[0])
	);
	if (!nameAndItem) { throw makeFileException('notFound', path); }
	const [ name, item ] = nameAndItem;
	path = path.substring(name.length);

	const fs = (item.item as WritableFS);
	if (!item.isFolder || !fs || !fs.listFolder) {
		throw new Error('Expected item to be a folder object');
	}

	if (typeof path !== 'string') {
		return {
			isFolder: true,
			item: await ((policy === 'w') ? fs : fs.readonlySubRoot('/'))
		};
	}

	const atPath = await fs.stat(path);
	if (atPath.isFolder) {
		return {
			isFolder: true,
			item: await ((policy === 'w') ?
				fs.writableSubRoot(path) : fs.readonlySubRoot(path)
			)
		}
	} else if (atPath.isFile) {
		return {
			isFile: true,
			item: await ((policy === 'w') ?
				fs.writableFile(path) : fs.readonlyFile(path)
			)
		};
	} else if (atPath.isLink) {
		const link = await fs.readLink(path);
		if (link.isFolder) {
			return {
				isFolder: true,
				item: await link.target()
			};
		} else if (link.isFile) {
			return {
				isFile: true,
				item: await link.target()
			};
		} else {
			throw makeFileException(
				'ioError', path, `Unknown type of linked fs item`
			);
		}
	} else {
		throw makeFileException('ioError', path, `Unknown type of fs item`);
	}
}


Object.freeze(exports);