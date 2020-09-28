/*
 Copyright (C) 2015 - 2018, 2020 3NSoft Inc.

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

import { secret_box as sbox } from 'ecma-nacl';
import { SegmentsWriter, KEY_LENGTH, makeSegmentsWriter, AsyncSBoxCryptor, idToHeaderNonce, makeObjSourceFromArrays, makeEncryptingObjSource, ObjSource, ByteSource }
	from 'xsp-files';
import * as delivApi from '../../../lib-common/service-api/asmail/delivery';
import * as random from '../../../lib-common/random-node';
import { base64, base64urlSafe, utf8 } from '../../../lib-common/buffer-utils';
import { FolderInfoWithAttrs } from '../../../lib-client/3nstorage/xsp-fs/common';
import { serializeFolderInfo }
	from '../../../lib-client/3nstorage/xsp-fs/folder-node-serialization';
import { copy } from '../../../lib-common/json-utils';
import * as confApi from '../../../lib-common/service-api/asmail/config';
import { MsgEnvelope, SuggestedNextKeyPair, MetaForNewKey,
	MetaForEstablishedKeyPair, SendingParams }
	from './common';
import { isContainerEmpty, iterFilesIn, iterFoldersIn }
	from './attachments-container';
import { Encryptor } from '../../../lib-common/async-cryptor-wrap';

type FileByteSource = web3n.files.FileByteSource;
type FS = web3n.files.FS;
type AttachmentsContainer = web3n.asmail.AttachmentsContainer

/**
 * This contains complete information of ids and keys set in the message during
 * packing. This information can is used to continue message sending after app's
 * restart. Without risk of restart, non-json form is sufficient, but we need to
 * account for said risk.
 */
export interface PackJSON {
	meta: delivApi.msgMeta.Request;
	/**
	 * objs have MsgObj type, except for all keys being base64 string instead of
	 * Uint8Array.
	 */
	objs: { [objId: string]: MsgObj; };
}

export interface MsgObj {
	json?: any;
	folder?: FolderInfoWithAttrs;
	file?: PathInMsg;
	/**
	 * This is object's id in the message
	 */
	id: string;
	key: Uint8Array;
}

interface PathInMsg {
	start: 'attachments';
	path: string[];
}

function turnKeysToB64(obj: MsgObj): void {
	(obj.key as any) = base64.pack(obj.key);
	if (!obj.folder) { return; }
	Object.values(obj.folder.nodes)
	.forEach(node => {
		(node.key as any) = base64.pack(node.key);
	});
}

function turnKeyStingsToBytes(obj: MsgObj): void {
	obj.key = base64.open(obj.key as any);
	if (!obj.folder) { return; }
	Object.values(obj.folder.nodes)
	.forEach(node => {
		node.key = base64.open(obj.key as any);
	});
}

/**
 * This returns a new path in a message, which is a given path, appended with a
 * given name.
 * @param p is a path in a message
 * @param name is a string name to append to given path
 */
function appendedPath(p: PathInMsg, name: string): PathInMsg {
	return {
		start: p.start,
		path: p.path.concat(name)
	};
}

const managedMsgFields: (keyof MsgEnvelope)[] = [
	'Flow Params', 'Body', 'Attachments'
];
Object.freeze(managedMsgFields);

function isManagedField<N extends keyof MsgEnvelope>(name: N): boolean {
	return managedMsgFields.includes(name);
}

/**
 * Instance of this class packs message to sendable objects.
 * When the same message is sent to different recipients, this object must be
 * used for one recipient, so that object ids, keys and resulting cipher are
 * different for each recipient.
 */
export class MsgPacker {

	private meta: MetaForEstablishedKeyPair | MetaForNewKey = (undefined as any);
	private main: MsgEnvelope;
	private mainObjId: string;
	private allObjs = new Map<string, MsgObj>();
	private readyPack: PackJSON|undefined = undefined;
	private hasAttachments = false;
	private attachmentsFS: FS|undefined = undefined;
	private attachmentsCont: AttachmentsContainer|undefined = undefined;

