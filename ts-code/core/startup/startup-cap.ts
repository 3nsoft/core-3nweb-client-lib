/*
 Copyright (C) 2020, 2022, 2024 3NSoft Inc.
 
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

import { ExposedObj, Caller } from "../../ipc-via-protobuf/connector";
import { Deferred, defer } from "../../lib-common/processes/deferred";
import { wrapObservingFunc, wrapReqReplySrvMethod } from "../../core-ipc/json-ipc-wrapping/service-side-wrap";
import { makeObservableFuncCaller, makeReqRepObjCaller } from "../../core-ipc/json-ipc-wrapping/caller-side-wrap";

type SignInService = web3n.startup.SignInService;
type SignUpService = web3n.startup.SignUpService;
type BootEvent = web3n.startup.BootEvent;
type Observer<T> = web3n.Observer<T>;

export function wrapSignInCAP(cap: SignInService): ExposedObj<SignInService> {
	return {
		completeLoginAndLocalSetup: wrapObservingFunc<ProgressValue>((
			obs, pass
		) => {
			cap.completeLoginAndLocalSetup(pass, p => obs.next?.({ p }))
			.then(decrResult => {
				obs.next?.({ p: 100, decrResult });
				obs.complete?.();
			}, err => obs.error?.(err));
			return noop;
		}),
		getUsersOnDisk: wrapReqReplySrvMethod(cap, 'getUsersOnDisk'),
		startLoginToRemoteStorage: wrapReqReplySrvMethod(
			cap, 'startLoginToRemoteStorage'
		),
		useExistingStorage: wrapObservingFunc<ProgressValue>((
			obs, addr, pass
		) => {
			cap.useExistingStorage(addr, pass, p => obs.next?.({ p }))
			.then(decrResult => {
				obs.next?.({ p: 100, decrResult });
				obs.complete?.();
			}, err => obs.error?.(err));
			return noop;
		}),
		watchBoot: wrapObservingFunc<BootEvent>(cap.watchBoot)
	};
}

export function makeSignInCaller(
	caller: Caller, objPath: string[]
): SignInService {
	return {
		completeLoginAndLocalSetup: (() => {
			const obsFn = makeObservableFuncCaller<ProgressValue>(
				caller, objPath.concat('completeLoginAndLocalSetup')
			);
			return (pass, progressCB) => {
				const { obs, promise } = completionAndObsOfProgress(progressCB);
				obsFn(obs, pass);
				return promise;
			}
		})(),
		getUsersOnDisk: callSignIn(caller, objPath, 'getUsersOnDisk'),
		startLoginToRemoteStorage: callSignIn(
			caller, objPath, 'startLoginToRemoteStorage'
		),
		useExistingStorage: (() => {
			const obsFn = makeObservableFuncCaller<ProgressValue>(
				caller, objPath.concat('useExistingStorage')
			);
			return (addr, pass, progressCB) => {
				const { obs, promise } = completionAndObsOfProgress(progressCB);
				obsFn(obs, addr, pass);
				return promise;
			}
		})(),
		watchBoot: makeObservableFuncCaller<BootEvent>(caller, objPath.concat('watchBoot'))
	};
}

function callSignIn<M extends keyof SignInService>(
	caller: Caller, objPath: string[], method: M
): SignInService[M] {
	return makeReqRepObjCaller<SignInService, M>(caller, objPath, method);
}

interface ProgressValue {
	p: number;
	decrResult?: boolean;
}

function completionAndObsOfProgress(progressCB: (p: number) => void): {
	obs: Observer<ProgressValue>;
	promise: Promise<boolean>;
} {
	let completion: Deferred<boolean>|undefined = defer();
	// let doneRes: boolean|undefined;
	const obs: Observer<ProgressValue> = {
		next: ({ p, decrResult }) => {
			if (typeof decrResult === 'boolean') {
				completion?.resolve(decrResult);
				completion = undefined;
			} else {
				progressCB(p);
			}
		},
		complete: () => completion?.reject(new Error()),
		error: err => completion?.reject(err)
	};
	return {
		obs,
		promise: completion.promise
	};
}

export function wrapSignUpCAP(cap: SignUpService): ExposedObj<SignUpService> {
	return {
		setSignUpServer: wrapReqReplySrvMethod(cap, 'setSignUpServer'),
		getAvailableDomains: wrapReqReplySrvMethod(cap, 'getAvailableDomains'),
		getAvailableAddresses: wrapReqReplySrvMethod(
			cap, 'getAvailableAddresses'
		),
		addUser: wrapReqReplySrvMethod(cap, 'addUser'),
		createUserParams: wrapObservingFunc<number>((obs, pass) => {
			cap.createUserParams(pass, p => obs.next?.(p))
			.then(() => obs.complete?.(), err => obs.error?.(err));
			return noop;
		}),
		isActivated: wrapReqReplySrvMethod(cap, 'isActivated'),
		watchBoot: wrapObservingFunc<BootEvent>(cap.watchBoot)
	};
}

function noop() {}

function callSignUp<M extends keyof SignUpService>(
	caller: Caller, objPath: string[], method: M
): SignUpService[M] {
	return makeReqRepObjCaller<SignUpService, M>(caller, objPath, method);
}

export function makeSignUpCaller(
	caller: Caller, objPath: string[]
): SignUpService {
	return {
		setSignUpServer: callSignUp(caller, objPath, 'setSignUpServer'),
		getAvailableDomains: callSignUp(caller, objPath, 'getAvailableDomains'),
		getAvailableAddresses: callSignUp(
			caller, objPath, 'getAvailableAddresses'
		),
		addUser: callSignUp(caller, objPath, 'addUser'),
		createUserParams: (() => {
			const obsFn = makeObservableFuncCaller<number>(
				caller, objPath.concat('createUserParams')
			);
			return (pass, progressCB) => {
				const completion = defer<void>();
				obsFn({
					next: p => progressCB(p),
					complete: () => completion.resolve(),
					error: err => completion.reject(err)
				}, pass);
				return completion.promise;
			};
		})(),
		isActivated: callSignUp(caller, objPath, 'isActivated'),
		watchBoot: makeObservableFuncCaller<BootEvent>(caller, objPath.concat('watchBoot'))
	};
}


Object.freeze(exports);