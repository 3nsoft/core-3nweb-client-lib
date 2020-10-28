/*
 Copyright (C) 2020 3NSoft Inc.
 
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

import { resolve } from "path";
import { rmDirWithContent, FileException, existsFolderSync } from "../../lib-common/async-fs-node";


let numOfRunningServers = 0;

const DATA_FOLDER = resolve(__dirname, `../../../test-server-data`);

const serverMod = (() => {
	let serverDir: string;
	if (existsFolderSync(resolve(__dirname, '../../../../spec-server'))) {
		serverDir = '../../../../spec-server';
	} else if (existsFolderSync(resolve(__dirname, '../../../spec-server'))) {
		serverDir = '../../../spec-server';
	} else {
		throw new Error(`Spec server directory is not found. You may need to download spec server from https://github.com/3nsoft/spec-server , build and place it near this project's main folder.`);
	}
	return require(serverDir+'/build/lib');
})();


export class ServicesRunner {

	private stopFn: (() => Promise<void>)|undefined = undefined;
	public readonly dataFolder: string;
	private serverNum: number;

	constructor(
		public readonly port: number,
		public readonly domains: { noTokenSignup: string[]; other: string[]; }
	) {
		numOfRunningServers += 1;
		this.serverNum = numOfRunningServers;
		this.dataFolder = `${DATA_FOLDER}-${this.serverNum}-${Date.now()}`;
		Object.seal(this);
	}

	async start(): Promise<void> {
		const { stop } = await serverMod.mock.startOnLocalhost(
			this.dataFolder, this.port, this.domains);
		this.stopFn = stop;
	}

	async stop(cleanup = true): Promise<void> {
		if (!this.stopFn) { return; }
		await this.stopFn();
		this.stopFn = undefined;
		if (cleanup) {
			await this.cleanup();
		}
	}

	private async cleanup(): Promise<void> {
		numOfRunningServers -= 1;
		await rmDirWithContent(this.dataFolder).catch((exc: FileException) => {
			if (!exc.notFound) { throw exc; }
		});
	}

	createSingleUserSignupCtx(userId: string): Promise<string> {
		return serverMod.confs.addSingleUserSignup(this.dataFolder, userId);
	}

}
Object.freeze(ServicesRunner.prototype);
Object.freeze(ServicesRunner);


Object.freeze(exports);