	private constructor(
		private segSizeIn256bs: number
	) {
		this.main = {
			'Flow Params': {
				msgCount: undefined as any,
			},
			'Msg Type': undefined as any,
			'Body': {},
			'From': undefined as any
		};
		this.mainObjId = this.addJsonObj(this.main);
		Object.seal(this);
	}

	static empty(segSizeIn256bs: number): MsgPacker {
		return new MsgPacker(segSizeIn256bs);
	}

	static fromPack(
		p: PackJSON, segSizeIn256bs: number, att: undefined | { fs: FS|undefined; container: AttachmentsContainer|undefined; }
	): MsgPacker {
		const packer = new MsgPacker(segSizeIn256bs);
		packer.readyPack = p;
		packer.mainObjId = p.meta.objIds[0];
		Object.values(copy(p.objs))
		.forEach(obj => {
			packer.allObjs.set(obj.id, obj);
			turnKeyStingsToBytes(obj);
		});
		for (const objId of Object.keys(p.objs)) {
			packer.allObjs.set(objId, p.objs[objId]);
		}
		if (att) {
			if (att.container) {
				packer.attachmentsCont = att.container;
			} else if (att.fs) {
				packer.attachmentsFS = att.fs;
			}
		}
		return packer;
	}

	private generateObjId(): string {
		let id: string;
		do {
			id = base64urlSafe.pack(random.bytesSync(sbox.NONCE_LENGTH));
		} while (this.allObjs.has(id));
		return id;
	}

	private addJsonObj(json: any): string {
		const id = this.generateObjId();
		const key = random.bytesSync(KEY_LENGTH);
		this.allObjs.set(id, { id, json, key });
		return id;
	}

	private addFileInto(
		folderInfo: FolderInfoWithAttrs, fName: string, file: PathInMsg
	): void {
		const id = this.generateObjId();
		const key = random.bytesSync(KEY_LENGTH);
		this.allObjs.set(id, { id, file, key });
		folderInfo.nodes[fName] = {
			objId: id,
			name: fName,
			key: key as any,
			isFile: true
		};
	}

	private async addFolderInto(
		outerFolder: FolderInfoWithAttrs, fName: string, fs: FS, fsPath: PathInMsg
	): Promise<void> {
		const folder: FolderInfoWithAttrs = { nodes: {} };
		const list = await fs.listFolder('.');
		for (const entry of list) {
			const fName = entry.name;
			const fPath = appendedPath(fsPath, fName);
			if (entry.isFile) {
				await fs.readonlyFile(fName);
				this.addFileInto(folder, fName, fPath);
			} else if (entry.isFolder) {
				const f = await fs.readonlySubRoot(fName);
				await this.addFolderInto(folder, fName, f, fPath);
			}
			// note that links are ignored.
		}

		// attach folder to the rest of the message
		const id = this.generateObjId();
		const key = await random.bytes(KEY_LENGTH);
		this.allObjs.set(id, { id, folder, key });
		outerFolder.nodes[fName] = {
			objId: id,
			name: fName,
			key: key as any,
			isFolder: true
		};
	}

	private throwIfAlreadyPacked(): void {
		if (this.readyPack) { throw new Error(`Message is already packed.`); }
	}

	private wasBodySet = false;

	private get mainBody(): any {
		this.throwIfAlreadyPacked();
		return this.main['Body'];
	}

	/**
	 * This sets a plain text body.
	 * @param text
	 */
	setPlainTextBody(text: string): void {
		if (!this.mainBody.text) {
			this.mainBody.text = {};
		}
		this.mainBody.text = { plain: text };
		this.wasBodySet = true;
	}

