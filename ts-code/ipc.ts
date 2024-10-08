/*
 Copyright (C) 2020 - 2021, 2024 3NSoft Inc.

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
export { FileMsg, makeFileCaller, exposeFileService } from "./core-ipc/file";
export { FSMsg, makeFSCaller, exposeFSService } from "./core-ipc/fs";
export { makeSinkCaller, exposeSinkService, makeSrcCaller, exposeSrcService } from "./core-ipc/bytes";
export { makeLogCaller, exposeLogger } from "./core-ipc/log-cap";
export * as callerSideJSONWrap from "./core-ipc/json-ipc-wrapping/caller-side-wrap";
export * as serviceSideJSONWrap from "./core-ipc/json-ipc-wrapping/service-side-wrap";


Object.freeze(exports);