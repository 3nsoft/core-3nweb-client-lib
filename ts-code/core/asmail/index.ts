/*
 Copyright (C) 2015 - 2018, 2020 - 2022 3NSoft Inc.
 
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

import { InboxOnServer } from './inbox';
import { errWithCause } from '../../lib-common/exceptions/error';
import { KeyRing, makeAndKeyRing } from './keyring';
import { ConfigOfASMailServer } from './config';
import { InboxPathForUser } from '../app-files';
import { Delivery } from './delivery';
import { StorageGetter } from '../../lib-client/3nstorage/xsp-fs/common';
import { GetSigner } from '../id-manager';
import { AsyncSBoxCryptor } from 'xsp-files';
import { SendingParamsHolder } from './sending-params';
import { Logger } from '../../lib-client/logging/log-to-file';
import { ServiceLocator, ServiceLocatorMaker } from '../../lib-client/service-locator';
import { MakeNet } from '..';
import { getOrMakeAndUploadFolderIn, getRemoteFolderChanges, uploadFolderChangesIfAny } from '../../lib-client/fs-utils/fs-sync-utils';

type WritableFS = web3n.files.WritableFS;
type Service = web3n.asmail.Service;

const KEYRING_DATA_FOLDER = 'keyring';
const INBOX_DATA_FOLDER = 'inbox';
const CONFIG_DATA_FOLDER = 'config';
const DELIVERY_DATA_FOLDER = 'delivery';
const SEND_PARAMS_DATA_FOLDER = 'sending-params';

export type MailCAPMaker = () => Service;


export class ASMail {

	private keyring: KeyRing = (undefined as any);
	private address: string = (undefined as any);
	private inbox: InboxOnServer = (undefined as any);
	private delivery: Delivery = (undefined as any);
	private config: ConfigOfASMailServer = (undefined as any);
	private sendingParams: SendingParamsHolder = (undefined as any);

	constructor(
		private readonly cryptor: AsyncSBoxCryptor,
		private readonly makeNet: MakeNet,
		private readonly inboxPathForUser: InboxPathForUser,
		private readonly logger: Logger
	) {
		Object.seal(this);
	}

	async init(
		address: string, getSigner: GetSigner,
		syncedFS: WritableFS, localFS: WritableFS,
		getStorages: StorageGetter, makeResolver: ServiceLocatorMaker
	): Promise<void> {
		try {
			this.address = address;

			await getRemoteFolderChanges(syncedFS);

			await this.setupConfig(getSigner, syncedFS, makeResolver('asmail'));

			await Promise.all([
				this.setupKeyring(syncedFS),
				this.setupSendingParams(syncedFS)
			]);

			await Promise.all([
				this.setupInbox(
					syncedFS, getSigner, getStorages, makeResolver
				),
				this.setupDelivery(localFS, getSigner, makeResolver)
			]);

			await uploadFolderChangesIfAny(syncedFS);
			await syncedFS.close();
			await localFS.close();
		} catch (err) {
			throw errWithCause(err, 'Failed to initialize ASMail');
		}
	}

	private async setupConfig(
		getSigner: GetSigner, syncedFS: WritableFS, resolver: ServiceLocator
	): Promise<void> {
		const fs = await getOrMakeAndUploadFolderIn(syncedFS, CONFIG_DATA_FOLDER);
		this.config = await ConfigOfASMailServer.makeAndStart(
			this.address, getSigner, resolver, this.makeNet(), fs
		);
	}

	private async setupKeyring(syncedFS: WritableFS): Promise<void> {
		const fs = await getOrMakeAndUploadFolderIn(
			syncedFS, KEYRING_DATA_FOLDER
		);
		this.keyring = await makeAndKeyRing(
			this.cryptor, fs, this.config.publishedKeys
		);
	}

	private async setupSendingParams(syncedFS: WritableFS): Promise<void> {
		const fs = await getOrMakeAndUploadFolderIn(
			syncedFS, SEND_PARAMS_DATA_FOLDER
		);
		this.sendingParams = await SendingParamsHolder.makeAndStart(
			fs, this.config.anonSenderInvites
		);
	}

	private async setupDelivery(
		localFS: WritableFS, getSigner: GetSigner,
		makeResolver: ServiceLocatorMaker
	): Promise<void> {
		const fs = await localFS.writableSubRoot(DELIVERY_DATA_FOLDER);
		this.delivery = await Delivery.makeAndStart(fs, {
			address: this.address,
			cryptor: this.cryptor,
			getSigner,
			asmailResolver: makeResolver('asmail'),
			midResolver: makeResolver('mailerid'),
			correspondents: {
				needIntroKeyFor: this.keyring.needIntroKeyFor,
				generateKeysToSend: this.keyring.generateKeysToSend,
				nextCrypto: this.keyring.nextCrypto,
				paramsForSendingTo: this.sendingParams.otherSides.get,
				newParamsForSendingReplies: this.sendingParams.thisSide.getUpdated
			},
			notifyMsgProgress: () => { throw new Error(`Method not set`); },
			makeNet: this.makeNet,
			logError: this.logger.logError,
			logWarning: this.logger.logWarning
		});
	}

	private async setupInbox(
		syncedFS: WritableFS, getSigner: GetSigner,
		getStorages: StorageGetter, makeResolver: ServiceLocatorMaker
	): Promise<void> {
		const cachePath = this.inboxPathForUser(this.address);
		const inboxSyncedFS = await getOrMakeAndUploadFolderIn(
			syncedFS, INBOX_DATA_FOLDER
		);
		this.inbox = await InboxOnServer.makeAndStart(
			cachePath, inboxSyncedFS,
			{
				address: this.address,
				cryptor: this.cryptor,
				getSigner,
				getStorages,
				asmailResolver: makeResolver('asmail'),
				correspondents: {
					msgDecryptor: this.keyring.decrypt,
					markOwnSendingParamsAsUsed: this.sendingParams.thisSide.setAsUsed,
					saveParamsForSendingTo: this.sendingParams.otherSides.set,
					midResolver: makeResolver('mailerid')
				},
				makeNet: this.makeNet,
				logError: this.logger.logError
			}
		);
	}

	makeASMailCAP(): Service {
		const w: Service = {
			getUserId: async () => this.address,
			delivery: this.delivery.wrap(),
			inbox: this.inbox.wrap(),
		};
		return Object.freeze(w);
	};

	async close(): Promise<void> {
		await this.inbox.close();
		await this.keyring.close();
	}

}
Object.freeze(ASMail.prototype);
Object.freeze(ASMail);


Object.freeze(exports);