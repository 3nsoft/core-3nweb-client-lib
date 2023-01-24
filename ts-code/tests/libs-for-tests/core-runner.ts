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

import { Core, makeNetClient } from "../../lib-index";
import { makeInWorkerWasmCryptor } from "../../cryptors";
import { join, resolve } from "path";
import { rmDirWithContent, FileException, readdir, readFile } from "../../lib-common/async-fs-node";
import { stringOfB64Chars } from "../../lib-common/random-node";
import { UTIL_DIR } from "../../core/app-files";
import { LOGS_FOLDER } from "../../lib-client/logging/log-to-file";
import { stringifyErr } from "../../lib-common/exceptions/error";
import { assert } from "../../lib-common/assert";
import { wrapCommonW3N, wrapStartupW3N } from "./caps-ipc-wrap";
import { makeServiceLocator } from "../../lib-client/service-locator";
import { resolveTxt as resolveDnsTxt } from 'dns';

export const testApp = {
	appDomain: 'test.3nweb.computer',
	capsRequested: {
		mail: {
			receivingFrom: 'all',
			sendingTo: 'all'
		},
		storage: {
			appFS: [
				{
					domain: "test.3nweb.computer",
					storage: "synced-n-local"
				}, {
					domain: "mail.test.3nweb.computer",
					storage: "synced-n-local"
				}, {
					domain: "contacts.test.3nweb.computer",
					storage: "synced-n-local"
				}
			],
			userFS: 'all',
			sysFS: 'all'
		},
		mailerid: true,
		log: 'all'
	} as web3n.caps.common.RequestedCAPs
};

let numOfRunningCores = 0;

export interface User {
	userId: string;
	pass: string;
}

const DATA_FOLDER = resolve(__dirname, `../../../test-data`);

type CommonW3N = web3n.caps.common.W3N;
type StartupW3N = web3n.startup.W3N;


export class CoreRunner {

	runningCore: Core|undefined = undefined;
	user: User = (undefined as any);
	private appCaps: {
		raw: CommonW3N;
		ipc: CommonW3N;
		close: () => void;
	}|undefined = undefined;
	private coreNum: number;
	public readonly dataFolder: string;

	constructor(
		public readonly signUpUrl: string
	) {
		numOfRunningCores += 1;
		this.coreNum = numOfRunningCores;
		this.dataFolder = `${DATA_FOLDER}-${this.coreNum}-${Date.now()}`;
		this.setNewCore();
		Object.seal(this);
	}

	get core(): Core {
		assert(!!this.runningCore);
		return this.runningCore!;
	}

	private setNewCore(): void {
		if (this.appCaps) {
			this.appCaps.close();
			this.appCaps = undefined;
		}
		this.runningCore = Core.make(
			{ dataDir: this.dataFolder, signUpUrl: this.signUpUrl },
			makeNetClient,
			makeServiceLocator({
				resolveTxt: domain => new Promise(
					(resolve, reject) => resolveDnsTxt(domain, (err, texts) => {
						if (err) { reject(err); }
						else { resolve(texts as any); }
					}))
			}),
			makeInWorkerWasmCryptor);
	}

	async close(): Promise<void> {
		if (this.appCaps) {
			this.appCaps.close();
			this.appCaps = undefined;

			// XXX
			//  - should we do this.setNewCore() ? 

		}
		if (this.runningCore) {
			await this.runningCore.close();
			this.runningCore = undefined;
		}
	}

	async cleanup(showLogs: boolean): Promise<void> {
		if (showLogs) {
			await showLogsFrom(this.dataFolder);
		}
		await this.removeDataFolder();
	}

	async removeDataFolder(): Promise<void> {
		await rmDirWithContent(this.dataFolder).catch((exc: FileException) => {
			if (!exc.notFound) { throw exc; }
		});
	}

	async restart(rmCache: boolean, loginUser: boolean): Promise<void> {
		await this.close();
		if (rmCache) {
			await this.cleanup(false);
		}
		this.setNewCore();
		if (loginUser) {
			assert(!!this.user);
			await this.loginUser();
		}
	}

