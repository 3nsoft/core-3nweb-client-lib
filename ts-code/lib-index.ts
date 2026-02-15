/*
 Copyright (C) 2020 - 2022, 2025 3NSoft Inc.

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

export * from "./core";
export { SignUp, CreatedUser } from './core/startup/sign-up';
export { IdManager } from './core/id-manager';
export { Storages, FactoryOfFSs, reverseDomain } from './core/storage';
export { SignIn, GenerateKey, CompleteInitWithoutCache } from './core/startup/sign-in';
export { ASMail } from './core/asmail';

export { makeServiceLocator, ServiceLocatorMaker } from "./lib-client/service-locator";
export { makeNetClient, NetClient } from "./lib-client/request-utils";

export { appDirs } from './core/app-files';
export { sysFolders } from "./core/storage/system-folders";

export { DeviceFS } from './lib-client/local-files/device-fs';

export { makeLogger } from './lib-client/logging/log-to-file';

export const SYSTEM_DOMAIN = '3nweb.computer';

export { checkServicesStartingFromSignup } from './lib-client/service-checks';

export { dohAt } from './lib-client/doh';

Object.freeze(exports);