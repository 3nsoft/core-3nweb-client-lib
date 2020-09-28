/*
 Copyright (C) 2015 - 2018 3NSoft Inc.
 
 This program is free software: you can redistribute it and/or modify it under
 the terms of the GNU General Public License as published by the Free Software
 Foundation, either version 3 of the License, or (at your option) any later
 version.
 
 This program is distributed in the hope that it will be useful, but
 WITHOUT ANY WARRANTY; without even the implied warranty of
 MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 See the GNU General Public License for more details.
 
 You should have received a copy of the GNU General Public License along with
 this program. If not, see <http://www.gnu.org/licenses/>. */

import { MailConfigurator } from '../../../lib-client/asmail/service-config';
import * as api from '../../../lib-common/service-api/asmail/config';
import { GetSigner } from '../../id-manager';
import { generateKeyPair, JWKeyPair } from '../keyring/common';
import { ParamOnFileAndServer } from './common';
import { ConfigOfASMailServer } from '../config';

const INTRO_KEY_VALIDITY = 31*24*60*60;

export type Certs = api.p.initPubKey.Certs;

interface PublishedIntroKeysJSON {
	current?: {
		keyPair: JWKeyPair;
		certs: Certs;
	};
	previous?: JWKeyPair;
}

type ExposedFuncs = ConfigOfASMailServer['publishedKeys'];

export class PublishedIntroKey
		extends ParamOnFileAndServer<PublishedIntroKeysJSON, Certs> {

	private published: PublishedIntroKeysJSON = (undefined as any);

	constructor(
		private getSigner: GetSigner,
		serviceConf: MailConfigurator
	) {
		super(api.p.initPubKey.URL_END, serviceConf);
		Object.seal(this);
	}

	protected async initStruct(): Promise<void> {
		const newPair = await this.makeNewIntroKey();
		this.published = {
			current: {
				keyPair: newPair.pair,
				certs: newPair.certs
			}
		};
	}

	protected setFromJSON(json: PublishedIntroKeysJSON): void {
		this.published = json;
	}

	protected toFileJSON(): PublishedIntroKeysJSON {
		return this.published;
	}

	protected toServiceJSON(): Certs {
		return this.published.current!.certs;
	}

	private async makeNewIntroKey(): Promise<{ pair: JWKeyPair, certs: Certs }> {
		const signer = await this.getSigner();
		const pair = await generateKeyPair();
		const certs: Certs = {
			pkeyCert: signer.certifyPublicKey(pair.pkey, INTRO_KEY_VALIDITY),
			userCert: signer.userCert,
			provCert: signer.providerCert
		};
		pair.createdAt = Date.now();
		return { pair, certs };
	}

	update: ExposedFuncs['update'] = async () => {
		const newKey = await this.makeNewIntroKey();
		if (this.published.current) {
			this.published.current.keyPair.retiredAt = newKey.pair.createdAt;
			this.published.previous = this.published.current.keyPair;
		}
		this.published.current = {
			keyPair: newKey.pair,
			certs: newKey.certs
		};
		await this.save();
	};

	find: ExposedFuncs['find'] = (kid) => {

		// check current key
		if (this.published.current
		&& (this.published.current.keyPair.skey.kid === kid)) {
			return {
				role: 'published_intro',
				pair: this.published.current.keyPair
			};
		}

		// check previous key
		if (this.published.previous
		&& (this.published.previous.skey.kid === kid)) {
			return {
				role: 'prev_published_intro',
				pair: this.published.previous,
				replacedAt: this.published.previous.retiredAt
			};
		}

		// if nothing found, explicitly return undefined
		return;	
	}

}
Object.freeze(PublishedIntroKey.prototype);
Object.freeze(PublishedIntroKey);

Object.freeze(exports);