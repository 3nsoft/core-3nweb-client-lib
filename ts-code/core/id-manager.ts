/*
 Copyright (C) 2015 - 2018, 2020 - 2021 3NSoft Inc.
 
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

import { box } from 'ecma-nacl';
import { MailerIdProvisioner } from '../lib-client/mailer-id/provisioner';
import { user as mid } from '../lib-common/mid-sigs-NaCl-Ed';
import { JsonKey, keyFromJson, use as keyUse } from '../lib-common/jwkeys';
import { PKLoginException } from '../lib-client/user-with-pkl-session';
import { SingleProc } from '../lib-common/processes/synced';
import { GenerateKey } from './sign-in';
import { LogError, LogWarning } from '../lib-client/logging/log-to-file';
import { NetClient } from '../lib-client/request-utils';
import { startMidSession, authenticateMidSession } from '../lib-client/mailer-id/login';
import { ServiceLocator } from '../lib-client/service-locator';

type WritableFS = web3n.files.WritableFS;

const CERTIFICATE_DURATION_SECONDS = 16*60*60;
const ASSERTION_VALIDITY = 15*60;

const MIN_SECS_LEFT_ASSUMED_OK = 10*60;

/**
 * This function completes provisioning process, returning a promise, resolvable
 * to either true, when all is done, or to false, when challenge reply is not
 * accepted by the server.
 */
export interface CompleteProvisioning {
	keyParams: any;
	complete(defaultSKey: Uint8Array): Promise<boolean>;
}

/**
 * This returns a promise, resolvable to mailerId signer.
 */
export type GetSigner = () => Promise<mid.MailerIdSigner>;

const LOGIN_KEY_FILE_NAME = 'login-keys';

interface LoginKeysJSON {
	address: string;
	keys: JsonKey[];
}

export class IdManager {

	private signer: mid.MailerIdSigner = (undefined as any);
	private localFS: WritableFS|undefined = undefined;
	private syncedFS: WritableFS|undefined = undefined;
	private provisioningProc = new SingleProc();

	private constructor(
		private makeNet: () => NetClient,
		private midServiceFor: ServiceLocator,
		private readonly logError: LogError,
		private readonly logWarning: LogWarning,
		private address: string,
		localFS?: WritableFS
	) {
		if (localFS) {
			this.localFS = localFS;
		}
		Object.seal(this);
	}

	static async initInOneStepWithoutStore(
		address: string, midLoginKey: GenerateKey|Uint8Array,
		resolver: ServiceLocator, makeNet: () => NetClient,
		logError: LogError, logWarning: LogWarning
	): Promise<IdManager|undefined> {
		const stepTwo = await IdManager.initWithoutStore(
			address, resolver, makeNet, logError, logWarning);
		if (!stepTwo) { throw new Error(
			`MailerId server doesn't recognize identity ${address}`); }
		return stepTwo(midLoginKey);
	}

	static async initWithoutStore(
		address: string, resolver: ServiceLocator, makeNet: () => NetClient,
		logError: LogError, logWarning: LogWarning
	): Promise<((midLoginKey: GenerateKey|Uint8Array) => Promise<IdManager|undefined>) | undefined> {
		const idManager = new IdManager(
			makeNet, resolver, logError, logWarning, address);
		const completion = await idManager.provisionWithGivenKey(address);
		if (!completion) { return; }
		return async (midLoginKey) => {
			const key = ((typeof midLoginKey === 'function') ?
				await midLoginKey(completion.keyParams) :
				midLoginKey);
			const isDone = await completion.complete(key);
			key.fill(0);
			return (isDone ? idManager : undefined);
		}
	}

	static async initFromLocalStore(
		address: string, localFS: WritableFS,
		resolver: ServiceLocator, makeNet: () => NetClient,
		logError: LogError, logWarning: LogWarning
	): Promise<IdManager|undefined> {
		const idMan = new IdManager(
			makeNet, resolver, logError, logWarning, address);
		if (localFS.type !== 'local') { throw new Error(
			`Expected local storage is typed as ${localFS.type}`); }
		idMan.localFS = localFS;
		try {
			await idMan.provisionUsingSavedKey();
		} catch (err) {
			await logError(err, `Can't initialize id manager from local store`);
			return;
		}
		return idMan;
	}

	private async ensureLocalCacheOfKeys(): Promise<void> {
		if (!this.localFS || !this.syncedFS) { throw new Error(
			`Id manager's storages are not set.`); }
		const keysCached = await this.localFS.checkFilePresence(
			LOGIN_KEY_FILE_NAME);
		if (keysCached) { return; }
		try {
			const bytes = await this.syncedFS.readBytes(LOGIN_KEY_FILE_NAME);
			await this.localFS.writeBytes(LOGIN_KEY_FILE_NAME, bytes!);
			bytes!.fill(0);
		} catch (err) {
			await this.logError(
				err, `Fail to ensure local cache of MailerId login keys.`);
		}
	}