	async loginUser(): Promise<void> {
		if (!this.runningCore) {
			this.setNewCore();
		}
		const { capsForStartup: caps, coreInit } = this.core.start();
		const usersOnDisk = await caps.signIn.getUsersOnDisk();
		let isLogged: boolean;
		if (usersOnDisk.find(userOnDisk => (userOnDisk === this.user.userId))) {
			isLogged = await caps.signIn.useExistingStorage(
				this.user.userId, this.user.pass, () => {});
		} else {
			const userExists = await caps.signIn.startLoginToRemoteStorage(
				this.user.userId);
			if (!userExists) { throw new Error(
				`Attempt to login ${this.user.userId} fails, cause server doesn't recongize this user.`); }
			isLogged = await caps.signIn.completeLoginAndLocalSetup(
				this.user.pass, () => {});
		}
		if (!isLogged) { throw new Error(
			`Cannot create user ${this.user.userId}. It may already exists.`); }
		await coreInit;
	}

	async createUser(userId: string): Promise<User> {
		if (this.user) { throw new Error('App already has associated user.'); }
		const { capsForStartup: caps, coreInit } = this.core.start();
		const pass = await stringOfB64Chars(16);
		await caps.signUp.createUserParams(pass, () => {});
		const isCreated = await caps.signUp.addUser(userId);
		if (!isCreated) { throw new Error(
			`Cannot create user ${userId}. It may already exists.`); }
		await coreInit;
		this.user = { userId, pass };
		return this.user;
	}

	startCore(capsViaIPC = true): {
		w3n: StartupW3N;
		coreInit: Promise<string>;
		closeIPC: () => void
	} {
		const { capsForStartup: rawW3N, coreInit } = this.core.start();
		if (capsViaIPC) {
			const { clientW3N: w3n, close: closeIPC } = wrapStartupW3N(rawW3N);
			return { w3n, coreInit, closeIPC };
		} else {
			return { w3n: rawW3N, coreInit, closeIPC: () => {} };
		}
	}

	setupTestAppCaps(): void {
		assert(!this.appCaps, `Expect that app CAPs not to be set.`);
		const { caps, close: closeCAPs } = this.core.makeCAPsForApp(
			testApp.appDomain, testApp.capsRequested);
		const { clientW3N, close } = wrapCommonW3N(caps);
		this.appCaps = {
			raw: caps,
			ipc: clientW3N,
			close: () => {
				closeCAPs();
				close();
			}
		};
	}

	get rawAppCaps(): CommonW3N {
		assert(!!this.appCaps, `Expect that app CAPs is set.`);
		return this.appCaps!.raw;
	}

	get appCapsViaIPC(): CommonW3N {
		assert(!!this.appCaps, `Expect that app CAPs is set.`);
		return this.appCaps!.ipc;
	}

	async makeAndLoginNewCore(): Promise<CoreRunner> {
		const r = new CoreRunner(this.signUpUrl);
		r.user = this.user;
		await r.loginUser();
		r.setupTestAppCaps();
		return r;
	}

}
Object.freeze(CoreRunner.prototype);
Object.freeze(CoreRunner);


async function showLogsFrom(dataFolder: string): Promise<void> {
	const logsFolder = join(dataFolder, UTIL_DIR, LOGS_FOLDER);
	try {
		const logFiles = await readdir(logsFolder);
		if (logFiles.length === 0) { return; }
		console.log(`\n---------------------------\nLogs from directory ${logsFolder}\n`);
		for (const file of logFiles) {
			const log = await readFile(join(logsFolder, file), { encoding: 'utf8' })
			.catch(err => `Error occured in reading log file ${file}:\n${stringifyErr(err)}`);
			console.log(`Log file ${file}:\n${log}\n---------------------------`);
		}
	} catch (err) {
		if (!(err as FileException).notFound) {
			console.log(`Error occured in reading log folder:\n${stringifyErr(err)}`);
		}
	}
}


Object.freeze(exports);