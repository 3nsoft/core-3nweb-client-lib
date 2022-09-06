/*
 Copyright (C) 2015 - 2018, 2021 3NSoft Inc.
 
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

import { ServiceLocator } from '../../../lib-client/service-locator';
import { MailConfigurator } from '../../../lib-client/asmail/service-config';
import { ensureCorrectFS } from '../../../lib-common/exceptions/file';
import { errWithCause } from '../../../lib-common/exceptions/error';
import { GetSigner } from '../../id-manager';
import { Invites, makeInvites } from './invitations-anon';
import { PublishedIntroKey, makePublishedIntroKey } from './published-intro-key';
import { MsgKeyRole } from '../keyring';
import { JWKeyPair } from '../keyring/common';
import { NetClient } from '../../../lib-client/request-utils';

type WritableFS = web3n.files.WritableFS;

const ANON_SENDER_INVITES_FILE = 'anonymous/invites.json';
const INTRO_KEY_FILE = 'introductory-key.json';


/**
 * Instance of this class updates and checks setting of ASMail server.
 */
export class ConfigOfASMailServer {
	
	private anonInvites: Invites;
	private publishedIntroKeys: PublishedIntroKey;

	anonSenderInvites: {
		getAll: () => Map<string, { invite: string; msgMaxSize: number; }>;
		create: (label: string, msgMaxSize: number) => Promise<string>;
		setMsgMaxSize: (label: string, msgMaxSize: number) => Promise<void>;
	};

	publishedKeys: {
		/**
		 * This generates a new NaCl's box key pair, as a new introductory
		 * published key.
		 */
		update: () => Promise<void>;

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
		find: (kid: string) => {
			role: MsgKeyRole; pair: JWKeyPair; replacedAt?: number;
		}|undefined;
	};

	private constructor(
		address: string, getSigner: GetSigner,
		resolver: ServiceLocator, net: NetClient
	) {
		const serviceConf = new MailConfigurator(
			address, getSigner, () => resolver(serviceConf.userId), net
		);
		this.anonInvites = makeInvites(serviceConf);
		this.publishedIntroKeys = makePublishedIntroKey(getSigner, serviceConf);
		
		this.anonSenderInvites = {
			getAll: this.anonInvites.getAll,
			create: this.anonInvites.create,
			setMsgMaxSize: this.anonInvites.setMsgMaxSize
		};
		Object.freeze(this.anonSenderInvites);
		
		this.publishedKeys = {
			update: this.publishedIntroKeys.update,
			find: this.publishedIntroKeys.find
		};
		Object.freeze(this.publishedKeys);
		
		Object.freeze(this);
	}

	static async makeAndStart(
		address: string, getSigner: GetSigner,
		resolver: ServiceLocator, net: NetClient, fs: WritableFS
	): Promise<ConfigOfASMailServer> {
		try {
			ensureCorrectFS(fs, 'synced', true);
			const conf = new ConfigOfASMailServer(
				address, getSigner, resolver, net
			);
			await Promise.all([
				fs.writableFile(ANON_SENDER_INVITES_FILE)
				.then(f => conf.anonInvites.start(f)),

				fs.writableFile(INTRO_KEY_FILE)
				.then(f => conf.publishedIntroKeys.start(f)),

			]);
			await fs.close();
			return conf;
		} catch (err) {
			throw errWithCause(err, 'Failed to initialize ConfigOfASMailServer');
		}
	}

}
Object.freeze(ConfigOfASMailServer.prototype);
Object.freeze(ConfigOfASMailServer);


Object.freeze(exports);