	private async getSavedKey(): Promise<JsonKey|undefined> {
		if (!this.localFS) { throw new Error(
			`Id manager's local storage is not set.`); }
		const json = await this.localFS.readJSONFile<LoginKeysJSON>(
			LOGIN_KEY_FILE_NAME).catch(notFoundOrReThrow);
		if (json) { return json.keys[0]; }
		if (this.syncedFS) {
			const json = await this.syncedFS.readJSONFile<LoginKeysJSON>(
				LOGIN_KEY_FILE_NAME).catch(notFoundOrReThrow);
			if (json) {
				await this.ensureLocalCacheOfKeys();
				return json.keys[0];
			} else {
				await this.logWarning(
					`IdManager: there is no login MailerId login keys`);
			}
		}
		return;
	}

	async setStorages(
		localFS: WritableFS|undefined, syncedFS: WritableFS,
		keysToSave?: JsonKey[]
	): Promise<void> {
		if (localFS) {
			if (localFS.type !== 'local') { throw new Error(
				`Expected local storage is typed as ${localFS.type}`); }
				this.localFS = localFS;
		} else {
			if (!this.localFS) { throw new Error(`Local storage is not given`); }
		}
		if (syncedFS.type !== 'synced') { throw new Error(
			`Expected synced storage is typed as ${syncedFS.type}`); }
		this.syncedFS = syncedFS;
		if (keysToSave) {
			const json: LoginKeysJSON = {
				address: this.address,
				keys: keysToSave
			};
			await this.localFS.writeJSONFile(LOGIN_KEY_FILE_NAME, json);
			await this.syncedFS.writeJSONFile(LOGIN_KEY_FILE_NAME, json);
		} else {
			await this.ensureLocalCacheOfKeys();
		}
	}

	private async provisionWithGivenKey(
		address: string
	): Promise<CompleteProvisioning|undefined> {
		const midUrl = await this.midServiceFor(address);
		const provisioner = new MailerIdProvisioner(
			address, midUrl, this.makeNet());
		try {
			const provisioning = await provisioner.provisionSigner(undefined);
			const completion = async (defaultSKey: Uint8Array): Promise<boolean> => {
				try {
					this.signer = await provisioning.complete(() => {
							const dhshared = box.calc_dhshared_key(
								provisioning.serverPKey, defaultSKey);
							defaultSKey.fill(0);
							return dhshared;
						},
						CERTIFICATE_DURATION_SECONDS, ASSERTION_VALIDITY);
					this.address = address;
					return true;
				} catch (err) {
					if ((<PKLoginException> err).cryptoResponseNotAccepted) {
						return false;
					} else {
						throw err;
					}
				}
			};
			return {
				keyParams: provisioning.keyParams,
				complete: completion
			};
		} catch (err) {
			if (err.unknownUser) {
				return;
			} else {
				throw err;
			}
		}
	}

	private async provisionUsingSavedKey(): Promise<mid.MailerIdSigner> {
		let proc = this.provisioningProc.latestTaskAtThisMoment<mid.MailerIdSigner>();
		if (proc) { return proc; }
		proc = this.provisioningProc.start(async () => {
			const midUrl = await this.midServiceFor(this.address);
			const provisioner = new MailerIdProvisioner(
				this.address, midUrl, this.makeNet());
			const key = await this.getSavedKey();
			if (!key) { throw new Error(
				`No saved MailerId login key can be found`); }
			const skey = keyFromJson(key, keyUse.MID_PKLOGIN,
				box.JWK_ALG_NAME, box.KEY_LENGTH);
			const provisioning = await provisioner.provisionSigner(skey.kid);
			this.signer = await provisioning.complete(() => {
				const dhshared = box.calc_dhshared_key(
					provisioning.serverPKey, skey.k);
				skey.k.fill(0);
				return dhshared;
			}, CERTIFICATE_DURATION_SECONDS, ASSERTION_VALIDITY);
			return this.signer;
		});
		return proc;
	}

	getId(): string {
		return this.address;
	}

	getSigner: GetSigner = async () => {
		if (!this.address) { throw new Error(
			'Address is not set in id manager'); }
		if (!this.isProvisionedAndValid()) {
			await this.provisionUsingSavedKey();
		}
		return this.signer;
	};

	isProvisionedAndValid(): boolean {
		if (!this.signer) { return false; }
		if (this.signer.certExpiresAt >=
				(Date.now()/1000 + MIN_SECS_LEFT_ASSUMED_OK)) {
			return true;
		} else {
			this.signer = (undefined as any);
			return false;
		}
	}

	makeMailerIdCAP(): Service {
		const w: Service = {
			getUserId: async () => this.getId(),
			login: async serviceUrl => {
				const signer = await this.getSigner();
				return doMidLogin(serviceUrl, this.getId(), this.makeNet(), signer);
			}
		};
		return Object.freeze(w);
	}

}

type Service = web3n.mailerid.Service;

type FileException = web3n.files.FileException;

/**
 * This is a catch callback, which returns undefined on file(folder) not found
 * exception, and re-throws all other exceptions/errors.
 */
function notFoundOrReThrow(exc: FileException): void {
	if (!exc.notFound) { throw exc; }
}

async function doMidLogin(
	loginUrl: string, userId: string, net: NetClient, signer: mid.MailerIdSigner
): Promise<string> {
	const { sessionId, redirect } = await startMidSession(userId, net, loginUrl);
	if (!sessionId) {
		throw Error(`Unexpected redirect of MailerId login from ${loginUrl} to ${redirect}`);
	}
	await authenticateMidSession(sessionId, signer, net, loginUrl);
	return sessionId;
}


Object.freeze(exports);