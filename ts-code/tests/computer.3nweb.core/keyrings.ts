/*
 Copyright 2025 3NSoft Inc.
 
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

import { Keyrings } from "../../core/keyring";
import { afterEachCond, beforeAllWithTimeoutLog, itCond } from "../libs-for-tests/jasmine-utils";
import { setupWithUsers } from "../libs-for-tests/setups";
import { makeSetupWithTwoDevsFSs } from "./test-utils";

type JsonKey = web3n.keys.JsonKey;

const address = `address Bob Perkins @company.inc`;
const introPKeyFromServer: JsonKey = {
  use: 'asmail-pub-key',
  alg: 'NaCl-box-CXSP',
  kid: 'EKnB33DQsmpq2RiL',
  k: 'hDeWvNYajaAFUijY23SlXFKhIFOuMJLWtIBJYtiToEQ='
};


describe('ASMail keyring', () => {

	const baseSetup = setupWithUsers();

	const testFolder = `keyring-test`;

	let keyring: Keyrings;

	const {
		fsSetup: setup, setupDevsAndFSs
	} = makeSetupWithTwoDevsFSs(testFolder);

	beforeAllWithTimeoutLog(async () => {
		await setupDevsAndFSs(baseSetup);
	}, 20000);

	beforeEach(async () => {
		const fs = setup.dev1FS();
		// keyring = await makeAndKeyRing(cryptor, fs, {
		// 	find: kid => { throw Error(`publishedKeys.find() mock`); },
		// 	update: async () => { throw Error(`publishedKeys.update() mock`); }
		// });
	});

	afterEachCond(async () => {
		if (!setup.isUp) { return; }
		await setup.resetFS();
	});

	itCond(`.generateKeysToSend()`, async () => {
// 		const {
// 			currentPair, encryptor, msgCount
// 		} = await keyring.generateKeysToSend(address, introPKeyFromServer);

// // DEBUG
// // console.log(`currentPair`, currentPair, `
// // msgCount`, msgCount);

// 	const {
// 		currentPair: cp, msgCount: count
// 	} = await keyring.generateKeysToSend(address);

// // DEBUG
// // console.log(`currentPair`, cp, `
// // msgCount`, count);


	}, undefined, setup);

});