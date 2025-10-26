/*
 Copyright (C) 2016 - 2018, 2020, 2023, 2025 3NSoft Inc.
 
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

import { MsgPacker, PackJSON } from '../msg/packer';
import { NamedProcs, SingleProc } from '../../../lib-common/processes/synced';
import { utf8 } from '../../../lib-common/buffer-utils';
import { ResourcesForSending, Attachments, SavedMsgToSend, SEG_SIZE_IN_K_QUATS, estimatePackedSizeOf } from './common';
import { WIP, WIPstate } from './per-recipient-wip';
import { Observable, Subject } from 'rxjs';
import { copy as jsonCopy } from '../../../lib-common/json-utils';
import { defer, Deferred } from '../../../lib-common/processes/deferred';

type WritableFS = web3n.files.WritableFS;
type DeliveryProgress = web3n.asmail.DeliveryProgress;
type OutgoingMessage = web3n.asmail.OutgoingMessage;
type DeliveryOptions = web3n.asmail.DeliveryOptions;

const MAIN_OBJ_FILE_NAME = 'msg.json';
const PROGRESS_INFO_FILE_NAME = 'progress.json';
const WIPS_INFO_FILE_NAME = 'wips.json';

function checkIfAllRecipientsDone(progress: DeliveryProgress): boolean {

// XXX this is missing info about already attempted sending, producing
///    true, when retries are needed.

	for (const recipient of Object.keys(progress.recipients)) {
		const recInfo = progress.recipients[recipient];
		if (!recInfo.done) { return false; }
	}
	return true;
}

function hasError(progress: DeliveryProgress): boolean {
	for (const recipient of Object.keys(progress.recipients)) {
		const recInfo = progress.recipients[recipient];
		if (recInfo.err) { return true; }
	}
	return false;
}

async function estimatedPackedSize(msgToSend: OutgoingMessage,
		attachments?: Attachments): Promise<number> {
	let totalSize = estimatePackedSizeOf(
		utf8.pack(JSON.stringify(msgToSend)).length);
	if (attachments) {
		totalSize += await attachments.estimatedPackedSize();
	}
	return totalSize;
}


export class Msg {

	private static readonly progressSavingProcs = new NamedProcs();

	private readonly sendingProc = new SingleProc();
	private completionPromise: Deferred<DeliveryProgress>|undefined = undefined;
	// private readonly progressSavingProc = new SingleProc();
	private cancelled = false;
	private sender: string = (undefined as any);
	private recipients: string[] = (undefined as any);
	private retryOpts: DeliveryOptions['retryRecipient'] = undefined;
	private msgToSend: OutgoingMessage = (undefined as any);
	private attachments: Attachments|undefined = undefined;
	private sequentialWIP: WIP|undefined = undefined;
	public wipsInfo: { [recipient: string]: WIPstate } = {};
	
	private readonly progressPublisher = new Subject<DeliveryProgress>();
	public get progress$(): Observable<DeliveryProgress> {
		return this.progressPublisher.asObservable();
	}

	private constructor (
		public readonly id: string,
		public readonly r: ResourcesForSending,
		public readonly progress: DeliveryProgress,
		private readonly msgFS: WritableFS
	) {
		Object.seal(this);
	}
	
	static async forNew(
		id: string, msgFS: WritableFS, msgToSend: OutgoingMessage,
		sender: string, recipients: string[], r: ResourcesForSending,
		attachments: Attachments|undefined, localMeta: any|undefined,
		retryOpts: DeliveryOptions['retryRecipient']
	): Promise<Msg> {
		const progress: DeliveryProgress = {
			msgSize: await estimatedPackedSize(msgToSend, attachments),
			recipients: {}
		};
		for (const recipient of recipients) {
			progress.recipients[recipient] = {
				done: false,
				bytesSent: 0
			};
		}
		const msg = new Msg(id, r, progress, msgFS);
		msg.msgToSend = msgToSend;
		msg.sender = sender;
		msg.recipients = recipients;
		msg.retryOpts = retryOpts;
		msg.attachments = attachments;
		if (localMeta !== undefined) {
			msg.progress.localMeta = localMeta;
		}
		await msg.save();
		return msg;
	}

	static async forRestart(
		id: string, msgFS: WritableFS, r: ResourcesForSending
	): Promise<Msg> {
		const progress = await Msg.progressSavingProcs.startOrChain(id, async () => {
			return await msgFS.readJSONFile<DeliveryProgress>(PROGRESS_INFO_FILE_NAME);
		});
		if (progress.allDone) {
			return new Msg(id, (undefined as any), progress, (undefined as any));
		}
		const msg = new Msg(id, r, progress, msgFS);
		const main = await msgFS.readJSONFile<SavedMsgToSend>(
			MAIN_OBJ_FILE_NAME
		);
		msg.msgToSend = main.msgToSend;
		msg.sender = main.sender;
		msg.recipients = main.recipients;
		msg.attachments = await Attachments.readFrom(msgFS);
		if (await msgFS.checkFilePresence(WIPS_INFO_FILE_NAME)) {
			msg.wipsInfo = (await msgFS.readJSONFile(WIPS_INFO_FILE_NAME));
		}
		return msg;
	}

	private async save(): Promise<void> {
		const main: SavedMsgToSend = {
			msgToSend: this.msgToSend,
			sender: this.sender,
			recipients: this.recipients,
			retryOpts: this.retryOpts
		};
		await this.msgFS.writeJSONFile(
			MAIN_OBJ_FILE_NAME, main, { create: true, exclusive: true }
		);
		await this.msgFS.writeJSONFile(
			PROGRESS_INFO_FILE_NAME, this.progress,
			{ create: true, exclusive: true }
		);
		if (this.attachments) {
			await this.attachments.linkIn(this.msgFS);
		}
	}

	notifyOfChangesInProgress(saveProgress: boolean, saveWIPs: boolean): void {
		if (this.cancelled) { return; }
		if (this.progress.allDone) { return; }

// XXX check progress differently
//     Indicate need for restart ?
//     In recipient's part, awaitingRestart flag ?
//		 retryRecipients ?

		if (checkIfAllRecipientsDone(this.progress)) {
			this.progress.allDone = (hasError(this.progress) ?
				'with-errors' : 'all-ok'
			);
			saveProgress = true;
		}

		this.r.notifyMsgProgress(this.id, jsonCopy(this.progress));
		this.progressPublisher.next(jsonCopy(this.progress));
		if (saveProgress) {
			Msg.progressSavingProcs.startOrChain(this.id, async () => {
				await this.msgFS.writeJSONFile(PROGRESS_INFO_FILE_NAME, this.progress, {});
			});
		}
		if (this.isDone()) {
			this.progressPublisher.complete();
			Msg.progressSavingProcs.startOrChain(this.id, async () => {
				await this.msgFS.deleteFile(WIPS_INFO_FILE_NAME).catch(noop);
				if (this.attachments) {
					await this.attachments.deleteFrom(this.msgFS);
				}
			});
		} else if (saveWIPs) {
			Msg.progressSavingProcs.startOrChain(this.id, async () => {
				await this.msgFS.writeJSONFile(WIPS_INFO_FILE_NAME, this.wipsInfo);
			});
		}
	}

	async msgPacker(pack?: PackJSON): Promise<MsgPacker> {
		if (pack) {
			return MsgPacker.fromPack(pack, SEG_SIZE_IN_K_QUATS, this.attachments);
		}
		const msg = MsgPacker.empty(SEG_SIZE_IN_K_QUATS);
		msg.setSection('From', this.sender);
		if (typeof this.msgToSend.plainTxtBody === 'string') {
			msg.setPlainTextBody(this.msgToSend.plainTxtBody);
		}
		if (typeof this.msgToSend.htmlTxtBody === 'string') {
			msg.setHtmlTextBody(this.msgToSend.htmlTxtBody);
		}
		if (this.msgToSend.jsonBody !== undefined) {
			msg.setJsonBody(this.msgToSend.jsonBody);
		}
		msg.setSection('Msg Type', this.msgToSend.msgType);
		msg.setSection('Subject', this.msgToSend.subject);
		msg.setSection('Cc', this.msgToSend.carbonCopy);
		msg.setSection('To', this.msgToSend.recipients);
		if (this.attachments) {
			await msg.setAttachments(this.attachments);
		}
		return msg;
	}

	isDone(): boolean {
		return !!this.progress.allDone;
	}

	isSendingNow(): boolean {
		return !!this.sendingProc.isProcessing();
	}

	deliverySizeLeft(): number {
		if (this.progress.allDone) { return 0; }
		let sizeLeft = 0;
		for (const recipient of Object.keys(this.progress.recipients)) {
			const recInfo = this.progress.recipients[recipient];
			if (recInfo.done) { continue; }
			sizeLeft += Math.max(0, this.progress.msgSize - recInfo.bytesSent);
		}
		return sizeLeft;
	}

	getCompletionPromise(): Promise<DeliveryProgress> {
		if (this.isDone()) { throw new Error(`Message delivery has already completed.`); }
		if (!this.completionPromise) {
			this.completionPromise = defer<DeliveryProgress>();
		}
		return this.completionPromise.promise;
	}

	/**
	 * Calling this method sets this message as cancelled. When returned promise
	 * completes, it is safe to remove message's folder.
	 */
	async cancelSending(): Promise<void> {
		if (this.cancelled) { return; }
		this.cancelled = true;
		const filesProc = Msg.progressSavingProcs.latestTaskAtThisMoment(this.id);
		if (!filesProc) { return; }
		await filesProc.catch(() => {});
		const exc: web3n.asmail.ASMailSendException = {
			runtimeException: true,
			type: 'asmail-delivery',
			msgCancelled: true
		};
		this.progressPublisher.error(exc);
	}

	/**
	 * This starts sending a message to all recipients in parallel, and should be
	 * used on small messages. For small messages, recipient-specific processes'
	 * intermediate states are not saved, unlike big messages.
	 * Returned promise completes when sending completes. Check isDone() method
	 * to see if sending should be started again, when network connectivity comes
	 * back.
	 */
	sendThisSmallMsgInParallel(): Promise<void> {
		if (this.isDone()) { throw new Error(`Message ${this.id} has already been sent.`) }
		return this.sendingProc.start(async (): Promise<void> => {

			// setup work-in-progress objects
			const wips: WIP[] = [];
			for (const recipient of Object.keys(this.progress.recipients)) {
				const recInfo = this.progress.recipients[recipient];
				if (recInfo.done) { continue; }
				const state = this.wipsInfo[recipient];
				if (state) {
					wips.push(await WIP.resume(this, state, this.r.cryptor));
				} else {
					wips.push(WIP.fresh(this, recipient, this.r.cryptor));
				}
			}

			// start all process in parallel, and await
			const wipPromises = wips.map(async (wip): Promise<void> => {
				while (!wip.isDone()) {
					if (this.cancelled) {
						await wip.cancel();
					}
					await wip.startNext();
				}
			});
			await Promise.all(wipPromises);

// XXX ???
			if (this.completionPromise && this.isDone()) {
				this.completionPromise.resolve(this.progress);
				this.completionPromise = undefined;
			}
		}).catch(err => {
			if (this.completionPromise) {
				this.completionPromise.reject(err);
				this.completionPromise = undefined;
			}
		});
	}

	/**
	 * This starts sending a message, sequentially, one recipient at a time, and
	 * should be used on big (not small) messages. For big messages,
	 * recipient-specific processes' intermediate states are saved, unlike small
	 * messages.
	 * Returned promise completes when sending completes. Check isDone() method
	 * to see if sending should be started again, when network connectivity comes
	 * back.
	 */
	sendNextSequentialChunkOfThisBigMsg(): Promise<void> {
		if (this.isDone()) { throw new Error(`Message ${this.id} has already been sent.`) }
		return this.sendingProc.start(async (): Promise<void> => {

			// setup sequential wip, if it is not present, and if there is work
			if (!this.sequentialWIP) {
				// look for a recipient, to who delivery is not done
				let recipient: string|undefined = undefined;
				for (const address of Object.keys(this.progress.recipients)) {
					const recInfo = this.progress.recipients[address];
					if (!recInfo.done) {
						recipient = address;
						break;
					}
				}
				if (!recipient) { return; }
				const state = this.wipsInfo[recipient];
				this.sequentialWIP = (state ?
					(await WIP.resume(this, state, this.r.cryptor)) :
					WIP.fresh(this, recipient, this.r.cryptor)
				);
			}

			// do next chunk of work, removing wip, if it is done
			await this.sequentialWIP.startNext();
			if (this.sequentialWIP.isDone()) {
				this.sequentialWIP = undefined;
			}

// XXX ???
			if (this.completionPromise && this.isDone()) {
				this.completionPromise.resolve(this.progress);
				this.completionPromise = undefined;
			}
		}).catch(err => {
			if (this.completionPromise) {
				this.completionPromise.reject(err);
				this.completionPromise = undefined;
			}
		});
	}

}
Object.freeze(Msg.prototype);
Object.freeze(Msg);


function noop() {}


Object.freeze(exports);