	/**
	 * This sets a plain html body.
	 * @param html
	 */
	setHtmlTextBody(html: string): void {
		if (!this.mainBody.text) {
			this.mainBody.text = {};
		}
		this.mainBody.text = { html };
		this.wasBodySet = true;
	}

	/**
	 * This sets a json body.
	 * @param json
	 */
	setJsonBody(json: any): void {
		this.mainBody.json = json;
		this.wasBodySet = true;
	}

	/**
	 * This sets named message section of main object to a given value.
	 * @param name
	 * @param value
	 */
	setSection<N extends keyof MsgEnvelope>(
		name: N, value: MsgEnvelope[N]
	): void {
		this.throwIfAlreadyPacked();
		if (isManagedField(name)) { throw new Error(
			"Cannot directly set message field '"+name+"'."); }
		if ((value === undefined) || (value === null)) { return; }
		this.main[name] = JSON.parse(JSON.stringify(value));
	}

	/**
	 * Sets information related to crypto used to encrypt this message.
	 * @param pid pair id goes into unencrypted meta part of a message, for
	 * recipient to find respective key pair.
	 * @param msgCount is a message count for given key pair. It goes into flow
	 * parameters section that sits in encrypted main part of the message.
	 */
	setEstablishedKeyPairInfo(pid: string, msgCount: number): void {
		this.throwIfAlreadyPacked();
		if (this.meta) { throw new Error(
			"Message metadata has already been set."); }
		this.meta = <MetaForEstablishedKeyPair> {
			pid: pid,
		};
		this.main['Flow Params'].msgCount = msgCount;
		Object.freeze(this.meta);
	}

	/**
	 * Sets information related to crypto used to encrypt this message.
	 * @param recipientKid is a key id of recipient's published intro key that
	 * is used to encrypt this message.
	 * This value goes into unencrypted meta part of a message, for recipient to
	 * find respective key pair.
	 * @param senderPKey is a base64 form of sender's one-time introductory key
	 * bytes. Type of this key is dictated by the type of recipient's key. Hence,
	 * this is only reperesentation of bytes.
	 * This value goes into unencrypted meta part of a message, for recipient to
	 * find respective key pair.
	 * @param pkeyCerts is a chain of MailerId cretificates that ties sender
	 * public key to sender's identity.
	 * This value goes into flow parameters section that sits in encrypted main
	 * part of the message.
	 * @param msgCount is a message count for given key pair.
	 * This value goes into flow parameters section that sits in encrypted main
	 * part of the message.
	 */
	setNewKeyInfo(
		recipientKid: string, senderPKey: string,
		pkeyCerts: confApi.p.initPubKey.Certs, msgCount: number
	): void {
		this.throwIfAlreadyPacked();
		if (this.meta) { throw new Error(
			"Message metadata has already been set."); }
		this.meta = <MetaForNewKey> {
			recipientKid: recipientKid,
			senderPKey: senderPKey,
		};
		Object.freeze(this.meta);
		this.main['Flow Params'].introCerts = pkeyCerts;
		this.main['Flow Params'].msgCount = msgCount;
	}

	setNextCrypto(pair: SuggestedNextKeyPair): void {
		this.throwIfAlreadyPacked();
		this.main['Flow Params'].nextCrypto = pair;
	}

	setNextSendingParams(params: SendingParams): void {
		this.main['Flow Params'].nextSendingParams = params;
	}

