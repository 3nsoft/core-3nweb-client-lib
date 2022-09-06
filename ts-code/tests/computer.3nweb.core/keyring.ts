/*
 Copyright 2022 3NSoft Inc.
 
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

import { afterEachCond, beforeAllWithTimeoutLog, itCond } from "../libs-for-tests/jasmine-utils";
import { setupWithUsers } from "../libs-for-tests/setups";
import { makeSetupWithTwoDevsFSs } from "./test-utils";


describe('ASMail keyring', () => {

	const baseSetup = setupWithUsers();

	const testFolder = `id-manager-test`;

	const {
		fsSetup: setup, setupDevsAndFSs
	} = makeSetupWithTwoDevsFSs(testFolder);

	beforeAllWithTimeoutLog(async () => {
		await setupDevsAndFSs(baseSetup);
	}, 20000);

	afterEachCond(async () => {
		if (!setup.isUp) { return; }
		await setup.resetFS();
	});

	// itCond(`initializes with and without storage`, async () => {

	// }, undefined, setup);

});