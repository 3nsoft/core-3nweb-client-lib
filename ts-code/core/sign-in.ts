/*
 Copyright (C) 2015 - 2018, 2020, 2022 3NSoft Inc.

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

import { IdManager } from './id-manager';
import { ScryptGenParams, deriveMidKeyPair, deriveStorageSKey } from '../lib-client/key-derivation';
import { GetUsersOnDisk } from './app-files';
import { Cryptor } from '../lib-client/cryptor/cryptor';
import { Subject } from 'rxjs';
import { LogError } from '../lib-client/logging/log-to-file';
import { ErrorWithCause, errWithCause } from '../lib-common/exceptions/error';

export type GenerateKey  =
	(derivParams: ScryptGenParams) => Promise<Uint8Array>;

export type StartInitWithoutCache = (
	address: string
) => Promise<CompleteInitWithoutCache|undefined>;
export type CompleteInitWithoutCache = (
	midLoginKey: GenerateKey, storageKey: GenerateKey
) => Promise<IdManager|undefined>;

export type InitWithCache = (
	address: string, storageKey: GenerateKey
) => Promise<IdManager|undefined>;

type SignInService = web3n.startup.SignInService;

export class SignIn {

	private completeInitWithoutCache: CompleteInitWithoutCache|undefined = undefined;

	constructor(
		private cryptor: Cryptor,
		private startInitWithoutCache: StartInitWithoutCache,
		private initWithCache: InitWithCache,
		private getUsersOnDisk: GetUsersOnDisk,
		private readonly logError: LogError
	) {
		Object.seal(this);
	}

	exposedService(): SignInService {
		const service: SignInService = {
			completeLoginAndLocalSetup: this.completeLoginAndLocalSetup,
			getUsersOnDisk: this.getUsersOnDisk,
			startLoginToRemoteStorage: this.startLoginToRemoteStorage,
			useExistingStorage: this.useExistingStorage
		};
		return Object.freeze(service);
	}

	private startLoginToRemoteStorage: SignInService[
		'startLoginToRemoteStorage'
	] = async (address) => {
		try {
			this.completeInitWithoutCache = await this.startInitWithoutCache(
				address);
			return !!this.completeInitWithoutCache;
		} catch(err) {
			throw await this.logAndWrap(err,
				'Fail to start login to remote storage');
		}
	};

	private completeLoginAndLocalSetup: SignInService[
		'completeLoginAndLocalSetup'
	] = async (pass, progressCB) => {
		if (!this.completeInitWithoutCache) { throw new Error(
			`Call method startLoginToRemoteStorage() before calling this.`); }
		try {
			const midKeyProgressCB = makeKeyGenProgressCB(0, 50, progressCB);
			const midKeyGen = async (params: ScryptGenParams) => (
				await deriveMidKeyPair(this.cryptor, pass, params, midKeyProgressCB)
			).skey;
			const storeKeyProgressCB = makeKeyGenProgressCB(51, 100, progressCB);
			const storeKeyGen = (params: ScryptGenParams) => deriveStorageSKey(
				this.cryptor, pass, params, storeKeyProgressCB);
			const idManager = await this.completeInitWithoutCache(
				midKeyGen, storeKeyGen);

			if (!idManager) { return false; }

			this.doneBroadcast.next(idManager);
			return true;
		} catch(err) {
			throw await this.logAndWrap(err,
				'Fail to initialize from a state without cache');
		}
	};

	private readonly doneBroadcast = new Subject<IdManager>();

	public readonly existingUser$ = this.doneBroadcast.asObservable();

	private useExistingStorage: SignInService['useExistingStorage'] = async (
		user, pass, progressCB
	) => {
		try {
			const storeKeyProgressCB = makeKeyGenProgressCB(0, 99, progressCB);
			const storeKeyGen = params => deriveStorageSKey(
				this.cryptor, pass, params, storeKeyProgressCB
			);
			const idManager = await this.initWithCache(user, storeKeyGen);
			if (idManager) {
				this.doneBroadcast.next(idManager);
				return true;
			} else {
				return false;
			}
		} catch(err) {
			throw await this.logAndWrap(err,
				'Failing to start in a state with cache');
		}
	};

	private async logAndWrap(err: any, msg: string): Promise<ErrorWithCause> {
		await this.logError(err, msg);
		return errWithCause(err, msg);
	}

}
Object.freeze(SignIn.prototype);
Object.freeze(SignIn);


export type ProgressCB = (p: number) => void;

export function makeKeyGenProgressCB(
	progressStart: number, progressEnd: number, progressCB: ProgressCB
): ProgressCB {
	if (progressStart >= progressEnd) { throw new Error(`Invalid progress parameters: start=${progressStart}, end=${progressEnd}.`); }
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