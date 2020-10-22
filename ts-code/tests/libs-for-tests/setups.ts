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

import { CoreRunner, User } from "./core-runner";
import { beforeAllAsync, afterAllAsync } from "./async-jasmine";
import { callWithTimeout } from "../../lib-common/processes";
import { ServicesRunner } from "./services-runner";
import { assert } from "../../lib-common/assert";


export interface Setup {

	runner: CoreRunner;

	signupDomains: string[];

	isUp: boolean;

}

const SERVICE_PORT = 8088;
const SIGNUP_URL = `https://localhost:${SERVICE_PORT}/signup/`;

function makeSetupObject(
	signupDomains: string[]
): { s: Setup; setUp: () => Promise<void>; setDown: () => Promise<void>; } {
	
	const runner = new CoreRunner(SIGNUP_URL);
	const server = new ServicesRunner(SERVICE_PORT, signupDomains);
	let isUp = false;
	let isStopped = false;

	const s: Setup = {
		get runner() { return runner; },

		get signupDomains() { return signupDomains; },

		get isUp() { return isUp; },

	};

	async function setUp(): Promise<void> {
		try {
			await server.start();
			isUp = true;
		} catch (err) {
			await setDown().catch(() => {});
			throw err;
		}
	}

	async function setDown(): Promise<void> {
		if (isStopped) { return; }
		isUp = false;
		isStopped = true;
		try {
			await runner.close();
		} finally {
			await runner.cleanup(true);
			await server.stop(true);
		}
	}

	return { s, setUp, setDown };
}

/**
 * This creates a minimal working setup of core and server, and calls simple
 * before and after methods, that do start and stop of everything.
 * @param signupDomains are domains, for which server will create users.
 * @return a setup object, for access to core, for restarting mid-test, etc.
 */
export function minimalSetup(
	signupDomains = [ 'company.inc', 'personal.net' ]
): Setup {

	const { s, setDown, setUp } = makeSetupObject(signupDomains);

	beforeAllAsync(() => setUp());

	afterAllAsync(async () => {
		if (s.isUp) {
			await callWithTimeout(
				setDown, 5000, () => `Timeout when calling teardown of test setup`
			).catch(async err => {
				console.log(`\n>>> error in teardown:`, err);
			});
		}
	}, 6000);

	return s;
}

type commonW3N = web3n.caps.common.W3N;

export  interface MultiUserSetup {

	users: User[];
	runners: Map<string, CoreRunner>;
	testAppCapsByUserIndex(i: number, viaIPC?: boolean): commonW3N;
	testAppCapsByUser(u: User, viaIPC?: boolean): commonW3N;

	isUp: boolean;

}

function makeMultiUserSetupObject(
	signupDomains: string[]
): {
	s: MultiUserSetup;
	setUp: (users: string[]) => Promise<void>;
	setDown: () => Promise<void>;
} {
	
	const runners = new Map<string, CoreRunner>();
	const server = new ServicesRunner(SERVICE_PORT, signupDomains);
	const users: User[] = [];
	let isUp = false;
	let isStopped = false;

	function testAppCapsByUser(u: User, viaIPC = true): commonW3N {
		const r = runners.get(u.userId)!;
		assert(!!r, `Core runner is missing for user ${u.userId}`);
		return r.appCapsViaIPC;
	}

	function testAppCapsByUserIndex(i: number, viaIPC = true): commonW3N {
		const u = users[i];
		assert(!!u, `Given index ${i} is not pointing to existing user`);
		return testAppCapsByUser(u);
	}

	const s: MultiUserSetup = {
		runners,
		users,
		get isUp() { return isUp; },
		testAppCapsByUser,
		testAppCapsByUserIndex
	};

	async function createUser(userId: string): Promise<User> {
		const runner = new CoreRunner(SIGNUP_URL);
		const user = await runner.createUser(userId)
		.catch(async err => {
			await runner.cleanup(true);
			throw err;
		});
		runners.set(user.userId, runner);
		users.push(user);
		return user;
	}

	async function setUp(users: string[]): Promise<void> {
		try {
			await server.start();
			const makingUsers = users.map(address => createUser(address));
			await Promise.all(makingUsers);
			isUp = true;
		} catch (err) {
			await setDown().catch(() => {});
			throw err;
		}
	}

	async function setDown(): Promise<void> {
		if (isStopped) { return; }
		isUp = false;
		isStopped = true;
		for (const runner of runners.values()) {
			try {
				await runner.close();
			} finally {
				await runner.cleanup(true);
			}
		}
		await server.stop();
	}

	return { s, setUp, setDown };
}

/**
 * This function creates users inside of usual
 * @param users is a list of user ids to create. Default users are created,
 * if no value given.
 * Setup automatically sets DNS for domains from these ids.
 * @return a setup object, for access to cores, for restarting mid-test, etc.
 */
export function setupWithUsers(
	setupTestAppCaps = true,
	users = ['Bob Marley @rock.cafe']
): MultiUserSetup {
	if (users.length === 0) { throw new Error('No user given to setup.'); }

	const signupDomains = users.map(domainFromUserId);

	const { s, setDown, setUp } = makeMultiUserSetupObject(signupDomains);

	beforeAllAsync(async () => {
		await setUp(users);
		if (setupTestAppCaps) {
			for (const runner of s.runners.values()) {
				await runner.setupTestAppCaps();
			}
		}
	}, users.length*7000);

	afterAllAsync(async () => {
		if (s.isUp) {
			await callWithTimeout(
				setDown, 5000, () => `Timeout when calling teardown of test setup`
			).catch(async err => {
				console.log(`\n>>> error in teardown:`, err);
			});
		}
	}, 6000);

	return s;
}

function domainFromUserId(userId: string): string {
	const indAt = userId.indexOf('@');
	if (indAt < 0) {
		return userId;
	} else {
		return userId.substring(indAt+1);
	}
}


Object.freeze(exports);