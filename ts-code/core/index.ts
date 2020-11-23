/*
 Copyright (C) 2015 - 2020 3NSoft Inc.

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

import { SignUp, CreatedUser } from './sign-up';
import { IdManager } from './id-manager';
import { Storages, FactoryOfFSs } from './storage';
import { SignIn, StartInitWithoutCache, InitWithCache } from './sign-in';
import { ASMail } from './asmail';
import { errWithCause } from '../lib-common/exceptions/error';
import { copy as jsonCopy } from '../lib-common/json-utils';
import { makeCryptor } from '../lib-client/cryptor/cryptor';
import { Subject, merge } from 'rxjs';
import { Logger, makeLogger } from '../lib-client/logging/log-to-file';
import { flatMap, take } from 'rxjs/operators';
import { NetClient } from '../lib-client/request-utils';
import { AppDirs, appDirs } from './app-files';

const ASMAIL_APP_NAME = 'computer.3nweb.core.asmail';
const MAILERID_APP_NAME = 'computer.3nweb.core.mailerid';

type AppManifest = web3n.caps.common.AppManifest;
type StoragePolicy = web3n.caps.common.StoragePolicy;
type AppFSSetting = web3n.caps.common.AppFSSetting;
type FSSetting = web3n.caps.common.FSSetting;
type W3N = web3n.caps.common.W3N;

export interface CoreConf {
	dataDir: string;
	signUpUrl: string;
}


export class Core {

	private cryptor: ReturnType<typeof makeCryptor>;
	private storages: Storages;
	private asmail: ASMail;
	private idManager: IdManager|undefined = undefined;
	private isInitialized = false;
	private isClosed = false;

	private constructor(
		private readonly makeNet: () => NetClient,
		private readonly appDirs: AppDirs,
		private readonly logger: Logger,
		private readonly signUpUrl: string
	) {
		this.cryptor = makeCryptor(this.logger.logWarning);
		this.storages = new Storages(
			this.cryptor.cryptor.sbox, this.appDirs.storagePathFor);
		this.asmail = new ASMail(
			this.cryptor.cryptor.sbox, this.makeNet,
			this.appDirs.inboxPathFor, this.logger);
		Object.seal(this);
	}

	static make(conf: CoreConf, makeNet: () => NetClient): Core {
		const dirs = appDirs(conf.dataDir);
		const logger = makeLogger(dirs.getUtilFS());
		const core = new Core(makeNet, dirs, logger, conf.signUpUrl);
		return core;
	}

	start(): { capsForStartup: web3n.startup.W3N, coreInit: Promise<string>; } {
		const signUp = new SignUp(
			this.signUpUrl, this.cryptor.cryptor, this.makeNet,
			this.appDirs.getUsersOnDisk, this.logger.logError);
		const signIn = new SignIn(
			this.cryptor.cryptor,
			this.initForExistingUserWithoutCache,
			this.initForExistingUserWithCache,
			this.appDirs.getUsersOnDisk, this.logger.logError);
		
		const capsForStartup: web3n.startup.W3N = {
			signUp: signUp.exposedService(),
			signIn: signIn.exposedService()
		};
		Object.freeze(capsForStartup);

		const initFromSignUp$ = signUp.newUser$
		.pipe(
			flatMap(this.initForNewUser, 1)
		);

		const initFromSignIn$ = signIn.existingUser$;

		const coreInit = merge(initFromSignIn$, initFromSignUp$)
		.pipe(
			take(1),
			flatMap(idManager => this.initCore(idManager), 1)
		)
		.toPromise();

		return { coreInit, capsForStartup };
	};

	private initForNewUser = async (u: CreatedUser): Promise<IdManager> => {
		// 1) init of id manager without setting fs
		const idManager = await IdManager.initInOneStepWithoutStore(
			u.address, u.midSKey.default, this.makeNet,
			this.logger.logError, this.logger.logWarning);
		if (!idManager) { throw new Error(
			`Failed to provision MailerId identity`); }

		// 2) setup storage
		const storesUp = await this.storages.initFromRemote(
			u.address, idManager.getSigner, u.storeSKey,
			this.makeNet, this.logger.logError);
		if (!storesUp) { throw new Error(`Stores failed to initialize`); }

		// 3) give id manager fs, in which it will record labeled key(s)
		await idManager.setStorages(
			await this.storages.makeLocalFSForApp(MAILERID_APP_NAME),
			await this.storages.makeSyncedFSForApp(MAILERID_APP_NAME),
			[ u.midSKey.labeled ]);

		return idManager;
	};

	private initForExistingUserWithoutCache: StartInitWithoutCache = async (
		address
	) => {
		// 1) init of id manager without setting fs
		const stepTwo = await IdManager.initWithoutStore(
			address, this.makeNet, this.logger.logError, this.logger.logWarning);
		if (!stepTwo) { return; }
		return async (midLoginKey, storageKey) => {
			// 2) complete id manager login, without use of fs
			const idManager = await stepTwo(midLoginKey);
			if (!idManager) { return; }

			// 3) initialize all storages
			const storeDone = await this.storages.initFromRemote(
				address, idManager.getSigner, storageKey, this.makeNet,
				this.logger.logError);
			if (!storeDone) { return; }

			// 4) complete initialization of id manager
			await idManager.setStorages(
				await this.storages.makeLocalFSForApp(MAILERID_APP_NAME),
				await this.storages.makeSyncedFSForApp(MAILERID_APP_NAME));
				
			return idManager;
		};
	};

	private initForExistingUserWithCache: InitWithCache = async (
		address, storageKey
	) => {
		const completeStorageInit = await this.storages.startInitFromCache(
			address, storageKey, this.makeNet, this.logger.logError);
		if (!completeStorageInit) { return; }

		const idManager = await IdManager.initFromLocalStore(address,
			await this.storages.makeLocalFSForApp(MAILERID_APP_NAME),
			this.makeNet, this.logger.logError, this.logger.logWarning);

		if (idManager) {
			const res = await completeStorageInit(idManager.getSigner);
			await idManager.setStorages(
				undefined,
				await this.storages.makeSyncedFSForApp(MAILERID_APP_NAME));
			return (res ? idManager : undefined);
		}

		return async (midLoginKey) => {
			const idManager = await IdManager.initInOneStepWithoutStore(
				address, midLoginKey, this.makeNet,
				this.logger.logError, this.logger.logWarning);
			if (!idManager) { return; }
			const res = await completeStorageInit!(idManager.getSigner);
			await idManager.setStorages(
				await this.storages.makeLocalFSForApp(MAILERID_APP_NAME),
				await this.storages.makeSyncedFSForApp(MAILERID_APP_NAME));
			return (res ? idManager : undefined);
		};

	};

	makeCAPsForApp(
		appDomain: string, manifest: AppManifest
	): { caps: W3N; close: () => void; } {
		if (!this.isInitialized || this.isClosed) { throw new Error(
			`Core is either not yet initialized, or is already closed.`); }

		if (appDomain !== manifest.appDomain) {
			throw new Error(`App manifest is for domain ${manifest.appDomain}, while app's domain is ${appDomain}`);
		}

		const { cap: storage, close } = this.makeStorageCAP(manifest);
		const mail = this.makeMailCAP(manifest);
		const log = this.makeLogCAP(manifest);
		const mailerid = this.makeMailerIdCAP(manifest);

		const caps: W3N = { mail, log, mailerid, storage };

		return { caps, close };
	};

	private makeStorageCAP(
		m: AppManifest
	): ReturnType<Storages['makeStorageCAP']> {
		return this.storages.makeStorageCAP(makeStoragePolicy(m));
	}

	private makeMailCAP(m: AppManifest): W3N['mail'] {
		if ((m.capsRequested.mail!.receivingFrom === 'all')
		&& (m.capsRequested.mail!.sendingTo === 'all')) {
			return this.asmail.makeASMailCAP();
		} else {
			return undefined;
		}
	}

	private makeLogCAP(m: AppManifest): W3N['log'] {
		return (type, msg, e) => this.logger.appLog(
			type, m.appDomain, msg, e);
	}

	private makeMailerIdCAP(m: AppManifest): W3N['mailerid'] {
		if (m.capsRequested.mailerid === true) {
			return this.idManager!.makeMailerIdCAP();
		} else {
			return undefined;
		}
	}

	private closeBroadcast = new Subject<void>();

	close$ = this.closeBroadcast.asObservable();

	async close(): Promise<void> {
		if (this.isClosed) { return; }
		if (this.isInitialized) {
			await this.asmail.close();
			await this.storages.close();
			this.asmail = (undefined as any);
			this.storages = (undefined as any);
		}
		this.cryptor.close();
		this.cryptor = (undefined as any);
		this.isClosed = true;
		this.closeBroadcast.next();
	}

	private async initCore(idManager: IdManager): Promise<string> {
		try {
			this.idManager = idManager;
			const inboxSyncedFS = await this.storages.makeSyncedFSForApp(
				ASMAIL_APP_NAME);
			const inboxLocalFS = await this.storages.makeLocalFSForApp(
				ASMAIL_APP_NAME);
			await this.asmail.init(
				this.idManager.getId(), this.idManager.getSigner,
				inboxSyncedFS, inboxLocalFS, this.storages.storageGetterForASMail()
			);
			this.isInitialized = true;
			return this.idManager.getId();
		} catch (err) {
			throw errWithCause(err, 'Failed to initialize core');
		}
	}

	getStorages(): FactoryOfFSs {
		return this.storages.wrap();
	}

}
Object.freeze(Core.prototype);
Object.freeze(Core);


function makeStoragePolicy(manifest: AppManifest): StoragePolicy {
	if (!manifest.capsRequested.storage) { throw new Error(
		`Missing storage setting in app's manifest`); }
	const capReq = manifest.capsRequested.storage;

	let policy: StoragePolicy;
	if (capReq.appFS === 'default') {
		policy = {
			canOpenAppFS: singleDomainAppFSChecker({
				domain: manifest.appDomain,
				storage: 'synced-n-local'
			})
		};
	} else if (Array.isArray(capReq.appFS)) {
		const okDomains = capReq.appFS
		.filter(fsInfo =>
			(fsInfo.domain === manifest.appDomain) ||
			fsInfo.domain.endsWith('.'+manifest.appDomain))
		.map(fsInfo => jsonCopy(fsInfo));
		policy = {
			canOpenAppFS: severalDomainsAppFSChecker(okDomains)
		};
	} else {
		policy = {
			canOpenAppFS: noFS
		};
	}

	if (capReq.userFS) {
		if (capReq.userFS === 'all') {
			policy.canOpenUserFS = allFSs;
		} else if (Array.isArray(capReq.userFS)) {
			policy.canOpenUserFS = fsChecker(capReq.userFS);
		}
	}

	if (capReq.sysFS) {
		if (capReq.sysFS === 'all') {
			policy.canOpenSysFS = allFSs;
		} else if (Array.isArray(capReq.sysFS)) {
			policy.canOpenSysFS = fsChecker(capReq.sysFS);
		}
	}

	return Object.freeze(policy);
}

type AppFSChecker = (appFolder: string, type: 'local'|'synced') => boolean;

const noFS: AppFSChecker = () => false;

export function reverseDomain(domain: string): string {
	return domain.split('.').reverse().join('.');
}

function singleDomainAppFSChecker(appFS: AppFSSetting): AppFSChecker {
	const revDomain = reverseDomain(appFS.domain);
	const allowedType = appFS.storage;
	return (appFolder, type) => {
		return (appFSTypeAllowed(allowedType, type) && (appFolder === revDomain));
	};
}

function appFSTypeAllowed(
	allowed: 'synced' | 'local' | 'synced-n-local', type: 'synced' | 'local'
): boolean {
	if (type === 'local') {
		if (allowed === 'synced-n-local') { return true; }
		if (allowed === 'local') { return true; }
	} else if (type === 'synced') {
		if (allowed === 'synced-n-local') { return true; }
		if (allowed === 'synced') { return true; }
	}
	return false;
}

function severalDomainsAppFSChecker(appFSs: AppFSSetting[]): AppFSChecker {
	const settings = appFSs.map(s => ({
		revDomain: reverseDomain(s.domain),
		storage: s.storage
	}));
	return (appFolder, type) => !!settings.find(s => (
		(s.revDomain === appFolder) && appFSTypeAllowed(s.storage, type)));
}

type FSChecker = (type: web3n.storage.StorageType) => 'w'|'r'|false;

const allFSs: FSChecker = () => 'w';

function fsChecker(setting: FSSetting[]): FSChecker {
	return (type: web3n.storage.StorageType) => {
		const s = setting.find(s => (s.type === type));
		if (!s) { return false; }
		return (s.writable ? 'w' : 'r');
	};
}

Object.freeze(exports);