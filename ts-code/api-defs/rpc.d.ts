/*
 Copyright (C) 2016 - 2018 3NSoft Inc.

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


declare namespace web3n.rpc {

	interface RPC {

		getRemote<TRemote>(name: string): TRemote|undefined;

		getRemoteEventually<TRemote>(name: string): Promise<TRemote>;

		registerLocal<T>(local: T,
			params: ObjectRegistrationParams<T>|FuncRegistrationParams):
			() => void;

		close(): void;

		watchRegistrations(obs: Observer<RegistrationEvent>): () => void;

	}

	interface RegistrationEvent {
		type: 'registration' | 'revocation';
		name?: string;
		remote: any;
	}

	interface ObjectRegistrationParams<T> {
		name?: string;
		fields: 'all-jnc' | {
			[field in keyof Partial<T>]: 'jnc' | FuncRegistrationParams | 'ref' | 'cRef';
		};
	}

	interface FuncRegistrationParams {
		name?: string;
		/**
		 * args specifies how arguments should be passed.
		 * 'all-jnc' default option means that all arguments are either core's
		 * objects, or are passed as jsons.
		 * Another option is to specify an array that instructs how each argument
		 * should be treated: either jnc, or reference passing with cRef
		 * referencing object on caller's side, and ref referncing object on
		 * service side.
		 * If there are more arguments given, than there are in
		 * this array, they are passed as jnc's (either json or core's object).
		 */
		args?: 'all-jnc' | ('jnc' | 'ref' | 'cRef')[];
			/**
		 * reply specifies how return should be passed.
		 * jnc stands for json or core's object. cRef references object on
		 * caller's side, while ref references object on service's side.
		 */
		reply?: 'jnc' | 'ref' | 'cRef' | 'none';
	}

}