	async setAttachments(
		att: { fs: FS|undefined; container: AttachmentsContainer|undefined; }
	): Promise<void> {
		this.throwIfAlreadyPacked();
		if (this.hasAttachments) { throw new Error(
			`Attachments are already set.`); }

		// attachments folder json to insert into main
		const attachments: FolderInfoWithAttrs = { nodes: {} };

		// populate attachments json
		const path: PathInMsg = { start: 'attachments', path: [] };
		if (att.container && !isContainerEmpty(att.container)) {
			for (const f of iterFilesIn(att.container)) {
				const filePath = appendedPath(path, f.fileName);
				this.addFileInto(attachments, f.fileName, filePath);
			}
			for (const f of iterFoldersIn(att.container)) {
				const fsPath = appendedPath(path, f.folderName);
				await this.addFolderInto(
					attachments, f.folderName, f.folder, fsPath);
			}
			this.attachmentsCont = att.container;
			this.hasAttachments = true;
		} else if (att.fs) {
			const list = await att.fs.listFolder('.');
			if (list.length > 0) {
				for (const entry of list) {
					const fName = entry.name;
					const fPath = appendedPath(path, fName)
					if (entry.isFile) {
						this.addFileInto(attachments, fName, fPath);
					} else if (entry.isFolder) {
						const f = await att.fs.readonlySubRoot(fName);
						await this.addFolderInto(attachments, fName, f, fPath);
					} else {
						// note that links are ignored.
						continue;
					}
				}
				this.attachmentsFS = att.fs;
				this.hasAttachments = true;
			}
		} else {
			throw new Error(`Given neither container with attachments, nor attachments' file system.`);
		}

		// insert attachments json into main object
		if (this.hasAttachments) {
			this.main['Attachments'] = attachments;
		}
	}

	private throwupOnMissingParts() {
		if (!this.meta) { throw new Error("Message meta is not set"); }
		if (!this.wasBodySet) { throw new Error("Message Body is not set."); }
		if ((this.meta as MetaForNewKey).senderPKey &&
				!this.main['Flow Params'].introCerts) { throw new Error(
			"Sender's key certification is missing."); }
	}

	async getSrcForMainObj(
		msgKeyEnc: Encryptor, cryptor: AsyncSBoxCryptor
	): Promise<ObjSource> {
		const obj = this.allObjs.get(this.mainObjId);
		if (!obj || !obj.json) { throw new Error(
			`Missing or malformed main object.`); }

		const msgKeyPack = await msgKeyEnc.pack(obj.key);
		const bytes = utf8.pack(JSON.stringify(obj.json));

		const segWriter = await makeSegmentsWriter(
			obj.key, idToHeaderNonce(obj.id), 0,
			{ type: 'new', segSize: this.segSizeIn256bs }, random.bytes, cryptor);

		// make source that inserts message key pack into header
		return makeMainObjSrc(msgKeyPack, bytes, segWriter);
	}

	private getFileByteSrc(path: PathInMsg): Promise<FileByteSource> {
		if (path.start === "attachments") {
			if (path.path.length === 0) { throw new Error(
				`Attachment's path is empty.`); }
			if (this.attachmentsCont) {
				const fName = path.path[0];
				if (path.path.length === 1) {
					const file = (this.attachmentsCont.files ?
						this.attachmentsCont.files[fName] : undefined);
					if (!file) { throw new Error(
						`File ${fName} is not found in attachments.`); }
					return file.getByteSource();
				} else {
					const fs = (this.attachmentsCont.folders ?
						this.attachmentsCont.folders[fName] : undefined);
					if (!fs) { throw new Error(
						`Folder ${fName} is not found in attachments.`); }
					const filePath = path.path.slice(1).join('/');
					return fs.getByteSource(filePath);
				}
			} else if (this.attachmentsFS) {
				const filePath = path.path.join('/');
				return this.attachmentsFS.getByteSource(filePath);
			} else {
				throw new Error(`No attachments set in the message.`);
			}
		} else {
			throw new Error(`Unknown start point for path in message: ${path.start}`);
		}
	}

	getNewSrcForObj(
		objId: string, cryptor: AsyncSBoxCryptor
	): Promise<ObjSource> {
		return this.getSrcForNonMainObj(objId, undefined, cryptor);
	}

