/*
 Copyright (C) 2015 - 2020, 2022 - 2023, 2025 3NSoft Inc.

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

import { checkAvailableAddressesForName, addUser, checkAvailableDomains } from '../../lib-client/3nweb-signup';
import { NetClient } from '../../lib-client/request-utils';
import { parse as parseUrl } from 'url';
import { use as keyUse, keyToJson } from '../../lib-common/jwkeys';
import { base64 } from '../../lib-common/buffer-utils';
import { areAddressesEqual } from '../../lib-common/canonical-address';
import * as keyDeriv from '../../lib-client/key-derivation';
import type { GetUsersOnDisk } from '../app-files';
import * as random from '../../lib-common/random-node';
import { Cryptor } from '../../lib-client/cryptor/cryptor';
import { box } from 'ecma-nacl';
import { makeKeyGenProgressCB } from './sign-in';
import { LogError } from '../../lib-client/logging/log-to-file';
import { UserMidParams, UserStorageParams } from '../../lib-common/user-admin-api/signup';
import { ErrorWithCause, errWithCause } from '../../lib-common/exceptions/error';

type JsonKey = web3n.keys.JsonKey;
type ProgressCB = web3n.startup.ProgressCB;

export interface ScryptGenParams {
	logN: number;
	r: number;
	p: number;
	salt: string;
}

/**
 * With these parameters scrypt shall use memory around:
 * (2^7)*r*N === (2^7)*(2^3)*(2^17) === 2^27 === (2^7)*(2^20) === 128MB
 */
const defaultDerivParams = {
	logN: 17,
	r: 3,
	p: 1
};
Object.freeze(defaultDerivParams);

const SALT_LEN = 32;
const KEY_ID_LEN = 10;

async function makeLabeledMidLoginKey(
	cryptor: Cryptor
): Promise<{ skey: JsonKey; pkey: JsonKey }> {
	const sk = await random.bytes(box.KEY_LENGTH);
	const skey = keyToJson({
		k: sk,
		alg: box.JWK_ALG_NAME,
		use: keyUse.MID_PKLOGIN,
		kid: await random.stringOfB64Chars(KEY_ID_LEN)
	});
	const pkey = keyToJson({
		k: await cryptor.box.generate_pubkey(sk),
		alg: skey.alg,
		use: skey.use,
		kid: skey.kid
	});
	return { skey, pkey };
}

type SignUpService = web3n.startup.SignUpService;


export class SignUp {

	private mid: {
		defaultSKey: Uint8Array;
		labeledSKey: JsonKey;
		params: UserMidParams;
	} = (undefined as any);
	private store: {
		skey: Uint8Array;
		params: UserStorageParams;
	} = (undefined as any);
	private serviceURL: string = (undefined as any);

	private netLazyInit: NetClient|undefined = undefined;
	private get net(): NetClient {
		if (!this.netLazyInit) {
			this.netLazyInit = this.makeNet();
		}
		return this.netLazyInit;
	}

	constructor(
		serviceURL: string,
		private cryptor: Cryptor,
		private makeNet: () => NetClient,
		private getUsersOnDisk: GetUsersOnDisk,
		private initForNewUser: (u: CreatedUser) => Promise<void>,
		private readonly watchBoot: SignUpService['watchBoot'],
		private readonly logError: LogError
	) {
		this.setServiceURL(serviceURL);
		Object.seal(this);
	}

	private async setServiceURL(serviceURL: string): Promise<void> {
		const url = parseUrl(serviceURL);
		if (url.protocol !== 'https:') {
			throw new Error("Url protocol must be https.");
		}
		this.serviceURL = serviceURL;
		if (!this.serviceURL.endsWith('/')) {
			this.serviceURL += '/';
		}
	}

	private async getAvailableDomains(
		signupToken: string|undefined
	): Promise<string[]> {
		return await checkAvailableDomains(
			this.net, this.serviceURL, signupToken
		);
	}

	private async getAvailableAddresses(
		name: string, signupToken: string|undefined
	): Promise<string[]> {
		return await checkAvailableAddressesForName(
			this.net, this.serviceURL, name, signupToken
		);
	}

