/*
 Copyright (C) 2015 - 2022, 2025 3NSoft Inc.

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

import { SignUp, CreatedUser } from './startup/sign-up';
import { IdManager } from './id-manager';
import { Storages, FactoryOfFSs, reverseDomain } from './storage';
import { SignIn, GenerateKey, CompleteInitWithoutCache } from './startup/sign-in';
import { ASMail } from './asmail';
import { errWithCause, stringifyErr } from '../lib-common/exceptions/error';
import { copy as jsonCopy } from '../lib-common/json-utils';
import { makeCryptor } from '../lib-client/cryptor/cryptor';
import { Logger, makeLogger } from '../lib-client/logging/log-to-file';
import { NetClient } from '../lib-client/request-utils';
import { AppDirs, appDirs } from './app-files';
import { ServiceLocatorMaker } from '../lib-client/service-locator';
import { Keyrings } from './keyring';
import { ASMAIL_APP_NAME, KEYRINGS_APP_NAME, MAILERID_APP_NAME } from './storage/common/constants';
import { ConfigOfASMailServer } from './asmail/config';
import { defer, Deferred } from '../lib-common/processes/deferred';


type RequestedCAPs = web3n.caps.common.RequestedCAPs;
type StoragePolicy = web3n.caps.common.StoragePolicy;
type AppFSSetting = web3n.caps.common.AppFSSetting;
type FSSetting = web3n.caps.common.FSSetting;
type W3N = web3n.caps.common.W3N;
type BootProcessObserver = web3n.startup.BootProcessObserver;
type BootEvent = web3n.startup.BootEvent;
type ConnectException = web3n.ConnectException;

export interface CoreConf {
	dataDir: string;
	signUpUrl: string;
}

export type MakeNet = () => NetClient;


export class Core {

	private cryptor: ReturnType<makeCryptor>;
	private storages: Storages;
	private asmail: ASMail;
	private keyrings: Keyrings;
	private idManager: IdManager|undefined = undefined;
	private closingProc: Promise<void>|undefined = undefined;
	private isInitialized = false;

	private constructor(
		private readonly makeNet: MakeNet,
		private readonly makeResolver: ServiceLocatorMaker,
		makeCryptor: makeCryptor,
		private readonly appDirs: AppDirs,
		private readonly logger: Logger,
		private readonly signUpUrl: string
	) {
		this.cryptor = makeCryptor(this.logger.logError, this.logger.logWarning);
		this.storages = new Storages(
			this.cryptor.cryptor.sbox, this.appDirs.storagePathFor
		);
		this.keyrings = new Keyrings(this.cryptor.cryptor.sbox);
		this.asmail = new ASMail(
			this.cryptor.cryptor.sbox, this.makeNet,
			this.appDirs.inboxPathFor, this.logger
		);
		Object.seal(this);
	}

	static make(
		conf: CoreConf, makeNet: MakeNet,
		makeResolver: ServiceLocatorMaker, makeCryptor: makeCryptor
	): Core {
		const dirs = appDirs(conf.dataDir);
		const logger = makeLogger(dirs.getUtilFS());
		const core = new Core(
			makeNet, makeResolver, makeCryptor, dirs, logger, conf.signUpUrl
		);
		return core;
	}

	start(): {
		capsForStartup: web3n.startup.W3N;
		coreInit: Promise<string>;
		coreAppsInit: Promise<void>;
	} {
		const { promise: midPromise, resolve: midDone } = defer<IdManager>();
		const { watchBoot, emitBootEvent } = makeForBootEvents();

		const signUp = new SignUp(
			this.signUpUrl, this.cryptor.cryptor, this.makeNet,
			this.appDirs.getUsersOnDisk,
			user => this.initForNewUser(user, midDone, emitBootEvent),
			watchBoot,
			this.logger.logError
		);

		const signIn = new SignIn(
			this.cryptor.cryptor,
			addr  => this.initForExistingUserWithoutCache(addr, midDone, emitBootEvent),
			(addr, storageKey) => this.initForExistingUserWithCache(addr, storageKey, midDone, emitBootEvent),
			this.appDirs.getUsersOnDisk,
			watchBoot,
			this.logger.logError
		);

		const capsForStartup: web3n.startup.W3N = {
			signUp: signUp.exposedService(),
			signIn: signIn.exposedService()
		};
		Object.freeze(capsForStartup);

		const coreInit = midPromise.then(idManager => {
			this.idManager = idManager;
			return this.idManager.getId();
		});

		const coreAppsInit = coreInit.then(async () => {

			// XXX This should be removed, at some point, as there will be no more
			//     users with very old data folders.
			await this.performDataMigrationsAtInit();

			await this.initCoreApps(emitBootEvent);

			this.isInitialized = true;
		});

		return { coreInit, coreAppsInit, capsForStartup };
	};

	private async initForNewUser(
		u: CreatedUser, done: Deferred<IdManager>['resolve'], emitBootEvent: (ev: BootEvent) => void
	): Promise<void> {
		emitBootEvent({
			message: `Initializing system for new user ${u.address}`
		});
		try {

			// 1) init of id manager without setting fs
			const stepTwo = await IdManager.initWithoutStore(
				u.address, this.makeResolver('mailerid'), this.makeNet,
				this.logger.logError, this.logger.logWarning
			);
			if (!stepTwo) {
				const message = `MailerId server doesn't recognize identity ${u.address}`;
				emitBootEvent({ message, isError: true });
				throw new Error(message);
			}
			emitBootEvent({ message: `✔️  started login to provision MailerId` });

			// 2) complete id manager login, without use of fs
			const idManagerInit = await stepTwo(u.midSKey.default);
			if (!idManagerInit) {
				const message = `Failed to provision MailerId identity`;
				emitBootEvent({ message, isError: true });
				throw new Error(message);
			}
			emitBootEvent({ message: `✔️  MailerId certificate provisioned` });
			const { idManager, setupManagerStorage } = idManagerInit;

			// 3) initialize all storages
			emitBootEvent({ message: `Setting up main storage for new user` });
			const storesUp = await this.storages.initFreshForNewUser(
				u.address, idManager.getSigner, u.storeParams, u.storeSKey,
				this.makeNet, this.makeResolver('3nstorage'), this.logger.logError
			);
			if (!storesUp) {
				const message = `Main store failed to initialize for new user`;
				emitBootEvent({ message, isError: true });
				throw new Error(message);
			}
			emitBootEvent({ message: `✔️  main storage initialized` });

			// 3) give id manager fs, in which it will record labeled key(s)
			emitBootEvent({ coreApp: MAILERID_APP_NAME, message: `setting up storage` });
			await setupManagerStorage(
				await this.storages.makeSyncedFSForApp(MAILERID_APP_NAME),
				[ u.midSKey.labeled ]
			);
			emitBootEvent({ coreApp: MAILERID_APP_NAME, message: `✔️  storage setup completed` });

			done(idManager);
		} catch (exc) {
			if ((exc as ConnectException).type === 'connect') {
				emitBootEvent({ message: `🔌  fail due to loss of connectivity`, isError: true });
			} else {
				emitBootEvent({ message: exc.message ?? stringifyErr(exc), isError: true });
			}
			throw exc;
		}
	}

	private async initForExistingUserWithoutCache(
		address: string, done: Deferred<IdManager>['resolve'], emitBootEvent: (ev: BootEvent) => void
	): Promise<CompleteInitWithoutCache|undefined> {
		emitBootEvent({
			message: `Initializing system for user ${address}, without local cache on this device`
		});
		try {

			// 1) init of id manager without setting fs
			const stepTwo = await IdManager.initWithoutStore(
				address, this.makeResolver('mailerid'), this.makeNet,
				this.logger.logError, this.logger.logWarning
			);
			if (!stepTwo) {
				emitBootEvent({
					isError: true, message: `MailerId server doesn't recognize identity ${address}`
				});
				return;
			}

			return async (midLoginKey, storageKey) => {
				try {

					// 2) complete id manager login, without use of fs
					const idManagerInit = await stepTwo(midLoginKey);
					if (!idManagerInit) {
						emitBootEvent({
							isError: true, message: `password/key is incorrect to provision MailerId certificate`
						});
						return false;
					}
					emitBootEvent({ message: `✔️  MailerId certificate provisioned` });
					const { idManager, setupManagerStorage } = idManagerInit;

					// 3) initialize all storages
					emitBootEvent({ message: `Setting up main storage without local cache` });
					const storeDone = await this.storages.initFromRemote(
						address, idManager.getSigner, storageKey,
						this.makeNet, this.makeResolver('3nstorage'), this.logger.logError
					);
					if (!storeDone) {
						emitBootEvent({ message: `Main store failed to initialize`, isError: true });
						return false;
					}
					emitBootEvent({ message: `✔️  main storage initialized` });

					// 4) complete initialization of id manager
					emitBootEvent({ coreApp: MAILERID_APP_NAME, message: `setting up storage` });
					await setupManagerStorage(
						await this.storages.makeSyncedFSForApp(MAILERID_APP_NAME)
					);
					emitBootEvent({ coreApp: MAILERID_APP_NAME, message: `✔️  storage setup completed` });

					done(idManager);
					return true;
				} catch (exc) {
					if ((exc as ConnectException).type === 'connect') {
						emitBootEvent({ message: `🔌  fail due to loss of connectivity`, isError: true });
					} else {
						emitBootEvent({ message: exc.message ?? stringifyErr(exc), isError: true });
					}
					throw exc;
				}
			};
		} catch (exc) {
			if ((exc as ConnectException).type === 'connect') {
				emitBootEvent({ message: `🔌  fail due to loss of connectivity`, isError: true });
			} else {
				emitBootEvent({ message: exc.message ?? stringifyErr(exc), isError: true });
			}
			throw exc;
		}
	}

	private async initForExistingUserWithCache(
		address: string, storageKey: GenerateKey, done: Deferred<IdManager>['resolve'],
		emitBootEvent: (ev: BootEvent) => void
	): Promise<boolean> {
		emitBootEvent({
			message: `Initializing system for user ${address}, with local cache on this device`
		});
		try {

			emitBootEvent({ message: `Unlocking data from local cache with provided password/key` });
			const completeStorageInit = await this.storages.startInitFromCache(
				address, storageKey,
				this.makeNet, this.makeResolver('3nstorage'), this.logger.logError
			);
			if (!completeStorageInit) {
				emitBootEvent({
					isError: true, message: `password/key is incorrect to decrypt local caches, or caches are damaged`
				});
				return false;
			}
			emitBootEvent({ message: `✔️  main storage is opened` });

			const idManager = await IdManager.initFromCachedStore(
				address,
				await this.storages.makeSyncedFSForApp(MAILERID_APP_NAME),
				this.makeResolver('mailerid'), this.makeNet,
				this.logger.logError, this.logger.logWarning
			);
			if (!idManager) { return false; }
			emitBootEvent({ message: `✔️  MailerId manager is initialized` });

			completeStorageInit(idManager.getSigner);
			done(idManager);
			return true;
		} catch (exc) {
			emitBootEvent({ message: exc.message ?? stringifyErr(exc), isError: true });
			throw exc;
		}
	}

	makeCAPsForApp(
		appDomain: string, requestedCAPs: RequestedCAPs
	): { caps: W3N; close: () => void; } {
		if (!this.isInitialized || this.closingProc) {
			throw new Error(
				`Core is either not yet initialized, or is already closed.`
			);
		}

		const { storage, close } = this.makeStorageCAP(appDomain, requestedCAPs);
		const mail = this.makeMailCAP(requestedCAPs);
		const log = this.makeLogCAP(appDomain, requestedCAPs)!;
		const mailerid = this.makeMailerIdCAP(requestedCAPs);
		const keyrings = this.makeKeyringsCAP(requestedCAPs);

		const caps: W3N = { mail, log, mailerid, storage, keyrings };

		return { caps, close };
	};

	private makeStorageCAP(
		appDomain: string, requestedCAPs: RequestedCAPs
	): { storage?: W3N['storage']; close: () => void; } {
		if (requestedCAPs.storage) {
			const {
				cap: storage, close
			} = this.storages.makeStorageCAP(
				appDomain, makeStoragePolicy(appDomain, requestedCAPs)
			);
			return { storage, close };
		} else {
			return { close: () => {} };
		}
	}

	private makeMailCAP(requestedCAPs: RequestedCAPs): W3N['mail'] {
		if (!requestedCAPs.mail) {
			return;
		}
		const { sendingTo, receivingFrom, preflightsTo } = requestedCAPs.mail;
		if ((receivingFrom === 'all') && (sendingTo === 'all')) {
			return this.asmail.makeASMailCAP();
		} else if (preflightsTo === 'all') {
			return this.asmail.makePreflightOnlyASMailCAP();
		} else {
			return undefined;
		}
	}

	private makeKeyringsCAP(requestedCAPs: RequestedCAPs): W3N['keyrings'] {
		if (requestedCAPs.keyrings
		&& (requestedCAPs.keyrings === 'all')) {
			return this.keyrings.makeKeyringsCAP();
		} else {
			return undefined;
		}
	}

	private makeLogCAP(
		appDomain: string, requestedCAPs: RequestedCAPs
	): W3N['log']|undefined {
		if (requestedCAPs.logToPlatform === true) {
			return (type, msg, e) => this.logger.appLog(
				type, appDomain, msg, e
			);
		} else {
			return undefined;
		}
	}

	private makeMailerIdCAP(requestedCAPs: RequestedCAPs): W3N['mailerid'] {
		if (requestedCAPs.mailerid === true) {
			return this.idManager!.makeMailerIdCAP();
		} else {
			return undefined;
		}
	}

	async close(): Promise<void> {
		if (!this.closingProc) {
			this.closingProc = (async () => {
				if (this.isInitialized) {
					await this.asmail.close();
					await this.keyrings.close();
					await this.storages.close();
					this.asmail = (undefined as any);
					this.keyrings = (undefined as any);
					this.idManager = (undefined as any);
					this.storages = (undefined as any);
				}
				await this.cryptor.close();
				this.cryptor = (undefined as any);
			})();
		}
		await this.closingProc;
	}

	private async performDataMigrationsAtInit(): Promise<void> {
		await this.storages.migrateCoreAppDataOnFirstRun(
			'synced', `${ASMAIL_APP_NAME}/keyring`, KEYRINGS_APP_NAME
		);
		await this.storages.migrateCoreAppDataOnFirstRun(
			'synced',
			`${ASMAIL_APP_NAME}/config/introductory-key.json`,
			`${KEYRINGS_APP_NAME}/introductory-keys/published-on-server.json`
		);
		await this.storages.migrateCoreAppDataOnFirstRun(
			'synced', `${ASMAIL_APP_NAME}/config/anonymous/invites.json`, `${ASMAIL_APP_NAME}/sending-params/anonymous-invites.json`
		);
	}

	private async initCoreApps(emitBootEvent: (ev: BootEvent|true) => void): Promise<void> {
		try {
			const address = this.idManager!.getId();
			const getSigner = this.idManager!.getSigner;

			const asmailServerConfig = new ConfigOfASMailServer(
				address, getSigner, this.makeResolver('asmail'), this.makeNet()
			);

			emitBootEvent({ coreApp: KEYRINGS_APP_NAME, message: `starting initialization` });
			const keyringsSyncedFS = await this.storages.makeSyncedFSForApp(
				KEYRINGS_APP_NAME
			);
			await this.keyrings.init(
				keyringsSyncedFS, this.idManager!.getSigner,
				asmailServerConfig.makeParamSetterAndGetter('init-pub-key')
			);
			emitBootEvent({ coreApp: KEYRINGS_APP_NAME, message: `✔️  initialized` });

			emitBootEvent({ coreApp: ASMAIL_APP_NAME, message: `starting initialization` });
			const inboxSyncedFS = await this.storages.makeSyncedFSForApp(
				ASMAIL_APP_NAME
			);
			const inboxLocalFS = await this.storages.makeLocalFSForApp(
				ASMAIL_APP_NAME
			);
			await this.asmail.init(
				this.idManager!.getId(), this.idManager!.getSigner,
				inboxSyncedFS, inboxLocalFS,
				this.storages.storageGetterForASMail(), this.makeResolver,
				asmailServerConfig, this.keyrings.forASMail()
			);
			emitBootEvent({ coreApp: ASMAIL_APP_NAME, message: `✔️  initialized` });
		} catch (err) {
			emitBootEvent({ isError: true, message: err.message ?? stringifyErr(err) });
			throw errWithCause(err, 'Failed to initialize core apps');
		}
		emitBootEvent(true);
	}

	getStorages(): FactoryOfFSs {
		return this.storages.wrap();
	}

}
Object.freeze(Core.prototype);
Object.freeze(Core);


function makeForBootEvents() {
	let bootProcObserver: BootProcessObserver|undefined = undefined;
	return {
		watchBoot(obs: BootProcessObserver): () => void {
			if (bootProcObserver) {
				bootProcObserver.error?.(`New observer is added, and it stops the previous one.`);
			}
			bootProcObserver = obs;
			return () => {
				bootProcObserver = undefined;
			}
		},
		emitBootEvent(ev: BootEvent|true): void {
			if (ev === true) {
				bootProcObserver?.complete?.();
			} else {
				bootProcObserver?.next?.(ev);
			}
		}
	};
}


function makeStoragePolicy(
	appDomain: string, requestedCAPs: RequestedCAPs
): StoragePolicy {
	if (!requestedCAPs.storage) {
		throw new Error(`Missing storage setting in app's manifest`);
	}
	const capReq = requestedCAPs.storage;

	let policy: StoragePolicy;
	if (capReq.appFS === 'default') {
		policy = {
			canOpenAppFS: singleDomainAppFSChecker({
				domain: appDomain,
				storage: 'synced-n-local'
			})
		};
	} else if (Array.isArray(capReq.appFS)) {
		const okDomains = capReq.appFS
		.filter(fsInfo =>
			(fsInfo.domain === appDomain) || fsInfo.domain.endsWith('.'+appDomain)
		)
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
		(s.revDomain === appFolder) && appFSTypeAllowed(s.storage, type)
	));
}

type FSChecker = (type: web3n.storage.StorageType) => 'w'|'r'|false;

const allFSs: FSChecker = () => 'w';

function fsChecker(setting: FSSetting[]): FSChecker {
	return type => {
		const s = setting.find(s => (s.type === type));
		if (!s) { return false; }
		return (s.writable ? 'w' : 'r');
	};
}

Object.freeze(exports);