	async getRestartedSrcForObj(
		objId: string, header: Uint8Array, offset: number,
		cryptor: AsyncSBoxCryptor
	): Promise<ObjSource> {
		const src = await this.getSrcForNonMainObj(objId, header, cryptor);
		if (!src.segSrc.seek) { throw new Error(
			`No seek method on segment's source.`); }
		await src.segSrc.seek(offset);
		return src;
	}
	
	private async getSrcForNonMainObj(
		objId: string, header: Uint8Array|undefined, cryptor: AsyncSBoxCryptor
	): Promise<ObjSource> {
		if (objId === this.mainObjId) { throw new Error(
			`Id for main object is given.`); }
		const obj = this.allObjs.get(objId);
		if (!obj) { throw new Error(
			`Object ${objId} is not found in the message.`); }

		// make object segments writer
		let segWriter: SegmentsWriter;
		if (header) {
			segWriter = await makeSegmentsWriter(
				obj.key, idToHeaderNonce(obj.id), 0,
				{ type: 'restart', header },
				random.bytes, cryptor);
		} else {
			segWriter = await makeSegmentsWriter(
				obj.key, idToHeaderNonce(obj.id), 0,
				{ type: 'new', segSize: this.segSizeIn256bs },
				random.bytes, cryptor);
		}

		// make object source
		let src: ObjSource;
		if (obj.json) {
			const bytes = utf8.pack(JSON.stringify(obj.json));
			src = await makeObjSourceFromArrays(bytes, segWriter);
		} else if (obj.file) {
			const byteSrc = fileSrcToByteSrc(
				await this.getFileByteSrc(obj.file));
			src = await makeEncryptingObjSource(byteSrc, segWriter);
		} else if (obj.folder) {
			const folderBytes = serializeFolderInfo(obj.folder);
			src = await makeObjSourceFromArrays(folderBytes, segWriter);
		} else {
			throw new Error(`Object ${objId} is broken`);
		}
		return src;
	}

	async pack(): Promise<PackJSON> {
		if (this.readyPack) { return this.readyPack; }
		this.throwupOnMissingParts();
		const meta: delivApi.msgMeta.Request =
			JSON.parse(JSON.stringify(this.meta));
		meta.objIds = [];
		const objs: { [objId: string]: MsgObj; } = {};
		for (const objEntry of this.allObjs) {
			const obj = copy(objEntry[1]);
			turnKeysToB64(obj);
			objs[objEntry[0]] = obj;
			if (objEntry[0] !== this.mainObjId) {
				meta.objIds.push(objEntry[0]);
			}
		}
		meta.objIds.sort();
		meta.objIds.unshift(this.mainObjId);
		this.readyPack = { meta, objs };
		return this.readyPack;
	}

}
Object.freeze(MsgPacker.prototype);
Object.freeze(MsgPacker);

async function makeMainObjSrc(
	msgKeyPack: Uint8Array, content: Uint8Array, segWriter: SegmentsWriter
): Promise<ObjSource> {
	const src = await makeObjSourceFromArrays(content, segWriter);
	const wrap: ObjSource = {
		version: src.version,
		segSrc: src.segSrc,
		readHeader: async () => {
			const h = await src.readHeader();
			return joinByteArrays(msgKeyPack, h);
		}
	};
	return Object.freeze(wrap);
}

function joinByteArrays(...arrays: Uint8Array[]): Uint8Array {
	const totalLen = arrays.reduce((len, arr) => len + arr.length, 0);
	const joined = new Uint8Array(totalLen);
	arrays.reduce((ofs, arr) => {
		if (arr.length === 0) { return ofs; }
		joined.set(arr, ofs);
		return (ofs + arr.length);
	}, 0);
	return joined;
}

function fileSrcToByteSrc(fileSrc: FileByteSource): ByteSource {
	return {
		getPosition: fileSrc.getPosition,
		getSize: async () => {
			return {
				isEndless: false,
				size: await fileSrc.getSize()
			};
		},
		read: fileSrc.read,
		seek: fileSrc.seek
	}
}

Object.freeze(exports);