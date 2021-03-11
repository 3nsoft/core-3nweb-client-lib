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

import { CoreRunner, User } from "./core-runner";
import { beforeAllAsync, afterAllAsync } from "./async-jasmine";
import { callWithTimeout } from "../../lib-common/processes";
import { ServicesRunner } from "./services-runner";
import { assert } from "../../lib-common/assert";
import { parse as parseUrl } from 'url';
import { makeNetClient } from "../../lib-client/request-utils";
import { listMsgs as listMsgsAPI } from '../../lib-common/service-api/asmail/retrieval';


export interface Setup {

	runner: CoreRunner;

	signupDomains: string[];

	isUp: boolean;

	server: {
		createSingleUserSignupCtx(userId: string): Promise<string>;
	};

}

const SERVICE_PORT = 8088;
const SIGNUP_URL = `https://localhost:${SERVICE_PORT}/signup/`;

function makeSetupObject(
	domains: { noTokenSignup: string[]; other: string[]; }
): { s: Setup; setUp: () => Promise<void>; setDown: () => Promise<void>; } {
	
	const runner = new CoreRunner(SIGNUP_URL);
	const server = new ServicesRunner(SERVICE_PORT, domains);
	let isUp = false;
	let isStopped = false;

	const s: Setup = {
		get runner() { return runner; },

		get signupDomains() { return domains.noTokenSignup; },

		get isUp() { return isUp; },

		get server() {
			return {
				createSingleUserSignupCtx:
					(userId: string) => server.createSingleUserSignupCtx(userId)
			};
		}

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
 * @param signupDomains are domains, for which server will create users without
 * token and other.
 * @return a setup object, for access to core, for restarting mid-test, etc.
 */
export function minimalSetup(
	signupDomains = {
		noTokenSignup: [ 'company.inc', 'personal.net' ],
		other: [] as string[]
	}
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

type CommonW3N = web3n.caps.common.W3N;

export  interface MultiUserSetup {

	users: User[];
	runners: Map<string, CoreRunner>;
	testAppCapsByUserIndex(i: number, viaIPC?: boolean): CommonW3N;
	testAppCapsByUser(u: User, viaIPC?: boolean): CommonW3N;

	isUp: boolean;

}

function makeMultiUserSetupObject(
	domains: { noTokenSignup: string[]; other: string[]; }
): {
	s: MultiUserSetup;
	setUp: (users: string[]) => Promise<void>;
	setDown: () => Promise<void>;
} {
	
	const runners = new Map<string, CoreRunner>();
	const server = new ServicesRunner(SERVICE_PORT, domains);
	const users: User[] = [];
	let isUp = false;
	let isStopped = false;

	function testAppCapsByUser(u: User, viaIPC = true): CommonW3N {
		const r = runners.get(u.userId)!;
		assert(!!r, `Core runner is missing for user ${u.userId}`);
		return r.appCapsViaIPC;
	}

	function testAppCapsByUserIndex(i: number, viaIPC = true): CommonW3N {
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

	const { s, setDown, setUp } = makeMultiUserSetupObject({
		noTokenSignup: users.map(domainFromUserId),
		other: []
	});

	beforeAllAsync(async () => {
		await setUp(users);
		if (setupTestAppCaps) {
			for (const runner of s.runners.values()) {
				runner.setupTestAppCaps();
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

export function serviceWithMailerIdLogin(): {
	serviceUrl: string,
	isSessionValid: (sessionId: string) => Promise<boolean>
} {
	const testSrv = parseUrl(SIGNUP_URL).host;
	const serviceUrl = `https://${testSrv}/asmail/retrieval/login/mailerid`;
	const net = makeNetClient();
	async function isSessionValid(sessionId: string) {
		const rep = await net.doBodylessRequest<listMsgsAPI.Reply>({
			url: `https://${testSrv}/asmail/retrieval/${listMsgsAPI.URL_END}`,
			method: 'GET',
			responseType: 'json',
			sessionId
		});
		if (rep.status === listMsgsAPI.SC.ok) {
			return true;
		} else if (rep.status === 403) {
			return false;
		} else {
			throw Error(`Got ${rep.status} from service`);
		}
	}
	return { serviceUrl, isSessionValid };
}


Object.freeze(exports);