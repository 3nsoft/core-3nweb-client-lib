/*
 Copyright (C) 2026 3NSoft Inc.
 
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

import { toCanonicalAddress } from "../../../../../lib-common/canonical-address";
import { andEqualExprFor, booleanTransform, jsonTransform, optJsonTransform, passOmitting, performTableInsert, queryParamsFrom, selectFromTable, setExprFor, TransformDefinition, updateInTable } from "../../../../../lib-sqlite-on-3nstorage/for-sqlite";
import { objectFromQueryExecResult, SQLiteOn3NStorage, SQLiteOnSyncedFS } from "../../../../../lib-sqlite-on-3nstorage";
import { checkIfV1AndReadPeerKeys, v1RatchetedSendingPairToV2SendingKeyPairDbEntry, v1ReceptionPairToV2RecipientKeyPairDbEntry } from "../v1/json-files";
import { SuggestedNextKeyPair } from "../../../../asmail/msg/common";
import { generateKeyPair, MIN_PERIOD_FOR_PAIR, PID_LENGTH } from "../../../common";
import { AsyncRNG, stringOfB64UrlSafeChars } from "../../../../../lib-common/rng-def";
import { base64 } from "../../../../../lib-common/buffer-utils";
import { box, secret_box as sbox } from 'ecma-nacl';
import { addToNumberLineSegments } from "../../../../../lib-common/number-line";
import { PairEvent, recipientPairEntryFromJSON, sendingPairEntryFromJSON } from "./logs";
import { SingleProc } from "../../../../../lib-common/processes/synced";
import { LogEntry } from "../../../../../lib-common/dataset-sync/per-device-json-array-logs";

type WritableFS = web3n.files.WritableFS;
type WritableFile = web3n.files.WritableFile;
type JsonKey = web3n.keys.JsonKey;
type CorrespondentKeysInfo = web3n.keys.CorrespondentKeysInfo;
type ReceptionPairInfo = web3n.keys.ReceptionPairInfo;

export interface SendingKeyPairDbEntry {
  peerCAddr: string;
  pids: string[];
  pairAlg: string;
  pairTS: number;
  sentMsgsCount: number;
  sentMsgLastTS: number;
  peerPKey: Uint8Array;
  peerKId: string;
  senderSKey: Uint8Array;
  senderPKey: string;
  senderKId: string;
  msgMasterKeyAlg: string;
  msgMasterKey: Uint8Array;
}

export interface RecipientKeyPairDbEntry {
  peerCAddr: string;
  ratchetStage: 'suggested' | 'in_use' | 'old';
  pids: string[];
  pairTS: number;
  pairAlg: string;
  receivedMsgsCounts?: number[][];
  receivedMsgLastTS?: number;
  peerPKey: Uint8Array;
  peerKId: string;
  isPeerIntroKey: boolean;
  recipientSKey: Uint8Array;
  recipientPKey: string;
  recipientKId: string;
  msgMasterKeyAlg: string;
  msgMasterKey: Uint8Array;
}

interface RecipientPIdsDbEntry {
  peerCAddr: string;
  pid: string;
  peerKId: string;
  recipientKId: string;
}

const queryToCreatePeerKeysDbV2 = [
  // XXX although we put foreign key into create clauses, current library binary is ignoring it even with pragma on
  //     yet, we follow connection accordingly
  // `--sql
  // PRAGMA foreign_keys = ON
  // `,
  `--sql
  CREATE TABLE peers (
    peerCAddr TEXT NOT NULL PRIMARY KEY,
    peerAddr TEXT NOT NULL
  )
  `,
  // sending_key_pairs contains material for sending messages.
  // Sending pair is suggested by peer.
  `--sql
  CREATE TABLE sending_key_pairs (
    peerCAddr TEXT NOT NULL PRIMARY KEY REFERENCES peers ON DELETE CASCADE,
    --
    pairAlg TEXT NOT NULL,
    pairTS INTEGER NOT NULL,
    --
    sentMsgsCount INTEGER,
    sentMsgLastTS INTEGER,
    --
    peerPKey BLOB NOT NULL,
    peerKId TEXT NOT NULL,
    --
    pids TEXT NOT NULL,
    --
    senderSKey BLOB NOT NULL,
    senderPKey TEXT NOT NULL,
    senderKId TEXT NOT NULL,
    --
    msgMasterKeyAlg TEXT NOT NULL,
    msgMasterKey BLOB NOT NULL
  )
  `,
  // reception_key_pairs are used for reading incoming messages.
  // Reception pairs are suggested by this side to respective peers, ratcheting/updating keys of both sides.
  // When peer encrypts message to a new pair, it implies that pair is ratcheted to be in use, making current
  // pair old, and allowing to suggest next new pair, advancing key ratcheting.
  // In a scenario when this side starts messaging, it suggests pairs with peer's introductory key, known at the
  // time. Introductory key may change in time, resulting in different suggested pairs before peer ever replies.
  // These pairs should be kept till peer replies, implying which pair is used, allowing to drop other ones.
  `--sql
  CREATE TABLE reception_key_pairs (
    peerCAddr TEXT NOT NULL REFERENCES peers ON DELETE CASCADE,
    ratchetStage TEXT NOT NULL,
    pids TEXT NOT NULL,
    --
    pairAlg TEXT NOT NULL,
    pairTS INTEGER NOT NULL,
    --
    receivedMsgsCounts TEXT,
    receivedMsgLastTS INTEGER,
    --
    peerPKey BLOB NOT NULL,
    peerKId TEXT NOT NULL,
    isPeerIntroKey INTEGER NOT NULL,
    --
    recipientSKey BLOB NOT NULL,
    recipientPKey TEXT NOT NULL,
    recipientKId TEXT NOT NULL,
    --
    msgMasterKeyAlg TEXT NOT NULL,
    msgMasterKey BLOB NOT NULL,
    --
    PRIMARY KEY (peerCAddr, recipientKId, peerKId)
  )
  `,
  `--sql
  CREATE INDEX reception_pair_stage ON reception_key_pairs (peerCAddr, ratchetStage)
  `,
  `--sql
  CREATE TABLE reception_key_pairs_pids (
    peerCAddr TEXT NOT NULL,
    peerKId TEXT NOT NULL,
    recipientKId TEXT NOT NULL,
    pid TEXT NOT NULL,
    PRIMARY KEY (peerCAddr, recipientKId, peerKId, pid),
    FOREIGN KEY (peerCAddr, recipientKId, peerKId) REFERENCES reception_key_pairs ON DELETE CASCADE
  )
  `,
  `--sql
  CREATE INDEX pid_to_reception_pair ON reception_key_pairs_pids (pid)
  `
].join(';\n');

const sendingKeyPairsTabFields: TransformDefinition<SendingKeyPairDbEntry> = {
  peerCAddr: 'as-is',
  pairAlg: 'as-is',
  pairTS: 'as-is',
  sentMsgsCount: 'as-is',
  sentMsgLastTS: 'as-is',
  peerPKey: 'as-is',
  peerKId: 'as-is',
  pids: jsonTransform,
  senderSKey: 'as-is',
  senderPKey: 'as-is',
  senderKId: 'as-is',
  msgMasterKey: 'as-is',
  msgMasterKeyAlg: 'as-is'
};

const receptionKeyPairsTabFields: TransformDefinition<RecipientKeyPairDbEntry> = {
  peerCAddr: 'as-is',
  ratchetStage: 'as-is',
  pids: jsonTransform,
  pairTS: 'as-is',
  pairAlg: 'as-is',
  receivedMsgsCounts: optJsonTransform,
  receivedMsgLastTS: 'as-is',
  peerPKey: 'as-is',
  peerKId: 'as-is',
  isPeerIntroKey: booleanTransform,
  recipientSKey: 'as-is',
  recipientPKey: 'as-is',
  recipientKId: 'as-is',
  msgMasterKey: 'as-is',
  msgMasterKeyAlg: 'as-is'
};

const pidsIndexTabFields: TransformDefinition<RecipientPIdsDbEntry> = {
  peerCAddr: 'as-is',
  peerKId: 'as-is',
  recipientKId: 'as-is',
  pid: 'as-is'
};

const PEER_KEYS_DB = `peer-keys.sqlite`;
const PEER_KEYS_DB_ATTR = `msg-index-db`;

interface PeerKeysDbFileAttr {
	dbVersion: 1;
}

async function setMsgIndexInfoIntoAttrOf(
	dbFile: WritableFile, info: Omit<PeerKeysDbFileAttr, 'dbVersion'>
): Promise<void> {
	const completeInfo: PeerKeysDbFileAttr = {
		dbVersion: 1,
		...info
	};
	await dbFile.updateXAttrs({
		set: { [PEER_KEYS_DB_ATTR]: completeInfo }
	});
}

async function readOrInitializeDB(dbsFS: WritableFS): Promise<SQLiteOnSyncedFS> {
  if (await dbsFS.checkFilePresence(PEER_KEYS_DB)) {
    const dbFile = await dbsFS.writableFile(PEER_KEYS_DB, { create: false });
    return await SQLiteOn3NStorage.makeSynced(dbFile);
  } else {
    const dbFile = await dbsFS.writableFile(PEER_KEYS_DB, { create: true, exclusive: true });
    const peerKeys = await SQLiteOn3NStorage.makeSynced(dbFile);
    peerKeys.db.run(queryToCreatePeerKeysDbV2);
    await setMsgIndexInfoIntoAttrOf(peerKeys.dbFile, {});
    await peerKeys.saveToFile();
    await peerKeys.dbFileSync.upload();
    await dbsFS.v!.sync!.upload('');
    return peerKeys;
  }
}

async function generatePids(random: AsyncRNG): Promise<string[]> {
  const pids: string[] = [];
  for (let i=0; i<5; i+=1) {
    pids[i] = await stringOfB64UrlSafeChars(PID_LENGTH, random);
    if (i > 0) {
      if (pids.slice(0, i).includes(pids[i])) {
        i -= 1;
      }
    }
  }
  return pids;
}


export async function makePeerKeysDB(peerKeysFS: WritableFS, random: AsyncRNG) {

  const keys = await readOrInitializeDB(peerKeysFS);

  let needToSave = false;
  function noteDbMotificationForFileSaving(): void {
    if (!needToSave && (keys.db.getRowsModified() > 0)) {
      needToSave = true;
    }
  }
  async function saveIfNeeded(): Promise<void> {
    if (needToSave) {
      await keys.saveToFile();
    }
  }

  function addPeer(peerAddr: string): void {
    const peerCAddr = toCanonicalAddress(peerAddr);
    keys.db.exec(
      `--sql
      INSERT INTO peers (peerCAddr, peerAddr) VALUES ($peerCAddr, $peerAddr) ON CONFLICT DO NOTHING`,
      { $peerCAddr: peerCAddr, $peerAddr: peerAddr }
    );
    noteDbMotificationForFileSaving();
  }

  function getSendingPair(peerCAddr: string): SendingKeyPairDbEntry|undefined {
    const pair = selectFromTable(keys.db, 'sending_key_pairs', '*', { peerCAddr }, sendingKeyPairsTabFields);
    return (pair ? pair[0] as SendingKeyPairDbEntry : undefined);
  }

  function addSendingPair(pair: SendingKeyPairDbEntry): void {
    performTableInsert(keys.db, 'sending_key_pairs', pair, sendingKeyPairsTabFields);
    noteDbMotificationForFileSaving();
  }

  function updateSendingPair(pair: Partial<SendingKeyPairDbEntry>): void {
    updateInTable(
      keys.db, 'sending_key_pairs', passOmitting(pair, 'peerCAddr'), { peerCAddr: pair.peerCAddr },
      sendingKeyPairsTabFields
    );
    noteDbMotificationForFileSaving();
  }

  function updateSentMsgCountInSendingPair(peerCAddr: string, sentMsgsCount: number): void {
    updateSendingPair({ peerCAddr, sentMsgLastTS: Date.now(), sentMsgsCount });
  }

  function updateSendingPairFromSuggested(
    peerCAddr: string, pair: SuggestedNextKeyPair, cryptoMaterial: Pick<SendingKeyPairDbEntry,
    'msgMasterKey' | 'msgMasterKeyAlg' | 'senderKId' | 'senderPKey' | 'senderSKey' | 'peerPKey'>
  ): void {
    updateSendingPair({
      ...cryptoMaterial,
      peerCAddr,
      pids: pair.pids,
      pairTS: pair.timestamp,
      peerKId: pair.recipientPKey.kid,
      sentMsgsCount: 0,
      sentMsgLastTS: 0
    });
  }

  function addSendingPairFromSuggested(
    peerCAddr: string, pair: SuggestedNextKeyPair, cryptoMaterial: Pick<SendingKeyPairDbEntry,
    'msgMasterKey' | 'msgMasterKeyAlg' | 'senderKId' | 'senderPKey' | 'senderSKey' | 'peerPKey' | 'pairAlg'>
  ): void {
    addSendingPair({
      ...cryptoMaterial,
      peerCAddr,
      pids: pair.pids,
      pairTS: pair.timestamp,
      peerKId: pair.recipientPKey.kid,
      sentMsgsCount: 0,
      sentMsgLastTS: 0
    });
  }

  function findKeyToMatchSuggestedForSendingPair(
    peerCAddr: string, thisSideKid: string
  ): { skey: Uint8Array; pkey: string; pairAlg: string; }|undefined {
    const pairs = selectFromTable(
      keys.db, 'reception_key_pairs',
      [ 'ratchetStage', 'recipientSKey', 'recipientPKey', 'pairAlg' ],
      { peerCAddr, recipientKId: thisSideKid }, receptionKeyPairsTabFields
    );
    if (pairs) {
      return {
        pkey: pairs[0].recipientPKey!,
        skey: pairs[0].recipientSKey!,
        pairAlg: pairs[0].pairAlg!
      };
    }
  }

  function getPeerAddressForCanonical(peerCAddr: string): string|undefined {
    const res = keys.db.exec(
      `--sql
      SELECT peerAddr FROM peers WHERE peerCAddr=$peerCAddr`,
      { '$peerCAddr': peerCAddr }
    );
    return ((res.length > 0) ? objectFromQueryExecResult<{ peerAddr: string }>(res[0])[0].peerAddr : undefined);
  }

  function addReceptionPair(pair: RecipientKeyPairDbEntry): void {
    performTableInsert(keys.db, 'reception_key_pairs', pair, receptionKeyPairsTabFields);
    const { peerCAddr, peerKId, pids, recipientKId } = pair;
    for (const pid of pids) {
      performTableInsert(
        keys.db, 'reception_key_pairs_pids', { peerCAddr, peerKId, pid, recipientKId }, pidsIndexTabFields
      );
    }
    noteDbMotificationForFileSaving();
  }

  function markPairAsInUse(peerCAddr: string, peerKId: string, recipientKId: string): boolean {
    const suggested = getPairSuggestedToPeer(peerCAddr);
    if((suggested?.senderKid !== peerKId) || (suggested?.recipientPKey.kid !== recipientKId)) {
      return false;
    }
    updateInTable(
      keys.db, 'reception_key_pairs',
      { ratchetStage: 'old' },
      { peerCAddr, ratchetStage: 'in_use' }, receptionKeyPairsTabFields
    );
    updateInTable(
      keys.db, 'reception_key_pairs',
      { ratchetStage: 'in_use' },
      { peerCAddr, peerKId, recipientKId }, receptionKeyPairsTabFields
    );
    const veryOld = selectFromTable(
      keys.db, 'reception_key_pairs',
      [ 'peerKId', 'recipientKId', 'pairTS' ],
      { peerCAddr, ratchetStage: 'old' }, receptionKeyPairsTabFields
    )?.sort((a, b) => (b.pairTS! - a.pairTS!)).slice(1);
    if (veryOld && (veryOld.length > 1)) {
      for (const { recipientKId, peerKId } of veryOld) {
        const whereParams = queryParamsFrom({ peerCAddr, recipientKId, peerKId }, receptionKeyPairsTabFields);
        const whereClause = andEqualExprFor(whereParams);
        keys.db.exec(
          `--sql
          DELETE FROM reception_key_pairs WHERE ${whereClause}`,
          whereParams
        );
      }
    }
    noteDbMotificationForFileSaving();
    return true;
  }

  function updateReceivedMsgCountIn(
    peerCAddr: string, peerKId: string, recipientKId: string, msgCount: number, msgTS: number
  ): void {
    const pair = selectFromTable(
      keys.db, 'reception_key_pairs',
      [ 'receivedMsgLastTS', 'receivedMsgsCounts' ],
      { peerCAddr, peerKId, recipientKId }, receptionKeyPairsTabFields
    );
    if (!pair) {
      return;
    }
    let { receivedMsgLastTS, receivedMsgsCounts } = pair[0];
    if (!addToNumberLineSegments(receivedMsgsCounts!, msgCount)) {
      return;
    }
    updateInTable(
      keys.db, 'reception_key_pairs',
      { receivedMsgsCounts, receivedMsgLastTS: Math.max(receivedMsgLastTS!, msgTS) },
      { peerCAddr, peerKId, recipientKId }, receptionKeyPairsTabFields
    );
    noteDbMotificationForFileSaving();
  }

  function findReceptionPairsForPId(pid: string): Pick<
    RecipientKeyPairDbEntry, 'peerCAddr' | 'peerKId' | 'recipientKId' | 'msgMasterKey' | 'ratchetStage' | 'pairAlg'
  >[]|undefined {
    const keyIds = selectFromTable(
      keys.db, 'reception_key_pairs_pids', [ 'peerCAddr', 'peerKId', 'recipientKId' ],
      { pid }, pidsIndexTabFields
    );
    if (!keyIds) {
      return;
    }
    const foundPairs: NonNullable<ReturnType<typeof findReceptionPairsForPId>> = [];
    for (const { peerCAddr, peerKId, recipientKId } of keyIds) {
      const key = selectFromTable(
        keys.db, 'reception_key_pairs', [ 'msgMasterKey', 'ratchetStage', 'pairAlg' ],
        { peerCAddr, peerKId, recipientKId }, receptionKeyPairsTabFields
      )!;
      const { msgMasterKey, ratchetStage, pairAlg } = key[0];
      foundPairs.push({
        msgMasterKey: msgMasterKey!, pairAlg: pairAlg!, peerCAddr: peerCAddr!,
        peerKId: peerKId!, ratchetStage: ratchetStage!, recipientKId: recipientKId!
      });
    }
    return ((foundPairs.length > 0) ? foundPairs : undefined);
  }

  async function absorbV1DataIfPresent(keyringFS: WritableFS) {
    const v1Entries = await checkIfV1AndReadPeerKeys(keyringFS);
    if (v1Entries) 
    for (const peer of v1Entries) {
      const peerCAddr = toCanonicalAddress(peer.correspondent);
      addPeer(peer.correspondent);
      if (peer.receptionPairs.suggested) {
        addReceptionPair(v1ReceptionPairToV2RecipientKeyPairDbEntry(
          peer.receptionPairs.suggested, 'suggested', peerCAddr
        ));
      }
      if (peer.receptionPairs.inUse) {
        addReceptionPair(v1ReceptionPairToV2RecipientKeyPairDbEntry(
          peer.receptionPairs.inUse, 'in_use', peerCAddr
        ));
      }
      if (peer.receptionPairs.old) {
        addReceptionPair(v1ReceptionPairToV2RecipientKeyPairDbEntry(
          peer.receptionPairs.old, 'old', peerCAddr
        ));
      }
      if (peer.sendingPair?.type === 'ratcheted') {
        addSendingPair(v1RatchetedSendingPairToV2SendingKeyPairDbEntry(peer.sendingPair, peerCAddr));
      }
    }
    await keys.saveToFile();
    await keys.dbFileSync.upload();
  }

  function getPairSuggestedToPeer(peerCAddr: string): SuggestedNextKeyPair|undefined {
    const pairs = selectFromTable(
      keys.db, 'reception_key_pairs',
      [ 'pids', 'isPeerIntroKey', 'peerKId', 'pairTS', 'recipientKId', 'recipientPKey' ],
      { peerCAddr, ratchetStage: 'suggested' }, receptionKeyPairsTabFields
    );
    if (!pairs) {
      return;
    }
    const { pids, peerKId, pairTS, recipientKId, recipientPKey } = pairs[0];
    return {
      pids: pids!,
      recipientPKey: {
        kid: recipientKId!,
        k: recipientPKey!
      },
      timestamp: pairTS!,
      senderKid: peerKId!
    };
  }

  async function generateSuggestedPairOnPeerIntroKey(
    peerCAddr: string, peerIntroPKey: JsonKey
  ): Promise<{ nextCrypto: SuggestedNextKeyPair; entryToLog: RecipientKeyPairDbEntry; }> {
    const { kid: peerKId, k: peerPKey } = peerIntroPKey;
    return await generateAndAddSuggestedPair(peerCAddr, peerKId, base64.open(peerPKey), false);
  }

  async function generateAndAddSuggestedPair(
    peerCAddr: string, peerKId: string, peerPKey: Uint8Array, isPeerIntroKey: boolean
  ): Promise<{ nextCrypto: SuggestedNextKeyPair; entryToLog: RecipientKeyPairDbEntry; }> {
    const recipientKey = await generateKeyPair(random);
    const recipientSKey = base64.open(recipientKey.skey.k);
    const msgMasterKey = box.calc_dhshared_key(peerPKey, recipientSKey);
    const pids = await generatePids(random);
    const pairTS = Date.now();
    const dbEntry: RecipientKeyPairDbEntry = {
      peerCAddr,
      ratchetStage: 'suggested',
      pids,
      pairTS,
      pairAlg: recipientKey.skey.alg,
      isPeerIntroKey,
      peerKId,
      peerPKey,
      recipientKId: recipientKey.pkey.kid,
      recipientPKey: recipientKey.pkey.k,
      recipientSKey,
      msgMasterKey,
      msgMasterKeyAlg: sbox.JWK_ALG_NAME,
      receivedMsgLastTS: null as any,
      receivedMsgsCounts: []
    };
    addReceptionPair(dbEntry);
    noteDbMotificationForFileSaving();
    return {
      nextCrypto: {
        pids,
        recipientPKey: {
          kid: recipientKey.pkey.kid,
          k: recipientKey.pkey.k
        },
        senderKid: peerKId,
        timestamp: pairTS
      },
      entryToLog: dbEntry
    };
  }

  async function generateRegularSuggestedPairIfNeeded(peerCAddr: string): Promise<{
    nextCrypto: SuggestedNextKeyPair; entryToLog: RecipientKeyPairDbEntry;
  }|undefined> {
    const pairsInUse = selectFromTable(
      keys.db, 'reception_key_pairs', ['pairTS'], { peerCAddr, ratchetStage: 'in_use' }, receptionKeyPairsTabFields
    );
    if (pairsInUse && ((pairsInUse[0].pairTS! + MIN_PERIOD_FOR_PAIR) > Date.now())) {
      return;
    }
    const sendingPair = getSendingPair(peerCAddr);
    if (!sendingPair) {
      throw new Error(`Regular sending pair should be present to use peer's key in next suggested crypto`);
    }
    const { peerKId, peerPKey } = sendingPair;
    return await generateAndAddSuggestedPair(peerCAddr, peerKId, peerPKey, false);
  }

	function getPeerKeysInfo(peerAddr: string): CorrespondentKeysInfo|undefined {
    const peerCAddr = toCanonicalAddress(peerAddr);
    const sp = getSendingPair(peerCAddr);
    const rpSuggested = selectFromTable(
      keys.db, 'reception_key_pairs', '*', { peerCAddr, ratchetStage: 'suggested' }, receptionKeyPairsTabFields
    );
    const rpInUse = selectFromTable(
      keys.db, 'reception_key_pairs', '*', { peerCAddr, ratchetStage: 'in_use' }, receptionKeyPairsTabFields
    );
    const rpOld = selectFromTable(
      keys.db, 'reception_key_pairs', '*', { peerCAddr, ratchetStage: 'old' }, receptionKeyPairsTabFields
    )?.sort((a, b) => (b.pairTS! - a.pairTS!));

    return {
      sendingPair: (sp ? {
        alg: sp.pairAlg,
        pids: sp.pids,
        type: 'ratcheted',
        timestamp: sp.pairTS,
        senderKId: sp.senderKId,
        recipientKId: sp.peerKId,
        sentMsgs: {
          count: sp.sentMsgsCount,
          lastTS: sp.sentMsgLastTS
        }
      } : null),
      receptionPairs: {
        suggested: (rpSuggested ? recipientKeyPairDbEntryIntoDisplayInfo(rpSuggested[0]) : null),
        inUse: (rpInUse ? recipientKeyPairDbEntryIntoDisplayInfo(rpInUse[0]) : null),
        old: (rpOld ? recipientKeyPairDbEntryIntoDisplayInfo(rpOld[0]) : null)
      }
    };
	}

  async function saveAndSync(): Promise<number> {
    await saveIfNeeded();
    const syncedIndexDbVersion = await keys.dbFileSync.upload();
		return syncedIndexDbVersion!;
  }

	// XXX at a startup we should check if current local latest is too old

	// XXX one should watch for reconnect event and run similar checks of possibly missed events

  async function absorbOpsFromOtherDevices(
    changeProc: SingleProc, ops: LogEntry<PairEvent>[]
  ): Promise<void> {
    await changeProc.startOrChain(async () => {
      for (const op of ops) {
        if (op.p) {
          if (op.p.opType === 'pair-from-peer') {
            const { peerAddr, sendingPairRecord: inJSON } = op.p;
            const existingPair = getSendingPair(inJSON.peerCAddr);
            if (existingPair) {
              if (existingPair.pairTS < inJSON.pairTS) {
                updateSendingPair(sendingPairEntryFromJSON(inJSON));
              } 
            } else {
              if (!getPeerAddressForCanonical(inJSON.peerCAddr)) {
                addPeer(peerAddr);
              }
              addSendingPair(sendingPairEntryFromJSON(inJSON));
            }
          } else if (op.p.opType === 'pair-suggested-to-peer') {
            const { peerAddr, receivingPairRecord: inJSON } = op.p;
            const existingPair = getPairSuggestedToPeer(inJSON.peerCAddr);
            if (existingPair) {
              if (existingPair.timestamp < inJSON.pairTS) {

                // XXX replace existingPair with one from inJSON
                //  let's note that in broken situation we may suggest fixing moves

              }
            } else {
              if (!getPeerAddressForCanonical(inJSON.peerCAddr)) {
                addPeer(peerAddr);
              }
              addReceptionPair(recipientPairEntryFromJSON(inJSON));
            }
          } else if (op.p.opType === 'peer-started-using-pair') {
            const { peerCAddr, peerKId, recipientKId } = op.p;
            markPairAsInUse(peerCAddr, peerKId, recipientKId);
          }
        } else if (op.syncPoint) {

          // XXX

        }
      }
      await saveIfNeeded();
    });
  }

  function watchAndApplyOpsFromOtherDevices(changeProc: SingleProc, resetSyncInterval: () => void): () => void {
    return keys.dbFile.watch({
      next: fsEvent => changeProc.startOrChain(async () => {
        if (fsEvent.type === 'remote-change') {

          // XXX get remote, compare,add to current what is missing, vs remote

          resetSyncInterval();
        }
      })
    });
  }

  return {
    saveIfNeeded,
    generateSuggestedPairOnPeerIntroKey,
    getPairSuggestedToPeer,
    generateRegularSuggestedPairIfNeeded,

    addPeer,

    getSendingPair,
    updateSentMsgCountInSendingPair,
    addSendingPairFromSuggested,
    updateSendingPairFromSuggested,
    findKeyToMatchSuggestedForSendingPair,

    addReceptionPair,
    markPairAsInUse,
    findReceptionPairsForPId,
    absorbV1DataIfPresent,
    getPeerAddressForCanonical,
    updateReceivedMsgCountIn,
    absorbOpsFromOtherDevices,
    watchAndApplyOpsFromOtherDevices,
    saveAndSync,

    getPeerKeysInfo
  };
}

function recipientKeyPairDbEntryIntoDisplayInfo(p: Partial<RecipientKeyPairDbEntry>): ReceptionPairInfo {
  return {
    alg: p.pairAlg!,
    pids: p.pids!,
    recipientKId: p.recipientKId!,
    senderKId: p.peerKId!,
    timestamp: p.pairTS!,
    isSenderIntroKey: p.isPeerIntroKey!,
    receivedMsgs: {
      counts: p.receivedMsgsCounts!,
      lastTS: p.receivedMsgLastTS!
    }
  };
}


Object.freeze(exports);
