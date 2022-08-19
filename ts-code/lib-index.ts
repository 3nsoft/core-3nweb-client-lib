/*
 Copyright (C) 2020 - 2022 3NSoft Inc.

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

export { makeServiceLocator, ServiceLocatorMaker } from "./lib-client/service-locator";
export { makeNetClient } from "./lib-client/request-utils";

export { FactoryOfFSs, PerAppStorage, reverseDomain } from "./core/storage";
export { sysFolders } from "./core/storage/system-folders";

export { DeviceFS } from './lib-client/local-files/device-fs';

export { appDirs } from './core/app-files';

export { makeLogger } from './lib-client/logging/log-to-file';


Object.freeze(exports);