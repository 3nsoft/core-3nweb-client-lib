/*
 Copyright (C) 2015 - 2018, 2020 - 2022 3NSoft Inc.
 
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
import { MailerIdProvisioner } from '../../lib-client/mailer-id/provisioner';
import { user as mid } from '../../lib-common/mid-sigs-NaCl-Ed';
import { JsonKey, keyFromJson, use as keyUse } from '../../lib-common/jwkeys';
import { PKLoginException } from '../../lib-client/user-with-pkl-session';
import { SingleProc } from '../../lib-common/processes/synced';
import { GenerateKey } from '../startup/sign-in';
import { LogError, LogWarning } from '../../lib-client/logging/log-to-file';
import { NetClient } from '../../lib-client/request-utils';
import { startMidSession, authenticateMidSession } from '../../lib-client/mailer-id/login';
import { ServiceLocator } from '../../lib-client/service-locator';
import { IdKeysStorage } from './key-storage';

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

export type SetupManagerStorage = (
	fs: WritableFS, keysToSave?: JsonKey[]
) => Promise<void>;


export class IdManager {

	private signer: mid.MailerIdSigner = (undefined as any);
	private provisioningProc = new SingleProc();

	private constructor(
		private readonly store: IdKeysStorage,
		private readonly makeNet: () => NetClient,
		private readonly midServiceFor: ServiceLocator,
		private address: string,
	) {
		Object.seal(this);
	}

	static async initWithoutStore(
		address: string, resolver: ServiceLocator, makeNet: () => NetClient,
		logError: LogError, logWarning: LogWarning
	): Promise<((midLoginKey: GenerateKey|Uint8Array) => Promise<{
		idManager: IdManager; setupManagerStorage: SetupManagerStorage;
	}|undefined>)| undefined> {
		const {
			store, setupManagerStorage
		} = IdKeysStorage.makeWithoutStorage(logError, logWarning);
		const idManager = new IdManager(
			store, makeNet, resolver, address
		);
		const provisioning = await idManager.startProvisionWithoutSavedKey(
			address
		);
		if (!provisioning) { return; }
		return async (midLoginKey) => {
			const key = ((typeof midLoginKey === 'function') ?
				await midLoginKey(provisioning.keyParams) :
				midLoginKey
			);
			const isDone = await provisioning.complete(key);
			key.fill(0);
			if (!isDone) { return; }
			return {
				idManager,
				setupManagerStorage: (fs, keys) => setupManagerStorage(fs, (keys ? {
					address: idManager.address,
					keys
				} : undefined))
			};
		}
	}

	static async initFromCachedStore(
		address: string, fs: WritableFS,
		resolver: ServiceLocator, makeNet: () => NetClient,
		logError: LogError, logWarning: LogWarning
	): Promise<IdManager|undefined> {
		const store = IdKeysStorage.makeWithStorage(fs, logError, logWarning);
		const idManager = new IdManager(store, makeNet, resolver, address);
		try {
			await idManager.provisionUsingSavedKey();
			return idManager;
		} catch (err) {
			await logError(err, `Can't initialize id manager from local store`);
			return;
		}
	}

	private async startProvisionWithoutSavedKey(
		address: string
	): Promise<CompleteProvisioning|undefined> {
		const midUrl = await this.midServiceFor(address);
		const provisioner = new MailerIdProvisioner(
			address, midUrl, this.makeNet()
		);
		try {
			const provisioning = await provisioner.provisionSigner(undefined);
			const completion = async (
				defaultSKey: Uint8Array
			): Promise<boolean> => {
				try {
					this.signer = await provisioning.complete(() => {
							const dhshared = box.calc_dhshared_key(
								provisioning.serverPKey, defaultSKey
							);
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
			const key = await this.store.getSavedKey();
			if (!key) { throw new Error(
				`No saved MailerId login key can be found`); }
			const skey = keyFromJson(
				key, keyUse.MID_PKLOGIN, box.JWK_ALG_NAME, box.KEY_LENGTH
			);
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
		if (!this.address) {
			throw new Error('Address is not set in id manager');
		}
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
Object.freeze(IdManager.prototype);
Object.freeze(IdManager);


type Service = web3n.mailerid.Service;

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