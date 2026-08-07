/*
 Copyright 2025 - 2026 3NSoft Inc.
 
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

import { makePeersKeyring } from "../../core/keyring/peer-keys";
import { getOrMakeDirOnInit } from "../../lib-client/fs-utils/fs-sync-utils";
import { afterEachCond, beforeAllWithTimeoutLog, itCond } from "../libs-for-tests/jasmine-utils";
import { setupWithUsers } from "../libs-for-tests/setups";
import { makeSetupWithTwoDevsFSs } from "./test-utils";
import { bytes as random } from "../../lib-common-on-node/random-node";
import { console } from "inspector";
import { generateKeyPair } from "../../core/keyring/common";
import { toCanonicalAddress } from "../../lib-common/canonical-address";
import { Logger } from "../../lib-client/logging/log-to-file";
import { bytesEqual } from "../libs-for-tests/bytes-equal";

const logger: Logger = {
	appLog: async () => {},
	logError: async (err: any, msg?: string) => {
		console.error(`\n --- test logError called with ---\nMessage: ${msg}\nError:`, err);
	},
	logWarning: async (msg: string, err?: any) => {
		console.error(`\n --- test logWarning called with ---\nMessage: ${msg}\nError:`, err);
	},
	recordUnhandledRejectionsInProcess: () => {}
};

async function logErrorInTest(err: any, msg?: string) {
	console.error(`\n --- test logError callled with ---\nMessage: ${msg}\nError:`, err);
}

describe('ASMail keyring', () => {

	const baseSetup = setupWithUsers();

	const testFolder = `keyring-test`;

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

	itCond(`peers keyring supports key pair operations for a full messaging chain from intro`, async () => {
		const dev1FS = setup.dev1FS();
		const dev1LocalFS = setup.dev1LocalFS();

		// run different peers' keyrings from different folders
		const peer1 = `keyring tester 1 @rock.cafe`;
		const peer2 = `keyring tester 2 @rock.cafe`;
		const p1FS = await getOrMakeDirOnInit(dev1FS, peer1);
		const p1LocalFS = await dev1LocalFS.writableSubRoot(`local fs for ${peer1}`);
		const p2FS = await getOrMakeDirOnInit(dev1FS, peer2);
		const p2LocalFS = await dev1LocalFS.writableSubRoot(`local fs for ${peer2}`);

		const peerKeys1 = await makePeersKeyring(p1FS, p1LocalFS, random, logger);
		const peerKeys2 = await makePeersKeyring(p2FS, p2LocalFS, random, logger);
		try {

			// -----------------------------------
			// Message 1: peer1 to peer2, peers initially don't know each other (don't have established key pairs)
			// -----------------------------------

			// peer1 somehow gets intro key for peer2
			const p2IntroPair = await generateKeyPair(random);

			// peer1, to send first message with introductory pair, generates and save suggested crypto
			let suggestedCrypto = await peerKeys1.suggestPairForPeerIntroKey(peer2, p2IntroPair.pkey);
			expect(peerKeys1.needIntroKeyFor(peer2)).toBeTrue();
			expect(suggestedCrypto!.senderKid).toBe(p2IntroPair.pkey.kid);
			
			// peer2 saves suggested crypto from decrypted message, crypto based on introductory key
			expect(peerKeys2.needIntroKeyFor(peer1)).toBeTrue();
			await peerKeys2.absorbNextPairSuggestedByPeer(peer1, suggestedCrypto, p2IntroPair);
			const estPair1 = suggestedCrypto;
			expect(peerKeys2.needIntroKeyFor(peer1)).toBeFalse();

			// -----------------------------------
			// Message 2: peer2 to peer1
			// -----------------------------------

			// peer2, to send reply, generates and saves suggested crypto
			let forSending = await peerKeys2.getSendingCryptoWithinEstablishedPair(toCanonicalAddress(peer1));
			expect(estPair1.pids).toContain(forSending.currentPair.pid!);
			expect(forSending.nextMsgCrypto).withContext(
				`next crypto is generated asap to jump off introductory key`
			).toBeDefined();

			// peer1, when message is received with pair id (pid), finds keys to decrypt message
			let decr = peerKeys1.findEstablishedReceptionPairs(forSending.currentPair.pid!);
			expect(decr).toBeDefined();
			expect(decr![0].peerCAddr).toBe(toCanonicalAddress(peer2));
			expect(decr![0].ratchetStage).toBe('suggested');
			expect(bytesEqual(forSending.msgMasterKey, decr![0].msgMasterKey)).toBeTrue();

			// peer1 marks found crypto pair as being in use
			await peerKeys1.markPairAsInUse(decr![0].peerCAddr, decr![0].peerKId, decr![0].recipientKId);

			// peer1 saves next crypto from decrypted message
			expect(peerKeys1.needIntroKeyFor(peer2)).toBeTrue();
			await peerKeys1.absorbNextPairSuggestedByPeer(peer2, forSending.nextMsgCrypto!);
			const estPair2 = forSending.nextMsgCrypto!;
			expect(peerKeys1.needIntroKeyFor(peer2)).toBeFalse();

			// -----------------------------------
			// Message 3: peer1 to peer2
			// -----------------------------------

			// peer1 gets crypto to send to peer2
			forSending = await peerKeys1.getSendingCryptoWithinEstablishedPair(toCanonicalAddress(peer2));
			expect(estPair2.pids).toContain(forSending.currentPair.pid!);
			expect(forSending.nextMsgCrypto).withContext(
				`attempt to rotate pairs will come after some period of time`
			).toBeUndefined();

			// peer2 finds pair to decrypt message
			decr = peerKeys2.findEstablishedReceptionPairs(forSending.currentPair.pid!);
			expect(decr).toBeDefined();
			expect(decr![0].peerCAddr).toBe(toCanonicalAddress(peer1));
			expect(decr![0].ratchetStage).toBe('suggested');
			expect(bytesEqual(forSending.msgMasterKey, decr![0].msgMasterKey)).toBeTrue();

			// peer2 marks found crypto pair as being in use
			await peerKeys2.markPairAsInUse(decr![0].peerCAddr, decr![0].peerKId, decr![0].recipientKId);

			// -----------------------------------
			// Message 4: peer2 to peer1
			// -----------------------------------

			// peer2 gets crypto to send to peer1
			forSending = await peerKeys2.getSendingCryptoWithinEstablishedPair(toCanonicalAddress(peer1));
			expect(estPair1.pids).toContain(forSending.currentPair.pid!);
			expect(forSending.nextMsgCrypto).withContext(
				`attempt to rotate pairs will come after some period of time`
			).toBeUndefined();

			// peer1, when message is received with pair id (pid), finds keys to decrypt message
			decr = peerKeys1.findEstablishedReceptionPairs(forSending.currentPair.pid!);
			expect(decr).toBeDefined();
			expect(decr![0].peerCAddr).toBe(toCanonicalAddress(peer2));
			expect(decr![0].ratchetStage).toBe('in_use');
			expect(bytesEqual(forSending.msgMasterKey, decr![0].msgMasterKey)).toBeTrue();

			// -----------------------------------
			// Message 5: peer1 to peer2
			// -----------------------------------

			// peer1 gets crypto to send to peer2
			forSending = await peerKeys1.getSendingCryptoWithinEstablishedPair(toCanonicalAddress(peer2));
			expect(estPair2.pids).toContain(forSending.currentPair.pid!);
			expect(forSending.nextMsgCrypto).withContext(
				`attempt to rotate pairs will come after some period of time`
			).toBeUndefined();

			// peer2 finds pair to decrypt message
			decr = peerKeys2.findEstablishedReceptionPairs(forSending.currentPair.pid!);
			expect(decr).toBeDefined();
			expect(decr![0].peerCAddr).toBe(toCanonicalAddress(peer1));
			expect(decr![0].ratchetStage).toBe('in_use');
			expect(bytesEqual(forSending.msgMasterKey, decr![0].msgMasterKey)).toBeTrue();


		} finally {
			await peerKeys1.close().catch(exc => logErrorInTest(exc));
			await peerKeys2.close().catch(exc => logErrorInTest(exc));
		}
	}, undefined, setup);

});