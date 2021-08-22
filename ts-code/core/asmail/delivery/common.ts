/*
 Copyright (C) 2016 - 2017, 2020 3NSoft Inc.
 
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

import { GetSigner } from '../../id-manager';
import { iterFilesIn, iterFoldersIn, isContainerEmpty, addFileTo, addFolderTo } from '../msg/attachments-container';
import { utf8 } from '../../../lib-common/buffer-utils';
import { AsyncSBoxCryptor } from 'xsp-files';
import { SendingParams, SuggestedNextKeyPair } from '../msg/common';
import { Encryptor } from '../../../lib-common/async-cryptor-wrap';
import { JsonKey } from '../../../lib-common/jwkeys';
import { ASMailKeyPair } from '../keyring/common';
import { NetClient } from '../../../lib-client/request-utils';
import { LogWarning, LogError } from '../../../lib-client/logging/log-to-file';
import { ServiceLocator } from '../../../lib-client/service-locator';

type OutgoingMessage = web3n.asmail.OutgoingMessage;
type DeliveryProgress = web3n.asmail.DeliveryProgress;
type AttachmentsContainer = web3n.asmail.AttachmentsContainer;
type FS = web3n.files.FS;
type WritableFS = web3n.files.WritableFS;
type File = web3n.files.File;

const ATTACHMENTS_NAME = 'attachments';

export class Attachments {

	private constructor(
		public container: AttachmentsContainer|undefined,
		public fs: FS|undefined
	) {
		Object.freeze(this);
	}

	static fromMsg(msg: OutgoingMessage): Attachments|undefined {
		if (!isContainerEmpty(msg.attachments)) {
			return new Attachments(msg.attachments, undefined);
		}
		return;
	}

	static async readFrom(msgFS: FS): Promise<Attachments|undefined> {
		if (await msgFS.checkFolderPresence(ATTACHMENTS_NAME)) {
			const container: AttachmentsContainer = {};
			const list = await msgFS.listFolder(ATTACHMENTS_NAME);
			for (const f of list) {
				if (!f.isLink) { continue; }
				const link = await msgFS.readLink(`${ATTACHMENTS_NAME}/${f.name}`);
				if (link.isFile) {
					const file = (await link.target()) as File;
					addFileTo(container, file, f.name);
				} else if (link.isFolder) {
					const fs = (await link.target()) as FS;
					addFolderTo(container, fs, f.name);
				}
			}
			return new Attachments(container, undefined);
		} else if (await msgFS.checkLinkPresence(ATTACHMENTS_NAME)) {
			const linkToAttachments = await msgFS.readLink(ATTACHMENTS_NAME);
			const fs = (await linkToAttachments.target()) as FS;
			return new Attachments(undefined, fs);
		} else {
			return;
		}
	}

	async linkIn(msgFS: WritableFS): Promise<void> {
		if (this.container) {
			await msgFS.makeFolder(ATTACHMENTS_NAME);
			for (const f of iterFilesIn(this.container)) {
				msgFS.link(`${ATTACHMENTS_NAME}/${f.fileName}`, f.file);
			}
			for (const f of iterFoldersIn(this.container)) {
				msgFS.link(`${ATTACHMENTS_NAME}/${f.folderName}`, f.folder);
			}
		} else if (this.fs) {
			msgFS.link(ATTACHMENTS_NAME, this.fs);
		}
	}

	async deleteFrom(msgFS: WritableFS): Promise<void> {
		if (this.container) {
			await msgFS.deleteFolder(ATTACHMENTS_NAME, true).catch(() => {});
		} else if (this.fs) {
			msgFS.deleteLink(ATTACHMENTS_NAME).catch(() => {});
		}
	}

	async estimatedPackedSize(): Promise<number> {
		if (this.container) {
			let totalSize = 0;
			for (const f of iterFilesIn(this.container)) {
				const fileSize = (await f.file.stat()).size;
				if (typeof fileSize === 'number') {
					totalSize += await estimatePackedSizeOf(fileSize);
				}
			}
			for (const f of iterFoldersIn(this.container)) {
				totalSize += await estimatePackedSizeOfFolder(f.folder);
			}
			return totalSize;
		} else if (this.fs) {
			return estimatePackedSizeOfFolder(this.fs);
		} else {
			throw new Error(`Missing both fs and container with attachments.`);
		}
	}

}

async function estimatePackedSizeOfFolder(folder: FS): Promise<number> {
	const list = await folder.listFolder('.');
	let totalSize = 180 + 24*list.length +
		utf8.pack(JSON.stringify(list)).length;
	for (const f of list) {
		if (f.isFile) {
			const fileSize = (await folder.stat(f.name)).size;
			if (typeof fileSize === 'number') {
				totalSize += await estimatePackedSizeOf(fileSize);
			}
		} else if (f.isFolder) {
			const innerFolder = await folder.readonlySubRoot(f.name);
			totalSize += await estimatePackedSizeOfFolder(innerFolder);
		} else if (f.isLink) {
			// ignoring links for now
		}
	}
	return totalSize;
}

export const SEG_SIZE_IN_K_QUATS = 16;

const SEG_CONTENT_SIZE = 256*SEG_SIZE_IN_K_QUATS - 16;

export function estimatePackedSizeOf(size: number): number {
	const numOfCompleteSegs = Math.floor(size / SEG_CONTENT_SIZE);
	let lastSegSize = size - numOfCompleteSegs*SEG_CONTENT_SIZE;
	if (lastSegSize > 0) {
		lastSegSize += 16;
	}
	return 148 + numOfCompleteSegs*SEG_SIZE_IN_K_QUATS*256 + lastSegSize;
}

export interface ResourcesForSending {
	address: string;
	getSigner: GetSigner;
	makeNet: () => NetClient;
	asmailResolver: ServiceLocator;
	midResolver: ServiceLocator;
	correspondents: {

		/**
		 * This returns true, when an intro key is needed to send message to a
		 * given correspondent's address. False is returned, when a given address
		 * has associated established pairs.
		 * @param address
		 */
		needIntroKeyFor(address: string): boolean;

		/**
		 * This function generates keys that are needed to send a message, i.e.
		 * current crypto encryptor and identifiers to place in message's meta.
		 * Returned object has following fields:
		 * (a) encryptor - with encryptor, which should be used to pack message's
		 * main part's key,
		 * (b) currentPair - contains sendable form for current key pair.
		 * (c) msgCount - message count for a current pair.
		 * @param address
		 * @param introPKeyFromServer is an optional recipient's key from a mail
		 * server.
		 */
		generateKeysToSend: (address: string, introPKeyFromServer?: JsonKey) =>
			Promise<{ encryptor: Encryptor; currentPair: ASMailKeyPair;
				msgCount: number; }>;

		/**
		 * This function returns sending parameters that should be used now to
		 * send messages to a given address. Undefined is returned, if there is no
		 * record for a given address.
		 * @param address
		 */
		paramsForSendingTo: (address: string) => SendingParams|undefined;

		/**
		 * This function returns next key pair
		 * @param address 
		 */
		nextCrypto: (address: string) => Promise<SuggestedNextKeyPair|undefined>;

		/**
		 * This returns a new sending parameters that given address should use to
		 * send messages back. Undefined is returned, if current parameters don't
		 * have to be updated.
		 * @param address
		 */
		newParamsForSendingReplies: (address: string) =>
			Promise<SendingParams|undefined>;

	};
	cryptor: AsyncSBoxCryptor;
	notifyMsgProgress: (id: string, progress: DeliveryProgress) => void;
	logError: LogError;
	logWarning: LogWarning;
}

