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

import { itAsync, beforeAllAsync, afterAllAsync } from '../libs-for-tests/async-jasmine';
import { minimalSetup } from '../libs-for-tests/setups';

describe('signUp process with token for single user', () => {

	const s = minimalSetup({
		noTokenSignup: [],
		other: [ 'home.town' ]
	});
	let w3n: web3n.startup.W3N;
	let coreInit: Promise<string>;
	let closeIPC: () => void;

	const userId = 'Bob Miller @home.town';
	const pass = 'some long passphrase';
	let token: string;

	beforeAllAsync(async () => {
		if (!s.isUp) { return; }
		({ closeIPC, coreInit, w3n } = s.runner.startCore());
		token = await s.server.createSingleUserSignupCtx(userId);
	});

	afterAllAsync(async () => {
		closeIPC();
	});

	itAsync('creates user account, allowing caps for apps', async () => {

		await w3n.signUp.createUserParams(pass, () => {});

		let isCreated = await w3n.signUp.addUser(userId, 'wrong token');
		expect(isCreated).toBe(false);

		isCreated = await w3n.signUp.addUser(userId, token);
		expect(isCreated).toBe(true);

		const initAs = await coreInit;
		expect(initAs).toBe(userId);
	}, 10000);

});