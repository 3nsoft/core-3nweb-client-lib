/*
 Copyright (C) 2015 - 2018, 2025 3NSoft Inc.
 
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

import { ParamOnServer } from '../../lib-client/asmail/service-config';
import { JsonFileProc } from '../../lib-client/xsp-fs/util/file-based-json';
import { getKeyCert } from '../../lib-common/jwkeys';
import { GetSigner } from '../id-manager';
import { generateKeyPair, JWKeyPair, MsgKeyRole } from './common';

const INTRO_KEY_VALIDITY = 31*24*60*60;
const UPDATE_BEFORE_EXPIRY = 7*24*60*60;

type FileEvent = web3n.files.FileEvent;
type WritableFile = web3n.files.WritableFile;
type IntroKeyCAP = web3n.keys.Keyrings['introKeyOnASMailServer'];
type PKeyCertChain = web3n.keys.PKeyCertChain;

interface PublishedIntroKeysJSON {
	current?: {
		keyPair: JWKeyPair;
		certs: PKeyCertChain;
	};
	previous: JWKeyPair[];
}


export class PublishedIntroKey {

	private published: PublishedIntroKeysJSON = {
		previous: []
	};
	private readonly fileProc: JsonFileProc<PublishedIntroKeysJSON>;
	private periodicExpiryCheck: ReturnType<typeof setTimeout>|undefined = undefined;

	private constructor(
		private readonly getSigner: GetSigner,
		private pkeyOnServer: ParamOnServer<'init-pub-key'>
	) {
		this.fileProc = new JsonFileProc(this.onFileEvent.bind(this));
		Object.seal(this);
	}

	static async makeAndInit(
		file: WritableFile, getSigner: GetSigner,
		pkeyOnServer: ParamOnServer<'init-pub-key'>
	): Promise<PublishedIntroKey> {
		const pk = new PublishedIntroKey(getSigner, pkeyOnServer);
		if (file.isNew) {
			await pk.fileProc.start(file, () => pk.toFileJSON());
			await pk.update();
		} else {
			await pk.fileProc.start(file, undefined as any);
			pk.setFromJSON((await pk.fileProc.get()).json);
			await pk.absorbRemoteChanges();
			pk.startExpiryCheckProcess(true);
		}
		return pk;
	}

	private startExpiryCheckProcess(calledInInit = false): void {
		if (!calledInInit && !this.periodicExpiryCheck) {
			return;
		}
		if (this.published.current) {
			const { pkeyCert } = this.published.current.certs;
			const expiryInSeconds = getKeyCert(pkeyCert).expiresAt;
			const now = Math.floor(Date.now() / 1000);
			if (expiryInSeconds < (now + UPDATE_BEFORE_EXPIRY)) {
				this.update();
			}
		}
		if (calledInInit) {
			this.periodicExpiryCheck = setTimeout(
				() => this.startExpiryCheckProcess(),
				UPDATE_BEFORE_EXPIRY*1000/20
			).unref();
		}
	}

	async close(): Promise<void> {
		if (this.periodicExpiryCheck) {
			clearTimeout(this.periodicExpiryCheck);
			this.periodicExpiryCheck = undefined;
		}
		await this.fileProc.close();
	}

	private async onFileEvent(ev: FileEvent): Promise<void> {
		if (ev.src === 'local') { return; }
		switch (ev.type) {
			case 'file-change':
				await this.fileProc.order.startOrChain(
					() => this.absorbRemoteChanges()
				);
				break;
			case 'removed':
				throw new Error(
					`Unexpected removal of file with parameter "anon-sender/invites"`
				);
			default:
				return;
		}
	}

	private setFromJSON(json: PublishedIntroKeysJSON): void {
		if (!Array.isArray(json.previous)) {	// migration part
			json.previous = (json.previous ? [ json.previous ] : []);
		}
		this.published = json;
	}

	private toFileJSON(): PublishedIntroKeysJSON {
		return this.published;
	}

	// private toServerParam(): PKeyCertChain|undefined {
	// 	return this.published.current?.certs;
	// }

	private async absorbRemoteChanges(): Promise<void> {
		// XXX
		//  - check for changes: what is needed here from fileProc, and what is
		//    generic in absorbing remote changes to refactor it into JsonFileProc
		//  - absorb and sync, if needed: what can be in JsonFileProc
		// Code from pre-v.sync:
		// const { json } = await this.fileProc.get();
		// this.setFromJSON(json);
	}

	private async makeNewIntroKey(): Promise<{
		pair: JWKeyPair, certs: PKeyCertChain
	}> {
		const signer = await this.getSigner();
		const pair = await generateKeyPair();
		const certs: PKeyCertChain = {
			pkeyCert: signer.certifyPublicKey(pair.pkey, INTRO_KEY_VALIDITY),
			userCert: signer.userCert,
			provCert: signer.providerCert
		};
		pair.createdAt = Date.now();
		return { pair, certs };
	}

	private update(): Promise<PKeyCertChain> {
		return this.fileProc.order.startOrChain(async () => {
			const { certs, pair: keyPair } = await this.makeNewIntroKey();
			await this.pkeyOnServer.setOnServer(certs);
			this.retireCurrent(keyPair.createdAt!);
			this.published.current = { keyPair, certs };
			await this.fileProc.save(this.toFileJSON(), false);
			return certs;
		});
	};

	private retireCurrent(retiredAt: number): void {
		if (!this.published.current) {
			return;
		}
		const current = this.published.current;
		current.keyPair.retiredAt = retiredAt;
		this.published.previous.push(current.keyPair);
		this.published.current = undefined;
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
	find(kid: string): {
		role: MsgKeyRole; pair: JWKeyPair; replacedAt?: number;
	}|undefined {

		// check current key
		if (this.published.current
		&& (this.published.current.keyPair.skey.kid === kid)) {
			return {
				role: 'published_intro',
				pair: this.published.current.keyPair
			};
		}

		// check previous key
		const pair = this.published.previous.find(({ skey }) => (skey.kid === kid));
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

	makeIntroKeyCAP(): IntroKeyCAP {
		const w: IntroKeyCAP = {
			getCurrent: this.getCurrent.bind(this),
			makeAndPublishNew: this.update.bind(this),
			remove: this.removeCurrent.bind(this)
		};
		return Object.freeze(w);
	}

	private async getCurrent(): Promise<PKeyCertChain|null> {
		const certs = this.published.current?.certs;
		return (certs ? certs : null);
	}

	private async removeCurrent(): Promise<void> {
		if (!this.published.current) {
			return;
		}
		return this.fileProc.order.startOrChain(async () => {
			await this.pkeyOnServer.setOnServer(null);
			this.retireCurrent(Math.floor(Date.now()/1000));
		});
	}

}
Object.freeze(PublishedIntroKey.prototype);
Object.freeze(PublishedIntroKey);


Object.freeze(exports);