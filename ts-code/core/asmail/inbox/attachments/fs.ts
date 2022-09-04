/*
 Copyright (C) 2016 - 2019, 2022 3NSoft Inc.
 
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

import { Storage, NodesContainer, StorageGetter, FolderInJSON, LocalObjStatus, ObjId } from '../../../../lib-client/3nstorage/xsp-fs/common';
import { XspFS } from '../../../../lib-client/3nstorage/xsp-fs/fs';
import { AsyncSBoxCryptor, ObjSource } from 'xsp-files';
import { MsgOnDisk } from '../msg-on-disk';
import { LogError } from '../../../../lib-client/logging/log-to-file';

type FSType = web3n.files.FSType;
type ReadonlyFS = web3n.files.ReadonlyFS;


class AttachmentStore implements Storage {

	public readonly type = 'asmail-msg';
	public readonly versioned = false;

	public readonly nodes = new NodesContainer();

	public readonly connect = undefined;

	constructor(
		private readonly msg: MsgOnDisk,
		private readonly getStorages: StorageGetter,
		public readonly cryptor: AsyncSBoxCryptor,
		public readonly logError: LogError
	) {
		Object.seal(this);
	}

	getNodeEvents(): never {
		throw new Error(`Attachment's storage is readonly.`);
	}

	broadcastNodeEvent(): never {
		throw new Error(`Attachment's storage is readonly.`);
	}

	storageForLinking(type: FSType, location?: string): Storage {
		if (type === 'share') {
			return this.getStorages('share', location);
		} else {
			throw new Error(`Attachment's storage cannot link to ${type} storage.`);
		}
	}

	status(): never {
		throw new Error(`Attachment's storage is not versioned`);
	}

	generateNewObjId(): never {
		throw new Error(`Attachment's storage is readonly.`);
	}

	getObjSrc(objId: string): Promise<ObjSource> {
		if (typeof objId !== 'string') { throw new Error(`Attachment's storage uses only string objId's, while given parameter is: ${objId}`); }
		return this.msg.getMsgObj(objId);
	}
	
	saveObj(): never {
		throw new Error(`Attachment's storage is readonly.`);
	}

	removeObj(): never {
		throw new Error(`Attachment's storage is readonly.`);
	}
	
	async close(): Promise<void> {}

}
Object.freeze(AttachmentStore.prototype);
Object.freeze(AttachmentStore);


export function fsForAttachments(
	msg: MsgOnDisk, rootJson: FolderInJSON, storages: StorageGetter,
	cryptor: AsyncSBoxCryptor, logError: LogError
): ReadonlyFS {
	const storage = new AttachmentStore(msg, storages, cryptor, logError);
	const fs = XspFS.fromASMailMsgRootFromJSON(storage, rootJson, 'attachments');
	return fs;
}


Object.freeze(exports);