/*
 Copyright (C) 2015 - 2018, 2022, 2026 3NSoft Inc.
 
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

import { JWKeyPair, ASMailKeyPair, KEY_USE} from '../common';
import { SuggestedNextKeyPair } from '../../asmail/msg/opener';
import { box } from 'ecma-nacl';
import { base64 } from '../../../lib-common/buffer-utils';
import { AsyncRNG } from '../../../lib-common/rng-def';
import { Logger } from '../../../lib-client/logging/log-to-file';
import { getOrMakeDirOnInit } from '../../../lib-client/fs-utils/fs-sync-utils';
import { startDatasetSync } from '../../../lib-common/dataset-sync/per-device-json-array-logs';
import { makeSyncedFunc } from '../../../lib-common/processes/synced';
import { makePeerKeysChangeLogs } from './dataset/v2/logs';
import { makePeerKeysDB } from './dataset/v2/peer-keys-db';
import { toCanonicalAddress } from '../../../lib-common/canonical-address';

type WritableFS = web3n.files.WritableFS;
type JsonKey = web3n.keys.JsonKey;
type CorrespondentKeysInfo = web3n.keys.CorrespondentKeysInfo;

const LOGS_DIR = 'peer-keys-logs';
const PEER_KEYS_FOLDER = 'peer-keys-db';

const NUM_OF_LOGS_TO_START_CUT = 200;

export async function makePeersKeyring(
	keyringFS: WritableFS, localFS: WritableFS, random: AsyncRNG, logger: Logger
) {

	const logsFS = await getOrMakeDirOnInit(keyringFS, LOGS_DIR);
	const logsLocalFS = await localFS.writableSubRoot(LOGS_DIR);

	const peerKeysFS = await getOrMakeDirOnInit(keyringFS, PEER_KEYS_FOLDER);

	// XXX log and saving reduction(!):
	//  - we don't need to log message counts
	//  - we don't have to immediately save changes in message counts
	//  - we want to save and log crypto material, more so, we generate and log new crypto first, then send message
	//  - logging and saving of marking pair as in use also doesn't have to be immediate (should it be logged?)
	const logs = await makePeerKeysChangeLogs(logsFS, logsLocalFS, logger.logError);
	const keysDB = await makePeerKeysDB(peerKeysFS, random);

	async function suggestPairForPeerIntroKey(
		peerAddr: string, peerIntroPKey: JsonKey
	): Promise<SuggestedNextKeyPair> {
		const peerCAddr = toCanonicalAddress(peerAddr);
		const alreadySuggested = keysDB.getPairSuggestedToPeer(peerCAddr);
		if (alreadySuggested && (alreadySuggested.senderKid === peerIntroPKey.kid)) {
			return alreadySuggested;
		} else {
			if (!keysDB.getPeerAddressForCanonical(peerCAddr)) {
				keysDB.addPeer(peerAddr);
			}
			const {
				nextCrypto, entryToLog
			} = await keysDB.generateSuggestedPairOnPeerIntroKey(peerCAddr, peerIntroPKey);
			await keysDB.saveIfNeeded();
			await logs.recordSuggestingCryptoToPeer(entryToLog, peerAddr);
			return nextCrypto;
		}
	}

	function needIntroKeyFor(peerAddr: string): boolean {
		return !keysDB.getSendingPair(toCanonicalAddress(peerAddr));
	}

	async function getSendingCryptoWithinEstablishedPair(peerCAddr: string): Promise<{
		currentPair: ASMailKeyPair; msgMasterKey: Uint8Array; msgCount: number; nextMsgCrypto?: SuggestedNextKeyPair;
	}> {
		const pair = keysDB.getSendingPair(peerCAddr);
		if (!pair) {
			throw new Error(`No sending pair for peer ${peerCAddr}`);
		}
		const { pids, peerKId, pairAlg, senderKId, senderPKey, msgMasterKey, sentMsgsCount } = pair;
		const msgCount = sentMsgsCount + 1;
		keysDB.updateSentMsgCountInSendingPair(peerCAddr, msgCount);
		let nextMsgCrypto = keysDB.getPairSuggestedToPeer(peerCAddr);
		if (!nextMsgCrypto) {
			const generated = await keysDB.generateRegularSuggestedPairIfNeeded(peerCAddr);
			if (generated) {
				nextMsgCrypto = generated.nextCrypto
				await keysDB.saveIfNeeded();
				await logs.recordSuggestingCryptoToPeer(generated.entryToLog, peerCAddr);
			}
		}
		return {
			currentPair: {
				pid: selectPid(pids),
				recipientKid: peerKId,
				senderPKey: {
					alg: pairAlg,
					kid: senderKId,
					k: senderPKey,
					use: KEY_USE.PUBLIC
				}
			},
			msgMasterKey,
			msgCount,
			nextMsgCrypto
		};
	}

	async function markPairAsInUse(peerCAddr: string, peerKId: string, recipientKId: string): Promise<void> {
		const pairFoundAndMarked = keysDB.markPairAsInUse(peerCAddr, peerKId, recipientKId);
		if (pairFoundAndMarked) {
			await keysDB.saveIfNeeded();
			await logs.recordPeerStartedUsingPair(peerCAddr, peerKId, recipientKId);
		}
	}

	async function absorbNextPairSuggestedByPeer(
		peerAddr: string, pair: SuggestedNextKeyPair, introKey?: JWKeyPair
	): Promise<void> {
		const peerCAddr = toCanonicalAddress(peerAddr);
		const msgMasterKeyAlg = box.JWK_ALG_NAME;
		const peerPKey = base64.open(pair.recipientPKey.k);
		if (keysDB.getPeerAddressForCanonical(peerCAddr)) {
			const prevPair = keysDB.getSendingPair(peerCAddr);
			if (introKey) {
				if (prevPair
				&& ((introKey.pkey.kid === pair.senderKid) && (prevPair.peerKId === pair.recipientPKey.kid))) {
					// ignoring duplicate
					return;
				}
				const senderSKey = base64.open(introKey.skey.k);
				const msgMasterKey = box.calc_dhshared_key(peerPKey, senderSKey);
				keysDB.updateSendingPairFromSuggested(peerCAddr, pair, {
					msgMasterKey, msgMasterKeyAlg, peerPKey, senderSKey,
					senderKId: introKey.pkey.kid,
					senderPKey: introKey.pkey.k
				});
			} else {
				if (prevPair
				&& ((prevPair.senderKId === pair.senderKid) && (prevPair.peerKId === pair.recipientPKey.kid))) {
					// ignoring duplicate
					return;
				}
				const foundPair = keysDB.findKeyToMatchSuggestedForSendingPair(peerCAddr, pair.senderKid);
				if (!foundPair) {
					// ignore bad
					return;
				}
				const { pkey: senderPKey, skey: senderSKey, pairAlg } = foundPair;
				const msgMasterKey = box.calc_dhshared_key(peerPKey, senderSKey);
				if (prevPair) {
					keysDB.updateSendingPairFromSuggested(peerCAddr, pair, {
						msgMasterKey, msgMasterKeyAlg, peerPKey, senderSKey, senderPKey,
						senderKId: pair.senderKid
					});
				} else {
					keysDB.addSendingPairFromSuggested(peerCAddr, pair, {
						msgMasterKey, msgMasterKeyAlg, senderSKey, peerPKey, pairAlg, senderPKey,
						senderKId: pair.senderKid
					});
				}
			}
		} else {
			if (!introKey) {
				throw new Error(`Peer ${peerAddr} is not known, while used introductory key is not given`);
			}
			keysDB.addPeer(peerAddr);
			const senderSKey = base64.open(introKey.skey.k);
			const msgMasterKey = box.calc_dhshared_key(peerPKey, senderSKey);
			keysDB.addSendingPairFromSuggested(peerCAddr, pair, {
				msgMasterKey, msgMasterKeyAlg, senderSKey, peerPKey,
				pairAlg: introKey.pkey.alg,
				senderKId: introKey.pkey.kid,
				senderPKey: introKey.pkey.k
			});
		}
		const entryToLog = keysDB.getSendingPair(peerCAddr);
		if (entryToLog) {
			await keysDB.saveIfNeeded();
			await logs.recordGettingCryptoFromPeer(entryToLog, peerAddr);
		} else {
			// XXX we see code come here. sql not recording? why?
			logger.logError(`Suggested sending pair somehow didn't get into db within this absorbNextPairSuggestedByPeer()`);
		}
	}

	async function periodicCheckAndUploadOfData() {
		if (logs.numOfLogs() >= NUM_OF_LOGS_TO_START_CUT) {
			const syncedIndexDbVersion = await keysDB.saveAndSync();
			await logs.cutLogOnDatasetSyncAndUpload(syncedIndexDbVersion);
		}
	}

	function millisBeforeNextRun() {
		return 30*60*1000 + Math.floor(10*60*1000 * Math.random());
	}

	const { stopSyncing, changeProc } = startDatasetSync(
		periodicCheckAndUploadOfData, millisBeforeNextRun,
		{
			watchAndApplyOpsFromOtherDevices: logs.watchAndApplyOpsFromOtherDevices
		},
		{
			absorbOpsFromOtherDevices: keysDB.absorbOpsFromOtherDevices,
			watchAndApplyOpsFromOtherDevices: keysDB.watchAndApplyOpsFromOtherDevices
		}
	);

	// XXX
	//  - check if indexed latest is too old, chopping to the latest shard

	async function close(): Promise<void> {
		stopSyncing();
	}

	return {
		getPeerAddressForCanonical: keysDB.getPeerAddressForCanonical,
		needIntroKeyFor,
		suggestPairForPeerIntroKey: makeSyncedFunc(changeProc, undefined, suggestPairForPeerIntroKey),
		getSendingCryptoWithinEstablishedPair: makeSyncedFunc(
			changeProc, undefined, getSendingCryptoWithinEstablishedPair
		),

		absorbNextPairSuggestedByPeer: makeSyncedFunc(changeProc, undefined, absorbNextPairSuggestedByPeer),

		findEstablishedReceptionPairs: keysDB.findReceptionPairsForPId,
		markPairAsInUse: makeSyncedFunc(changeProc, undefined, markPairAsInUse),
		updateReceivedMsgCountIn: keysDB.updateReceivedMsgCountIn,
		close,
		getPeerKeysInfo: keysDB.getPeerKeysInfo
	};
}

function selectPid(pids: string[]): string {
	if (pids.length < 1) {
		throw new Error("There are no pair ids in array.");
	}
	const i = Math.round((pids.length-1) * Math.random());
	return pids[i];
}

Object.freeze(exports);