export interface SavedMsgToSend {
	msgToSend: OutgoingMessage;
	sender: string;
	recipients: string[];
}

/**
 * This is a utility function that adds a number into given number line
 * segments. Each segment is represented by an array, in which 0-th element is
 * the smallest number in the segment, while 1-st element is the largest.
 * Segments don't overlap and are ordered as they would on a number line:
 * segment with smaller numbers go first.
 * @param segments 
 * @param n 
 */
export function addToNumberLineSegments(segments: number[][], n: number): void {

	for (let i=(segments.length-1); i>=0; i-=1) {
		const [ low, high ] = segments[i];

		if (high < n) {
			if ((high + 1) >= n) {
				// segment should be grown on a high side.
				// But now bigger segment won't merge with higher segment, cause if
				// it does, it would've merge from lower side of a higher segment.
				segments[i][1] = n;
			} else {
				// new segment should be added higher than this one
				segments.splice(i+1, 0, [ n, n ]);
			}
			return;
		}

		if ((low <= n) && (n <= high)) {
			// do nothing as number falls into current segment
			return;
		}

		if (low <= (n + 1)) {
			// segment should be grown on a lower side
			segments[i][0] = n;
			if ((i-1) >= 0) {
				// bigger segment may overlap with a lower one
				const lowerSeg = segments[i-1];
				if ((lowerSeg[1] + 1) >= n) {
					lowerSeg[1] = high;
					segments.splice(i, 1);
				}
			}
			return;
		}
	}
	segments.unshift([ n, n ]);
}

Object.freeze(exports);