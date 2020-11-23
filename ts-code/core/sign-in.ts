/*
 Copyright (C) 2015 - 2018, 2020 3NSoft Inc.

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
import { ScryptGenParams, deriveMidKeyPair, deriveStorageSKey }
	from '../lib-client/key-derivation';
import { GetUsersOnDisk } from './app-files';
import { Cryptor } from '../lib-client/cryptor/cryptor';
import { Subject } from 'rxjs';
import { LogError } from '../lib-client/logging/log-to-file';
import { errWithCause } from '../lib-common/exceptions/error';

export type GenerateKey  =
	(derivParams: ScryptGenParams) => Promise<Uint8Array>;

export type StartInitWithoutCache =
	(address: string) => Promise<CompleteInitWithoutCache|undefined>;
export type CompleteInitWithoutCache =
	(midLoginKey: GenerateKey, storageKey: GenerateKey) =>
	Promise<IdManager|undefined>;

export type InitWithCache =
	(address: string, storageKey: GenerateKey) =>
	Promise<IdManager|undefined|InitTwoWithCache>;
export type InitTwoWithCache =
	(midLoginKey: GenerateKey) => Promise<IdManager|undefined>;

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
			'startLoginToRemoteStorage'] = async (address) => {
		try {
			this.completeInitWithoutCache = await this.startInitWithoutCache(
				address);
			return !!this.completeInitWithoutCache;
		} catch(err) {
			await this.log(err, 'Failing to initialize without cache');
			throw err;
		}
	};

	private completeLoginAndLocalSetup: SignInService[
			'completeLoginAndLocalSetup'] = async (pass, progressCB) => {
		if (!this.completeInitWithoutCache) { throw new Error(
			`Call method startLoginToRemoteStorage() before calling this.`); }
		try {
			const midKeyProgressCB = makeKeyGenProgressCB(0, 50, progressCB);
			const midKeyGen = async params => (await deriveMidKeyPair(
				this.cryptor, pass, params, midKeyProgressCB)).skey;
			const storeKeyProgressCB = makeKeyGenProgressCB(51, 100, progressCB);
			const storeKeyGen = params => deriveStorageSKey(
				this.cryptor, pass, params, storeKeyProgressCB);
			const idManager = await this.completeInitWithoutCache(
				midKeyGen, storeKeyGen);

			if (!idManager) { return false; }

			this.doneBroadcast.next(idManager);
			return true;
		} catch(err) {
			await this.log(err, 'Failing to initialize from a state without cache');
			throw err;
		}
	};

	private doneBroadcast = new Subject<IdManager>();

	existingUser$ = this.doneBroadcast.asObservable();

	private useExistingStorage: SignInService[
			'useExistingStorage'] = async (user, pass, progressCB) => {
		try {
			const storeKeyProgressCB = makeKeyGenProgressCB(0, 99, progressCB);
			const storeKeyGen = params => deriveStorageSKey(
				this.cryptor, pass, params, storeKeyProgressCB);
			const res = await this.initWithCache(user, storeKeyGen);

			if (!res) { return false; }

			if (typeof res === 'object') {
				this.doneBroadcast.next(res);
				return true;
			}

			progressCB(49);
			const midKeyProgressCB = makeKeyGenProgressCB(50, 99, progressCB);
			const midKeyGen = async params => (await deriveMidKeyPair(
				this.cryptor, pass, params, midKeyProgressCB)).skey;
			const idManager = await res(midKeyGen);

			if (!idManager) { return false; }

			this.doneBroadcast.next(idManager);
			return true;
		} catch(err) {
			await this.log(err, 'Failing to start in a state with cache');
			throw err;
		}
	};

	private async log(err: any, msg: string): Promise<void> {
		await this.logError(errWithCause(err, msg));
	}

}
Object.freeze(SignIn.prototype);
Object.freeze(SignIn);
	
export function makeKeyGenProgressCB(progressStart: number, progressEnd: number,
		progressCB: (progress: number) => void) {
	if (progressStart >= progressEnd) { throw new Error(`Invalid progress parameters: start=${progressStart}, end=${progressEnd}.`); }
	let currentProgress = 0;
	let totalProgress = progressStart;
	const progressRange = progressEnd - progressStart;
	return (p: number): void => {
		if (currentProgress >= p) { return; }
		currentProgress = p;
		const newProgress = Math.floor(p/100*progressRange + progressStart);
		if (totalProgress >= newProgress) { return; }
		totalProgress = newProgress;
		progressCB(totalProgress)
	};
}


Object.freeze(exports);