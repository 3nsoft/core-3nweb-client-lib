/*
 Copyright (C) 2016 - 2017, 2020, 2023, 2025 3NSoft Inc.

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


declare namespace web3n.startup {
	
	/**
	 * This is a collection of functions, that are are used by startup
	 * functionality, when user creates new account in 3NWeb domains.
	 */
	interface SignUpService {

		/**
		 * @param serviceUrl of 3NWeb signup service url.
		 */
		setSignUpServer(serviceUrl: string): Promise<void>;

		/**
		 * @param signupToken
		 * @return a promise, resolvable to an array of available domains for
		 * creation of a new account.
		 */
		getAvailableDomains(signupToken?: string): Promise<string[]>;

		/**
		 * @param name is a part of address that comes before @domain
		 * @param signupToken
		 * @return a promise, resolvable to an array of available 3NWeb addresses
		 * with a given name part of the address.
		 * Array will be empty, when there are no available addresses for a given
		 * name.
		 */
		getAvailableAddresses(
			name: string, signupToken?: string
		): Promise<string[]>;
		
		/**
		 * @param userId
		 * @param signupToken
		 * @return a promise, resolvable to flag that indicates whether an account
		 * for given user has been created (true value), or not (false value).
		 */
		addUser(userId: string, signupToken?: string): Promise<boolean>;
		
		/**
		 * @param userId
		 * @return a promise, resolvable to flag that indicates whether given user
		 * account is active (true value), or not (false value).
		 */
		isActivated(userId: string): Promise<boolean>;
		
		/**
		 * This returns a promise, resolvable when MailerId login and storage
		 * secret keys, have been derived from a password.
		 * @param pass
		 * @param progressCB is a callback for progress notification
		 */
		createUserParams(
			pass: string, progressCB: ProgressCB
		): Promise<void>;

		watchBoot(observer: BootProcessObserver): () => void;
		
	}
	
	/**
	 * This is a collection of functions, that are are used by startup
	 * functionality, when user signs into existing account, whether already
	 * cached on this device, or not.
	 */
	interface SignInService {
		
		/**
		 * This returns an array of users, whose storages are found on a disk.
		 */
		getUsersOnDisk(): Promise<string[]>;
		
		/**
		 * This starts a login process, when application is started without user
		 * storage on a disk.
		 * It returns a promise, resolvable either to true, if provisioning has
		 * started, or to false, if given address is not known to the MailerId
		 * server.
		 * @param address
		 */
		startLoginToRemoteStorage(address: string): Promise<boolean>;
		
		/**
		 * This completes login and setup of user's storage on a disk.
		 * It returns a promise, resolvable either to true, when provisioning is
		 * done, or to false, when given password is incorrect.
		 * @param pass is a MailerId login password
		 * @param progressCB is a callback for progress notification
		 */
		completeLoginAndLocalSetup(
			pass: string, progressCB: ProgressCB
		): Promise<boolean>;
		
		/**
		 * This method initializes core to run from an existing on a disk storage.
		 * It returns a promise, resolvable either to true, when password opens
		 * storage, and to false, when given password is incorrect.
		 * @param address is user' address.
		 * @param pass is user's password.
		 * @param progressCB is a callback for progress notification
		 */
		useExistingStorage(
			address: string, pass: string, progressCB: ProgressCB
		): Promise<boolean>;

		watchBoot(observer: BootProcessObserver): () => void;
		
	}

	type ProgressCB = (progress: number) => void;
	type BootProcessObserver = Observer<BootEvent>;
	interface BootEvent {
		coreApp?: string;
		message: string;
		isError?: true;
		isWarning?: true;
	}

	interface W3N {
		signIn: startup.SignInService;
		signUp: startup.SignUpService;
	}
	
}
