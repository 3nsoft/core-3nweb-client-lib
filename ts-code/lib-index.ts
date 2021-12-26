/*
 Copyright (C) 2020 - 2021 3NSoft Inc.

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

export * from "./core-ipc/common-caps";
export * from "./core-ipc/startup-caps";

export * from "./ipc-via-protobuf/connector";
export { FileMsg, makeFileCaller, exposeFileService } from "./ipc-via-protobuf/file";
export { FSMsg, makeFSCaller, exposeFSService } from "./ipc-via-protobuf/fs";
export { makeLogCaller, exposeLogger } from "./ipc-via-protobuf/log-cap";

export * from "./core";

export { makeServiceLocator, ServiceLocatorMaker } from "./lib-client/service-locator";
export { makeNetClient } from "./lib-client/request-utils";

export { sysFolders, initSysFolders, FactoryOfFSs, PerAppStorage, sysFilesOnDevice, userFilesOnDevice, reverseDomain } from "./core/storage";

export { DeviceFS } from './lib-client/local-files/device-fs';

export { appDirs } from './core/app-files';

export { makeLogger } from './lib-client/logging/log-to-file';

import { StorageOwner as StorageOwnerClient } from './lib-client/3nstorage/service';
import { MailRecipient as MailRecipientClient } from './lib-client/asmail/recipient';
import { MailSender as MailSenderClient } from './lib-client/asmail/sender';
import { MailerIdProvisioner as MailerIdProvisionerClient } from './lib-client/mailer-id/provisioner';
import * as signupClientFuncs from './lib-client/3nweb-signup';
import * as signupApi from './lib-common/user-admin-api/signup';
import { user as midUser } from './lib-common/mid-sigs-NaCl-Ed';
import * as srvLocFuncs from './lib-client/service-locator';

import * as cryptor from './lib-client/cryptor/cryptor';


export namespace raw3NWebClients {

	export type StorageOwner = StorageOwnerClient;
	export const StorageOwner = StorageOwnerClient;

	export type MailRecipient = MailRecipientClient;
	export const MailRecipient = MailRecipientClient;

	export type MailSender = MailSenderClient;
	export const MailSender = MailSenderClient;

	export const signupFuncs = signupClientFuncs;

	export type MailerIdProvisioner = MailerIdProvisionerClient;
	export const MailerIdProvisioner = MailerIdProvisionerClient;

	export type UserMidParams = signupApi.UserMidParams;
	export type UserStorageParams = signupApi.UserStorageParams;
	export type MailerIdSigner = midUser.MailerIdSigner;

	export const serviceLocationFuncs = srvLocFuncs;

	export function getLibVersion(): string {
		return require(`../package.json`).version;
	}

}
Object.freeze(raw3NWebClients);


export namespace cryptors {

	export const makeInProcessCryptor = cryptor.makeInProcessCryptor;

	export const makeInProcessWasmCryptor = cryptor.makeInProcessWasmCryptor;

	export const makeInWorkerCryptor = cryptor.makeInWorkerCryptor;

	export const makeInWorkerWasmCryptor = cryptor.makeInWorkerWasmCryptor;

}
Object.freeze(cryptors);


Object.freeze(exports);