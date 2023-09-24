/*
 Copyright (C) 2020, 2022 3NSoft Inc.
 
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

import { ExposedObj, ExposedFn, EnvelopeBody, Caller } from "../../ipc-via-protobuf/connector";
import { strArrValType, boolValType, fixArray, toVal, Value, valOfOpt, toOptVal, methodPathFor } from "../../ipc-via-protobuf/protobuf-msg";
import { Subject } from "rxjs";
import { map } from "rxjs/operators";
import { defer } from "../../lib-common/processes/deferred";
import { ProtoType } from '../../lib-client/protobuf-type';
import { startup as pb } from "../../protos/startup.proto";

type SignInService = web3n.startup.SignInService;
type SignUpService = web3n.startup.SignUpService;

export function wrapSignInCAP(cap: SignInService): ExposedObj<SignInService> {
	return {
		completeLoginAndLocalSetup: completeLoginAndLocalSetup.wrapService(
			cap.completeLoginAndLocalSetup),
		getUsersOnDisk: getUsersOnDisk.wrapService(cap.getUsersOnDisk),
		startLoginToRemoteStorage: startLoginToRemoteStorage.wrapService(
			cap.startLoginToRemoteStorage),
		useExistingStorage: useExistingStorage.wrapService(cap.useExistingStorage)
	};
}

export function makeSignInCaller(
	caller: Caller, objPath: string[]
): SignInService {
	return {
		completeLoginAndLocalSetup: completeLoginAndLocalSetup.makeCaller(
			caller, objPath),
		getUsersOnDisk: getUsersOnDisk.makeCaller(caller, objPath),
		startLoginToRemoteStorage: startLoginToRemoteStorage.makeCaller(
			caller, objPath),
		useExistingStorage: useExistingStorage.makeCaller(caller, objPath)
	};
}

export function wrapSignUpCAP(cap: SignUpService): ExposedObj<SignUpService> {
	return {
		setSignUpServer: setSignUpServer.wrapService(cap.setSignUpServer),
		getAvailableDomains: getAvailableDomains.wrapService(
			cap.getAvailableDomains),
		getAvailableAddresses: getAvailableAddresses.wrapService(
			cap.getAvailableAddresses),
		addUser: addUser.wrapService(cap.addUser),
		createUserParams: createUserParams.wrapService(cap.createUserParams),
		isActivated: isActivated.wrapService(cap.isActivated)
	};
}

export function makeSignUpCaller(
	caller: Caller, objPath: string[]
): SignUpService {
	return {
		setSignUpServer: setSignUpServer.makeCaller(caller, objPath),
		getAvailableDomains: getAvailableDomains.makeCaller(caller, objPath),
		getAvailableAddresses: getAvailableAddresses.makeCaller(
			caller, objPath),
		addUser: addUser.makeCaller(caller, objPath),
		createUserParams: createUserParams.makeCaller(caller, objPath),
		isActivated: isActivated.makeCaller(caller, objPath)
	};
}


namespace setSignUpServer {

	interface Request {
		serviceUrl: string;
	}

	const requestType = ProtoType.for<Request>(pb.SetSignUpServerRequestBody);

	export function wrapService(
		fn: SignUpService['setSignUpServer']
	): ExposedFn {
		return buf => {
			const { serviceUrl } = requestType.unpack(buf);
			const promise = fn(serviceUrl);
			return { promise };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): SignUpService['setSignUpServer'] {
		const path = methodPathFor<SignUpService>(objPath, 'setSignUpServer');
		return serviceUrl => caller
		.startPromiseCall(
			path, requestType.pack({ serviceUrl })
		) as Promise<void>;
	}

}
Object.freeze(getAvailableAddresses);


namespace getAvailableDomains {

	interface Request {
		token?: Value<string>;
	}

	const requestType = ProtoType.for<Request>(
		pb.GetAvailableDomainsRequestBody);

	export function wrapService(
		fn: SignUpService['getAvailableDomains']
	): ExposedFn {
		return buf => {
			const { token } = requestType.unpack(buf);
			const promise = fn(valOfOpt(token))
			.then(domains => strArrValType.pack({ values: domains }));
			return { promise };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): SignUpService['getAvailableDomains'] {
		const path = methodPathFor<SignUpService>(objPath, 'getAvailableDomains');
		return token => caller
		.startPromiseCall(path, requestType.pack(
			{ token: toOptVal(token) }))
		.then(buf => fixArray(strArrValType.unpack(buf).values));
	}

}


namespace getAvailableAddresses {

	interface Request {
		name: string;
		token?: Value<string>;
	}

	const requestType = ProtoType.for<Request>(
		pb.GetAvailableAddressesRequestBody);

	export function wrapService(
		fn: SignUpService['getAvailableAddresses']
	): ExposedFn {
		return buf => {
			const { name, token } = requestType.unpack(buf);
			const promise = fn(name, valOfOpt(token))
			.then(addresses => strArrValType.pack({ values: addresses }));
			return { promise };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): SignUpService['getAvailableAddresses'] {
		const path = methodPathFor<SignUpService>(objPath, 'getAvailableAddresses');
		return (name, token) => caller
		.startPromiseCall(path, requestType.pack(
			{ name, token: toOptVal(token) }))
		.then(buf => fixArray(strArrValType.unpack(buf).values));
	}

}
Object.freeze(getAvailableAddresses);


namespace addUser {

	interface Request {
		userId: string;
		token?: Value<string>;
	}

	const requestType = ProtoType.for<Request>(pb.AddUserRequestBody);

	export function wrapService(fn: SignUpService['addUser']): ExposedFn {
		return buf => {
			const { userId, token } = requestType.unpack(buf);
			const promise = fn(userId, valOfOpt(token))
			.then(wasAdded => boolValType.pack(toVal(wasAdded)));
			return { promise };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): SignUpService['addUser'] {
		const path = methodPathFor<SignUpService>(objPath, 'addUser');
		return (userId, token) => caller
		.startPromiseCall(path, requestType.pack(
			{ userId, token: toOptVal(token) }))
		.then(buf => boolValType.unpack(buf).value);
	}

}
Object.freeze(addUser);


namespace isActivated {

	interface Request {
		userId: string;
	}

	const requestType = ProtoType.for<Request>(pb.IsActivatedRequestBody);

	export function wrapService(fn: SignUpService['isActivated']): ExposedFn {
		return buf => {
			const { userId } = requestType.unpack(buf);
			const promise = fn(userId)
			.then(isActivated => boolValType.pack(toVal(isActivated)));
			return { promise };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): SignUpService['isActivated'] {
		const path = methodPathFor<SignUpService>(objPath, 'isActivated');
		return userId => caller
		.startPromiseCall(path, requestType.pack({ userId }))
		.then(buf => boolValType.unpack(buf).value);
	}

}
Object.freeze(isActivated);


interface PassOnlyRequest {
	pass: string;
}
const reqWithPassType = ProtoType.for<PassOnlyRequest>(pb.PassOnlyRequestBody);


namespace createUserParams {

	export function wrapService(
		fn: SignUpService['createUserParams']
	): ExposedFn {
		return buf => {
			const { pass } = reqWithPassType.unpack(buf);
			const s = new Subject<ProgressValue>();
			const obs = s.asObservable().pipe(
				map(v => progressValueType.pack(v))
			);
			fn(pass, p => s.next({ p }))
			.then(() => s.complete(), err => s.error(err));
			return { obs };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): SignUpService['createUserParams'] {
		const path = methodPathFor<SignUpService>(objPath, 'createUserParams');
		return (pass, progressCB) => {
			const s = new Subject<EnvelopeBody>();
			const completion = defer<void>();
			s.subscribe({
				next: buf => {
					const { p } = progressValueType.unpack(buf);
					progressCB(p)
				},
				complete: () => completion.resolve(),
				error: err => completion.reject(err)
			});
			caller.startObservableCall(path, reqWithPassType.pack({ pass }), s);
			return completion.promise;
		}
	}

}
Object.freeze(createUserParams);


namespace getUsersOnDisk {

	export function wrapService(fn: SignInService['getUsersOnDisk']): ExposedFn {
		return () => {
			const promise = fn()
			.then(users => strArrValType.pack({ values: users }));
			return { promise };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): SignInService['getUsersOnDisk'] {
		const path = methodPathFor<SignInService>(objPath, 'getUsersOnDisk');
		return () => caller
		.startPromiseCall(path, undefined)
		.then(buf => fixArray(strArrValType.unpack(buf).values));
	}

}
Object.freeze(getUsersOnDisk);


namespace startLoginToRemoteStorage {

	interface Request {
		address: string;
	}

	const requestType = ProtoType.for<Request>(
		pb.StartLoginToRemoteStorageRequestBody);

	export function wrapService(
		fn: SignInService['startLoginToRemoteStorage']
	): ExposedFn {
		return buf => {
			const { address } = requestType.unpack(buf);
			const promise = fn(address)
			.then(started => boolValType.pack(toVal(started)));
			return { promise };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): SignInService['startLoginToRemoteStorage'] {
		const path = methodPathFor<SignInService>(
			objPath, 'startLoginToRemoteStorage'
		);
		return address => caller
		.startPromiseCall(path, requestType.pack({ address }))
		.then(buf => boolValType.unpack(buf).value);
	}

}
Object.freeze(startLoginToRemoteStorage);


interface ProgressValue {
	p: number;
	decrResult?: Value<boolean>;
}
const progressValueType = ProtoType.for<ProgressValue>(pb.ProgressValue);


namespace completeLoginAndLocalSetup {

	export function wrapService(
		fn: SignInService['completeLoginAndLocalSetup']
	): ExposedFn {
		return buf => {
			const { pass } = reqWithPassType.unpack(buf);
			const s = new Subject<ProgressValue>();
			const obs = s.asObservable().pipe(
				map(v => progressValueType.pack(v))
			);
			fn(pass, p => s.next({ p }))
			.then(
				ok => {
					s.next({ decrResult: toVal(ok), p: 100 });
					s.complete();
				},
				err => s.error(err));
			return { obs };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): SignInService['completeLoginAndLocalSetup'] {
		const path = methodPathFor<SignInService>(
			objPath, 'completeLoginAndLocalSetup'
		);
		return (pass, progressCB) => {
			const s = new Subject<EnvelopeBody>();
			const completion = defer<boolean>();
			s.subscribe({
				next: buf => {
					const { decrResult, p } = progressValueType.unpack(buf);
					if (typeof valOfOpt(decrResult) === 'boolean') {
						completion.resolve(valOfOpt(decrResult));
					} else {
						progressCB(p);
					}
				},
				complete: () => completion.resolve(),
				error: err => completion.reject(err)
			});
			caller.startObservableCall(path, reqWithPassType.pack({ pass }), s);
			return completion.promise;
		}
	}

}
Object.freeze(completeLoginAndLocalSetup);


namespace useExistingStorage {

	interface Request {
		address: string;
		pass: string;
	}

	const requestType = ProtoType.for<Request>(pb.UseExistingStorageRequestBody);

	export function wrapService(
		fn: SignInService['useExistingStorage']
	): ExposedFn {
		return buf => {
			const { pass, address } = requestType.unpack(buf);
			const s = new Subject<ProgressValue>();
			const obs = s.asObservable().pipe(
				map(v => progressValueType.pack(v))
			);
			fn(address, pass, p => s.next({ p }))
			.then(
				ok => {
					s.next({ decrResult: toVal(ok), p: 100 });
					s.complete();
				},
				err => s.error(err));
			return { obs };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): SignInService['useExistingStorage'] {
		const path = methodPathFor<SignInService>(objPath, 'useExistingStorage');
		return (address, pass, progressCB) => {
			const s = new Subject<EnvelopeBody>();
			const completion = defer<boolean>();
			s.subscribe({
				next: buf => {
					const { decrResult, p } = progressValueType.unpack(buf);
					if (typeof valOfOpt(decrResult) === 'boolean') {
						completion.resolve(valOfOpt(decrResult));
					} else {
						progressCB(p);
					}
				},
				complete: () => completion.resolve(),
				error: err => completion.reject(err)
			});
			caller.startObservableCall(
				path, requestType.pack({ address, pass }), s);
			return completion.promise;
		}
	}

}
Object.freeze(useExistingStorage);


Object.freeze(exports);