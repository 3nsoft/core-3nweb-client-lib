/*
 Copyright (C) 2015 - 2020 3NSoft Inc.
 
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

import { utf8 } from '../../../lib-common/buffer-utils';
import { errWithCause } from '../../../lib-common/exceptions/error';
import * as confApi from '../../../lib-common/service-api/asmail/config';
import { MsgEnvelope, MainBody, SuggestedNextKeyPair, SendingParams }
	from './common';
import { makeSegmentsReader, AsyncSBoxCryptor, idToHeaderNonce, makeDecryptedByteSource, ObjSource } from 'xsp-files';
import { FolderInfoWithAttrs } from '../../../lib-client/3nstorage/xsp-fs/common';
import { MsgKeyRole } from '../keyring';

export { SuggestedNextKeyPair } from './common';

export class OpenedMsg {
	
	private msgKeyRole: MsgKeyRole|undefined = undefined;

	constructor(
			public msgId: string,
			private main: MsgEnvelope) {
		Object.seal(this);
	}
	
	get establishedKeyChain(): boolean {
		if (!this.msgKeyRole) { throw new Error(
			`Key role is not set in incoming message ${this.msgId}`); }
		return (this.msgKeyRole === 'suggested') ||
			(this.msgKeyRole === 'in_use') ||
			(this.msgKeyRole === 'old');
	}

	setMsgKeyRole(msgKeyRole: MsgKeyRole): void {
		if (this.msgKeyRole) { throw new Error(
			`Cannot set key role twice in incoming message ${this.msgId}`); }
		this.msgKeyRole = msgKeyRole;
	}

	getSection<N extends keyof MsgEnvelope>(name: N): MsgEnvelope[typeof name] {
		return this.main[name];
	}

	get sender(): string {
		return this.main['From'];
	}
	
	get mainBody(): MainBody {
		const body = this.getSection('Body');
		return (body ? body : {});
	}
	
	get nextCrypto(): SuggestedNextKeyPair|undefined {
		return this.getSection('Flow Params').nextCrypto;
	}
	
	get msgCount(): number {
		return this.getSection('Flow Params').msgCount;
	}

	get nextSendingParams(): SendingParams|undefined {
		return this.getSection('Flow Params').nextSendingParams;
	}

	get introCryptoCerts(): confApi.p.initPubKey.Certs {
		const certs = this.getSection('Flow Params').introCerts;
		if (!certs) { throw new Error(
			`Message is missing crypto certs for introductory key, used by sender`); }
		return certs;
	}

	get attachmentsJSON(): FolderInfoWithAttrs|undefined {
		return this.getSection('Attachments');
	}
	
}
Object.freeze(OpenedMsg.prototype);
Object.freeze(OpenedMsg);


export async function openMsg(msgId: string, mainObjId: string,
		mainObj: ObjSource, headerOfs: number, fKey: Uint8Array,
		cryptor: AsyncSBoxCryptor): Promise<OpenedMsg> {
	try {
		const header = await mainObj.readHeader();
		const segReader = await makeSegmentsReader(
			fKey, idToHeaderNonce(mainObjId), 0,
			header.subarray(headerOfs), cryptor)
		const byteSrc = await makeDecryptedByteSource(
			mainObj.segSrc, segReader);
		const bytes = await byteSrc.read(undefined);
		if (!bytes) { throw new Error(`End of bytes is reached too soon`); }
		const jsonOfMain = JSON.parse(utf8.open(bytes));
		return new OpenedMsg(msgId, jsonOfMain);
	} catch (err) {
		throw errWithCause(err, `Cannot open main object of message ${msgId}`);
	}
}

Object.freeze(exports);