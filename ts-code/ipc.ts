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

// Reexport of rxjs to use with ipc implementation.
export * as rxjs from 'rxjs';


Object.freeze(exports);