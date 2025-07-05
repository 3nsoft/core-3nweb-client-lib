/*
 Copyright (C) 2015 - 2018, 2020, 2022, 2025 3NSoft Inc.

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

import { ScryptGenParams, deriveMidKeyPair, deriveStorageSKey } from '../../lib-client/key-derivation';
import type { GetUsersOnDisk } from '../app-files';
import { Cryptor } from '../../lib-client/cryptor/cryptor';
import { LogError } from '../../lib-client/logging/log-to-file';
import { ErrorWithCause, errWithCause } from '../../lib-common/exceptions/error';

export type GenerateKey  = (derivParams: ScryptGenParams) => Promise<Uint8Array>;
export type StartInitWithoutCache = (address: string) => Promise<CompleteInitWithoutCache|undefined>;
export type CompleteInitWithoutCache = (midLoginKey: GenerateKey, storageKey: GenerateKey) => Promise<boolean>;

export type InitWithCache = (
	address: string, storageKey: GenerateKey
) => Promise<boolean>;

type SignInService = web3n.startup.SignInService;
type ProgressCB = web3n.startup.ProgressCB;

export class SignIn {

	private completeInitWithoutCache: CompleteInitWithoutCache|undefined = undefined;

	constructor(
		private cryptor: Cryptor,
		private startInitWithoutCache: StartInitWithoutCache,
		private initWithCache: InitWithCache,
		private getUsersOnDisk: GetUsersOnDisk,
		private readonly watchBoot: SignInService['watchBoot'],
		private readonly logError: LogError
	) {
		Object.seal(this);
	}

	exposedService(): SignInService {
		const service: SignInService = {
			completeLoginAndLocalSetup: this.completeLoginAndLocalSetup.bind(this),
			getUsersOnDisk: this.getUsersOnDisk,
			startLoginToRemoteStorage: this.startLoginToRemoteStorage.bind(this),
			useExistingStorage: this.useExistingStorage.bind(this),
			watchBoot: this.watchBoot
		};
		return Object.freeze(service);
	}

	private async startLoginToRemoteStorage(address: string): Promise<boolean> {
		try {
			this.completeInitWithoutCache = await this.startInitWithoutCache(address);
			return !!this.completeInitWithoutCache;
		} catch(err) {
			throw await this.logAndWrap(
				err, 'Fail to start login to remote storage'
			);
		}
	}

	private async completeLoginAndLocalSetup(
		pass: string, progressCB: ProgressCB
	): Promise<boolean> {
		if (!this.completeInitWithoutCache) {
			throw new Error(`Call method startLoginToRemoteStorage() before calling this.`);
		}
		try {
			const midKeyProgressCB = makeKeyGenProgressCB(0, 50, progressCB);
			const midKeyGen: GenerateKey = async params => (
				await deriveMidKeyPair(this.cryptor, pass, params, midKeyProgressCB)
			).skey;
			const storeKeyProgressCB = makeKeyGenProgressCB(51, 100, progressCB);
			const storeKeyGen: GenerateKey = params => deriveStorageSKey(
				this.cryptor, pass, params, storeKeyProgressCB
			);
			return await this.completeInitWithoutCache(
				midKeyGen, storeKeyGen
			);
		} catch(err) {
			throw await this.logAndWrap(
				err, 'Fail to initialize from a state without cache'
			);
		}
	}

	private async useExistingStorage(
		user: string, pass: string, progressCB: ProgressCB
	): Promise<boolean> {
		try {
			const storeKeyProgressCB = makeKeyGenProgressCB(0, 99, progressCB);
			const storeKeyGen: GenerateKey = params => deriveStorageSKey(
				this.cryptor, pass, params, storeKeyProgressCB
			);
			return await this.initWithCache(user, storeKeyGen);
		} catch(err) {
			throw await this.logAndWrap(
				err, 'Failing to start in a state with cache'
			);
		}
	}

	private async logAndWrap(err: any, msg: string): Promise<ErrorWithCause> {
		await this.logError(err, msg);
		return errWithCause(err, msg);
	}

}
Object.freeze(SignIn.prototype);
Object.freeze(SignIn);


export function makeKeyGenProgressCB(
	progressStart: number, progressEnd: number, progressCB: ProgressCB
): ProgressCB {
	if (progressStart >= progressEnd) {
		throw new Error(`Invalid progress parameters: start=${progressStart}, end=${progressEnd}.`);
	}
	let currentProgress = 0;
	let totalProgress = progressStart;
	const progressRange = progressEnd - progressStart;
	return p => {
		if (currentProgress >= p) { return; }
		currentProgress = p;
		const newProgress = Math.floor(p/100*progressRange + progressStart);
		if (totalProgress >= newProgress) { return; }
		totalProgress = newProgress;
		progressCB(totalProgress)
	};
}


Object.freeze(exports);