/*
 Copyright (C) 2015 - 2018, 2025 - 2026 3NSoft Inc.
 
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

import { ParamOnServer } from '../../../lib-client/asmail/service-config';
import { initSyncedFile, watchAndApplyChangesFromOtherDevices } from '../../../lib-common/dataset-sync/single-file';
import { ConnectException } from '../../../lib-common/exceptions/http';
import { getKeyCert, getPubKey } from '../../../lib-common/jwkeys';
import { AsyncRNG } from '../../../lib-common/rng-def';
import { GetSigner } from '../../id-manager';
import { generateKeyPair, JWKeyPair, MsgKeyRole } from '../common';

type WritableFS = web3n.files.WritableFS;
type IntroKeyCAP = web3n.keys.Keyrings['introKeyOnASMailServer'];
type PKeyCertChain = web3n.keys.PKeyCertChain;

interface PublishedIntroKeysJSON {
	current?: {
		keyPair: JWKeyPair;
		certs: PKeyCertChain;
	};
	previous: JWKeyPair[];
}

const INTRO_KEY_VALIDITY = 31*24*60*60;
const UPDATE_BEFORE_EXPIRY = 7*24*60*60;
const MAX_NUM_OF_PREV = 3;

const INTRO_KEY_ON_SERVER_FILE = `published-on-server.json`;


export async function makeHolderOfPublishedIntroKey(
	introKeysFS: WritableFS, getSigner: GetSigner, random: AsyncRNG, pkeyOnServer: ParamOnServer<'init-pub-key'>
) {

	const {
		file: keysFile, changeProc
	} = await initSyncedFile(
		introKeysFS, INTRO_KEY_ON_SERVER_FILE,
		newFile => newFile.writeJSON({ previous: [] } as PublishedIntroKeysJSON)
	);

	let keys = await keysFile.readJSON<PublishedIntroKeysJSON>();

	async function onChangeFromOtherDevices(newVersion: number) {
		changeProc.startOrChain(async () => {
			const { version, json } = await keysFile.v!.readJSON<PublishedIntroKeysJSON>();
			if (version === newVersion) {
				keys = json;
			}
		});
	}

	const {
		stopFileWatching, triggerUpload
	} = watchAndApplyChangesFromOtherDevices(
		keysFile, changeProc, onChangeFromOtherDevices, doOnConflict
	);

	if (keysFile.isNew) {
		await update();
	} else {
		updateIfCurrentExpired();
	}

	let periodicExpiryCheck = setTimeout(updateIfCurrentExpired, UPDATE_BEFORE_EXPIRY*1000/20);
	periodicExpiryCheck.unref?.();

	async function makeNewIntroKey(): Promise<{ pair: JWKeyPair; certs: PKeyCertChain; }> {
		const signer = await getSigner();
		const pair = await generateKeyPair(random);
		const certs: PKeyCertChain = {
			pkeyCert: signer.certifyPublicKey(pair.pkey, INTRO_KEY_VALIDITY),
			userCert: signer.userCert,
			provCert: signer.providerCert
		};
		pair.createdAt = Date.now();
		return { pair, certs };
	}

	function update(): Promise<PKeyCertChain> {
		return changeProc.startOrChain(async () => {
			const { certs, pair: keyPair } = await makeNewIntroKey();
			await pkeyOnServer.setOnServer(certs);
			retireCurrent(keyPair.createdAt!);
			keys.current = { keyPair, certs };
			await keysFile.writeJSON(keys);
			triggerUpload();
			return certs;
		});
	};

	function retireCurrent(retiredAt: number): void {
		if (!keys.current) {
			return;
		}
		const current = keys.current;
		current.keyPair.retiredAt = retiredAt;
		keys.previous.push(current.keyPair);
		if (keys.previous.length > MAX_NUM_OF_PREV) {
			keys.previous.splice(0, keys.previous.length - MAX_NUM_OF_PREV);
		}
		keys.current = undefined;
	}

	function doOnConflict() {
		return changeProc.startOrChain(async () => {
			const { remote, state } = await keysFile.v!.sync!.status(false);
			if ((state !== 'conflicting') || !remote?.latest) {
				return;
			}
			const onRemote = (await keysFile.v!.readJSON<PublishedIntroKeysJSON>({ remoteVersion: remote.latest })).json;
			if (onRemote.current?.keyPair.pkey.kid === keys.current?.keyPair.pkey.kid) {
				await keysFile.v!.sync!.adoptRemote();
				return;
			}
			const certsOnServer = await pkeyOnServer.getFromServer();
			const currentOnServer = (certsOnServer ? getPubKey(certsOnServer.pkeyCert) : undefined);
			if (currentOnServer?.kid === keys.current?.keyPair.pkey.kid) {
				await keysFile.v!.sync!.upload({ uploadVersion: remote.latest! + 1 });
			} else if (currentOnServer?.kid === onRemote.current?.keyPair.pkey.kid) {
				await keysFile.v!.sync!.adoptRemote({ remoteVersion: remote.latest });
			} else {
				await pkeyOnServer.setOnServer(keys.current?.certs ?? null);
				await keysFile.v!.sync!.upload({ uploadVersion: remote.latest! + 1 });
			}
		});
	}

	/**
	 * This looks for a published key with a given key id. If it is found, an
	 * object is returned with following fields:
	 * - pair is JWK key pair;
	 * - role of a found key pair;
	 * - replacedAt field is present for a previously published key pair,
	 * telling, in milliseconds, when this key was superseded a newer one.
	 * Undefined is returned, when a key is not found.
	 * @param kid
	 * @return if key is found, object with following fields is returned:
	 */
	function find(kid: string): {
		role: MsgKeyRole; pair: JWKeyPair; replacedAt?: number;
	}|undefined {

		// check current key
		if (keys.current
		&& (keys.current.keyPair.skey.kid === kid)) {
			return {
				role: 'published_intro',
				pair: keys.current.keyPair
			};
		}

		// check previous key
		const pair = keys.previous.find(({ skey }) => (skey.kid === kid));
		if (pair) {
			return {
				role: 'prev_published_intro',
				pair,
				replacedAt: pair.retiredAt
			};
		}

		// if nothing found, explicitly return undefined
		return;	
	}

	function makeIntroKeyCAP(): IntroKeyCAP {
		const w: IntroKeyCAP = {
			getCurrent,
			makeAndPublishNew: update,
			remove: removeCurrent
		};
		return Object.freeze(w);
	}

	async function getCurrent(): Promise<PKeyCertChain|null> {
		const certs = keys.current?.certs;
		return (certs ? certs : null);
	}

	async function removeCurrent(): Promise<void> {
		if (!keys.current) {
			return;
		}
		return changeProc.startOrChain(async () => {
			await pkeyOnServer.setOnServer(null);
			retireCurrent(Math.floor(Date.now()/1000));
			await keysFile.writeJSON(keys);
			triggerUpload();
		});
	}

	function updateIfCurrentExpired(): void {
		if (!keys.current) {
			return;
		}
		const { pkeyCert } = keys.current.certs;
		const expiryInSeconds = getKeyCert(pkeyCert).expiresAt;
		const now = Math.floor(Date.now() / 1000);
		if (expiryInSeconds < (now + UPDATE_BEFORE_EXPIRY)) {
			update();
		}
	}

	async function close(): Promise<void> {
		stopFileWatching();
		if (periodicExpiryCheck) {
			clearTimeout(periodicExpiryCheck);
			periodicExpiryCheck = undefined as any;
		}
	}

	return {
		startExpiryCheckProcess: updateIfCurrentExpired,
		close,
		makeIntroKeyCAP,
		find
	}
}


Object.freeze(exports);