	exposedService(): SignUpService {
		const service: SignUpService = {
			setSignUpServer: this.setServiceURL.bind(this),
			getAvailableDomains: this.getAvailableDomains.bind(this),
			addUser: this.addUser.bind(this),
			createUserParams: this.createUserParams.bind(this),
			getAvailableAddresses: this.getAvailableAddresses.bind(this),
			isActivated: () => { throw new Error(`Not implemented, yet`); },
			watchBoot: this.watchBoot
		};
		return Object.freeze(service);
	}

	private async createUserParams(
		pass: string, progressCB: ProgressCB
	): Promise<void> {
		await this.genMidParams(pass, 0, 50, progressCB);
		await this.genStorageParams(pass, 51, 100, progressCB);
	}

	private async genStorageParams(
		pass: string, progressStart: number, progressEnd: number,
		originalProgressCB: ProgressCB
	): Promise<void> {
		const derivParams: keyDeriv.ScryptGenParams = {
			logN: defaultDerivParams.logN,
			r: defaultDerivParams.r,
			p: defaultDerivParams.p,
			salt: base64.pack(await random.bytes(SALT_LEN))
		};
		const progressCB = makeKeyGenProgressCB(
			progressStart, progressEnd, originalProgressCB
		);
		const skey = await keyDeriv.deriveStorageSKey(this.cryptor,
			pass, derivParams, progressCB
		);
		this.store = {
			skey: skey,
			params: {
				kdParams: derivParams
			}
		};
	}

	private async genMidParams(
		pass: string, progressStart: number, progressEnd: number,
		originalProgressCB: ProgressCB
	): Promise<void> {
		const derivParams: keyDeriv.ScryptGenParams = {
			logN: defaultDerivParams.logN,
			r: defaultDerivParams.r,
			p: defaultDerivParams.p,
			salt: base64.pack(await random.bytes(SALT_LEN))
		}
		const progressCB = makeKeyGenProgressCB(
			progressStart, progressEnd, originalProgressCB
		);
		const defaultPair = await keyDeriv.deriveMidKeyPair(
			this.cryptor, pass, derivParams, progressCB, keyUse.MID_PKLOGIN, '_'
		);
		const labeledKey = await makeLabeledMidLoginKey(this.cryptor);
		this.mid = {
			defaultSKey: defaultPair.skey,
			labeledSKey: labeledKey.skey,
			params: {
				defaultPKey: {
					pkey: defaultPair.pkey,
					kdParams: derivParams
				},
				otherPKeys: [ labeledKey.pkey ]
			}
		};
	}

	private async addUser(
		address: string, signupToken: string|undefined
	): Promise<boolean> {
		for (const user of await this.getUsersOnDisk()) {
			if (areAddressesEqual(address, user)) {
				throw new Error(`Account ${user} already exists on a disk.`);
			}
		}
		const accountCreated = await addUser(this.net, this.serviceURL, {
			userId: address,
			mailerId: this.mid.params,
			storage: this.store.params,
			signupToken
		}).catch (async err => {
			throw await this.logAndWrap(
				err, `Failed to create user account ${address}.`
			);
		});
		if (!accountCreated) { return false; }
		this.initForNewUser({
			address,
			midSKey: {
				default: this.mid.defaultSKey,
				labeled: this.mid.labeledSKey
			},
			storeSKey: this.store.skey,
			storeParams: this.store.params.kdParams
		});
		this.forgetKeys();
		return true;
	}

	private async logAndWrap(err: any, msg: string): Promise<ErrorWithCause> {
		await this.logError(err, msg);
		return errWithCause(err, msg);
	}

	private forgetKeys(): void {
		this.store = (undefined as any);
		this.mid = (undefined as any);
	}

}
Object.freeze(SignUp.prototype);
Object.freeze(SignUp);


export interface CreatedUser {
	address: string;
	midSKey: { default: Uint8Array; labeled: JsonKey; };
	storeSKey: Uint8Array;
	storeParams: keyDeriv.ScryptGenParams;
}

Object.freeze(exports);