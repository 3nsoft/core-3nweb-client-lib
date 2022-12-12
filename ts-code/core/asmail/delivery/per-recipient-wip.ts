/*
 Copyright (C) 2016 - 2017, 2019 - 2021 3NSoft Inc.
 
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

import { JsonKey } from '../../../lib-common/jwkeys';
import { base64 } from '../../../lib-common/buffer-utils';
import { MailSender, SessionInfo, FirstSaveReqOpts, FollowingSaveReqOpts }
	from '../../../lib-client/asmail/sender';
import { MsgPacker, PackJSON } from '../msg/packer';
import { SingleProc } from '../../../lib-common/processes/synced';
import { checkAndExtractPKey } from '../key-verification';
import * as confApi from '../../../lib-common/service-api/asmail/config';
import { Msg } from './msg';
import { AsyncSBoxCryptor, ObjSource } from 'xsp-files';
import { Encryptor } from '../../../lib-common/async-cryptor-wrap';

/**
 * This contains WIP's state in a serializable (json) form. It is used by WIP
 * directly and is saved, when message is big and there may be a need to
 * resume sending after app's restart.
 */
export interface WIPstate {
	
	/**
	 * stage indicates a stage of sending process
	 */
	stage: "1-start-session" | "2-opt-auth" | "3-get-pk" | "4-send-meta" |
		"5-send-objs" | "cancel" | undefined;
	
	/**
	 * recipient is an address, where message should be sent
	 */
	recipient: string;

	/**
	 * session contains parameters, given by server, needed for sending restart
	 */
	session?: SessionInfo;

	/**
	 * pack is produced by message packer
	 */
	pack?: PackJSON;

	/**
	 * This field contains info with objects' upload status. All values sit in
	 * array, corresponding to array of objects in pack's meta field.
	 * Null value indicates that upload hasn't been started. String "done" value
	 * indicates that object has already been uploaded. Object value contains
	 * intermediate
	 */
	objUploads?: (null | 'done' | ObjUploadState)[];

	bytesUploaded: number;
}

/**
 * Instance of this interface must be inserted into WIPstate's objUploads array
 * and shared with WIP, so that changes are recorded, when state is saved.
 */
interface ObjUploadState {
	headerDone: boolean;
	
	/**
	 * This is a base64 form of object's header.
	 */
	header?: string;
	
	segsOffset: number;
	
	/**
	 * If expected segment size is undefined, sending should be done in an
	 * appending mode.
	 */
	expectedSegsSize?: number;
}

/**
 * This is is a "currently in upload object" structure. It contains both life
 * objects, and shared json(s) from wip's state.
 */
interface CurrentObj {
	objId: string;
	src: ObjSource;
	/**
	 * value of this field must be an object from corresponding slot in
	 * objUploads array of WIPstate, i.e. this is a shared structure, and changes
	 * here get saved, when wip state is saved.
	 */
	upload: ObjUploadState;
}

const MSG_SIZE_FOR_STATE_RECORDING = 1024*1024;

const EMPTY_BYTE_ARR = new Uint8Array(0);

/**
 * Instance of this class represents a work in progress for sending a given
 * message to a given recipient.
 * It has a simple method to do next action, while keeping track of a progress,
 * and updating respective info elements that are used for notifications.
 */
export class WIP {

	private proc = new SingleProc();
	private sender: MailSender = (undefined as any);
	private packer: MsgPacker = (undefined as any);
	private doStateRecording: boolean;
	private currentObjIndInMeta = 0;
	private currentObj: CurrentObj|undefined = undefined;

	private constructor(
		private msg: Msg,
		private state: WIPstate,
		private cryptor: AsyncSBoxCryptor
	) {
		this.doStateRecording =
			(this.msg.progress.msgSize > MSG_SIZE_FOR_STATE_RECORDING);
		Object.seal(this);
	}

	/**
	 * @param msg
	 * @param recipient
	 */
	static fresh(msg: Msg, recipient: string, cryptor: AsyncSBoxCryptor): WIP {
		const state: WIPstate = {
			recipient,
			stage: "1-start-session",
			bytesUploaded: 0
		};
		msg.wipsInfo[recipient] = state;
		return new WIP(msg, state, cryptor);
	}

	/**
	 * @param msg
	 * @param state
	 */
	static async resume(
		msg: Msg, state: WIPstate, cryptor: AsyncSBoxCryptor
	): Promise<WIP> {
		if (state.stage === '5-send-objs') {
			const wip = new WIP(msg, state, cryptor);
			wip.packer = await msg.msgPacker(state.pack);
			if (state.bytesUploaded > 0) {
				msg.progress.recipients[state.recipient].bytesSent =
					state.bytesUploaded;
			}
			return wip;
		} else {
			return WIP.fresh(msg, state.recipient, cryptor);
		}
	}

	isDone(): boolean {
		return (this.state.stage === undefined);
	}

	/**
	 * This returns a promise for a newly started phase. If an action is ongoing,
	 * or if this wip is done, undefined is returned.
	 */
	startNext(): Promise<void>|undefined {
		let proc = this.proc.latestTaskAtThisMoment<void>();
		if (proc) { return; }
		const stage = this.state.stage;
		if (stage === "1-start-session") {
			proc = this.proc.addStarted(this.startSession());
		} else if (stage === "2-opt-auth") {
			proc = this.proc.addStarted(this.authSender());
		} else if (stage === "3-get-pk") {
			proc = this.proc.addStarted(this.getRecipientKeyAndEncrypt());
		} else if (stage === "4-send-meta") {
			proc = this.proc.addStarted(this.sendMeta());
		} else if (stage === "5-send-objs") {
			proc = this.proc.addStarted(this.sendObjs());
		} else if (stage === "cancel") {
			return;
		} else if (stage === undefined) {
			return;
		} else {
			throw new Error(`Unknown wip stage ${stage}`);
		}
		return proc.catch(async (err) => {
			await this.updateInfo(0, true, err);
			this.state.stage = undefined;
		});
	}

	async cancel(): Promise<void> {
		this.state.stage = "cancel";
		return this.proc.startOrChain(async () => {
			if (this.state.stage === undefined) { return; }
			this.state.stage = undefined;
			if (!this.sender.sessionId) { return; }
			await this.sender.cancelDelivery();
		});
	}

	private async startSession(): Promise<void> {
		const senderAddress = this.msg.r.address;
		const recipient = this.state.recipient;
		
		const sp = this.msg.r.correspondents.paramsForSendingTo(recipient);
		if (sp) {
			this.sender = await MailSender.fresh(
				this.msg.r.makeNet(), this.msg.r.asmailResolver,
				(sp.auth ? senderAddress : undefined),
				recipient, sp.invitation);
		} else {
			this.sender = await MailSender.fresh(
				this.msg.r.makeNet(), this.msg.r.asmailResolver, undefined,
				recipient);
		}
		
		await this.sender.startSession();

		if (this.state.stage === "cancel") { return; }

		this.sender.ensureMsgFitsLimits(this.msg.progress.msgSize);
		
		if (this.sender.sender) {
			this.state.stage = "2-opt-auth";
		} else {
			this.state.stage = "3-get-pk";
		}
	}

	private async authSender(): Promise<void> {
		const signer = await this.msg.r.getSigner();
		await this.sender.authorizeSender(signer);
		if (this.state.stage !== "cancel") {
			this.state.stage = "3-get-pk";
		}
	}

	private async getRecipientKeyAndEncrypt(): Promise<void> {

		const recipient = this.sender.recipient;
		const introPKeyFromServer = await this.getIntroKeyIfRecipientIsUnknown(
			recipient);

		this.packer = await this.msg.msgPacker();
		
		// get crypto parts for encrypting this message
		const { currentPair, encryptor, msgCount } =
			await this.msg.r.correspondents.generateKeysToSend(
				recipient, introPKeyFromServer
			);
		
		// add crypto parameters to the message
		if (currentPair.pid) {
			this.packer.setEstablishedKeyPairInfo(currentPair.pid, msgCount);
		} else {
			const signer = await this.msg.r.getSigner();
			const pkCerts: confApi.p.initPubKey.Certs = {
				pkeyCert: signer.certifyPublicKey(
					currentPair.senderPKey!, 30*24*60*60),
				userCert: signer.userCert,
				provCert: signer.providerCert
			};
			this.packer.setNewKeyInfo(
				currentPair.recipientKid!,
				currentPair.senderPKey!.k,
				pkCerts, msgCount);
		}

		// add next crypto parameters to the message
		const nextMsgCrypto = await this.msg.r.correspondents.nextCrypto(
			recipient);
		if (nextMsgCrypto) {
			this.packer.setNextCrypto(nextMsgCrypto);
		}

		// add updated sending parameters to the message
		const nextSendingParams =
			await this.msg.r.correspondents.newParamsForSendingReplies(recipient);
		if (nextSendingParams) {
			this.packer.setNextSendingParams(nextSendingParams);
		}

		// pack the message
		this.state.pack = await this.packer.pack();

		// initialize uploads info
		this.state.objUploads = new Array(this.state.pack.meta.objIds.length);
		this.state.objUploads.fill(null);

		// set main object as current for an upload
		await this.setMainObjAsCurrent(encryptor);

		// cleanup
		encryptor.destroy();

		if (this.state.stage !== "cancel") {
			this.state.stage = "4-send-meta";
		}
	}

	private async getIntroKeyIfRecipientIsUnknown(
		recipient: string
	): Promise<JsonKey|undefined> {
		if (!this.msg.r.correspondents.needIntroKeyFor(
			this.sender.recipient)) { return; }
		const certs = await this.sender.getRecipientsInitPubKey();
		return checkAndExtractPKey(
			this.sender.net, this.msg.r.midResolver, recipient, certs
		).catch(err => {
			const exc: web3n.asmail.ASMailSendException = {
				runtimeException: true,
				type: 'asmail-delivery',
				address: recipient,
				recipientPubKeyFailsValidation: true,
				cause: err
			}
			throw exc;
		});
	}

	/**
	 * 
	 * @param bytesSent number of additional bytes sent. These are counted.
	 * @param complete is flag, which true value indicates completion of message
	 * delivery. Default value is false.
	 * @param err is an error argument to use, when completion was not
	 * successful, and happened due to it.
	 * it.
	 */
	private updateInfo(bytesSent: number, complete = false, err?: any): void {
		const recipient = this.state.recipient;
		const recInfo = this.msg.progress.recipients[recipient];
		if (complete) {
			if (err) {
				recInfo.err = (err.runtimeException ?
					err : (err.stack ? err.stack : err));
			} else {
				recInfo.bytesSent = this.msg.progress.msgSize;
			}
			recInfo.done = true;
			delete this.msg.wipsInfo[this.state.recipient];
			this.msg.notifyOfChanges(true, this.doStateRecording);
		} else {
			this.state.bytesUploaded += bytesSent;
			recInfo.bytesSent = this.state.bytesUploaded;
			let saveWIPs: boolean;
			if (this.doStateRecording) {
				saveWIPs = (this.currentObjIndInMeta > 0);
			} else {
				saveWIPs = false;
			}
			this.msg.notifyOfChanges(false, saveWIPs);
		}
	}

	private async sendMeta(): Promise<void> {
		if (!this.state.pack) { throw new Error(`Message pack is not set.`); }
		this.state.session = await this.sender.sendMetadata(this.state.pack.meta);
		this.msg.progress.recipients[this.state.recipient].idOnDelivery =
			this.state.session.msgId;
		if (this.state.stage !== "cancel") {
			this.state.stage = "5-send-objs";
		}
	}

	private async setMainObjAsCurrent(
		mainObjEnc: Encryptor
	): Promise<void> {
		if (this.currentObjIndInMeta !== 0) { throw new Error(`This method can be called only when current object index is zero.`); }
		this.currentObj = await this.getObjToSend(mainObjEnc);
	}

	/**
	 * @param mainObjEnc is a main object master encryptor. It must be present,
	 * when main object is set as current (the very first call), and it should be
	 * missing for all other calls.
	 */
	private async getObjToSend(
		mainObjEnc?: Encryptor
	): Promise<CurrentObj|undefined> {
		if (!this.state.objUploads || !this.state.pack) { throw new Error(
			`Unexpected wip state: some fields are not set.`); }
		if (this.currentObjIndInMeta >= this.state.objUploads.length) { return; }

		let upload = this.state.objUploads[this.currentObjIndInMeta];
		if (upload === null) {
			upload = {
				headerDone: false,
				segsOffset: 0
			};
			this.state.objUploads[this.currentObjIndInMeta] = upload;
		} else if (upload === 'done') {
			this.currentObjIndInMeta += 1;
			return this.getObjToSend();
		}

		const objId = this.state.pack.meta.objIds[this.currentObjIndInMeta];

		let src: ObjSource;
		if (this.currentObjIndInMeta === 0) {
			if (!mainObjEnc) {
				throw new Error(`Object master encryptor is not given for the main object.`);
			}
			src = await this.packer.getSrcForMainObj(mainObjEnc, this.cryptor);
		} else if (upload.header) {
			const header = base64.open(upload.header);
			src = await this.packer.getRestartedSrcForObj(
				objId, header, upload.segsOffset, this.cryptor);
		} else {
			src = await this.packer.getNewSrcForObj(objId, this.cryptor);
		}

		return { objId, upload, src };
	}

	private async completeDelivery(): Promise<void> {
		await this.sender.completeDelivery();
		this.updateInfo(0, true);
		this.state.stage = undefined;
		this.sender = (undefined as any);
		this.packer = (undefined as any);
	}

	private setCurrentObjAsDone(): void {
		if (!this.state.objUploads || !this.state.pack) { throw new Error(
			`Unexpected wip state: some fields are not set.`); }
		this.state.objUploads[this.currentObjIndInMeta] = 'done';
		this.currentObj = undefined;
		this.currentObjIndInMeta += 1;
	}

	/**
	 * This sends only a chunk of an object, or switches to the next object, or
	 * completes sending, when no more sending is left.
	 */
	private async sendObjs(): Promise<void> {
		if (!this.sender) {
			this.sender = await MailSender.resume(
				this.msg.r.makeNet(), this.state.recipient, this.state.session!
			);
		}

		// ensure there is an object to send, or complete delivery
		if (!this.currentObj) {
			this.currentObj = await this.getObjToSend();
			if (!this.currentObj) {
				return this.completeDelivery();
			}
		}

		// do first object sending request, if header hasn't been sent
		if (!this.currentObj.upload.headerDone) {
			const objDone = await this.firstObjSendingRequest(this.currentObj);
			if (objDone) {
				this.setCurrentObjAsDone();
			}
			return;
		}

		// do following object sending request
		const objDone = await this.followingObjSendingRequest(this.currentObj);
		if (objDone) {
			this.setCurrentObjAsDone();
		}

	}

	/**
	 * This method does first object sending request, sending a header and a
	 * first part of segments. If this segements fit completely into request,
	 * returned promise will resolve to true, indicating completion of sending
	 * a given object. Otherwise, when there are segments to send, promise
	 * resolves to false.
	 * @param obj is a message object to send
	 */
	private async firstObjSendingRequest(obj: CurrentObj): Promise<boolean> {
		// read from source
		const header = await obj.src.readHeader();
		const { size, isEndless } = await obj.src.segSrc.getSize();
		if (!isEndless) {
			obj.upload.expectedSegsSize = size;
		}
		let segsChunk = await obj.src.segSrc.readNext(
			this.sender.maxChunkSize - header.length
		);

		// check if we'll be done in this request
		const segsSize = obj.upload.expectedSegsSize;
		let isObjDone = false;
		if (!segsChunk) {
			segsChunk = EMPTY_BYTE_ARR;
			isObjDone = true;
		} else if (typeof segsSize === 'number') {
			isObjDone = (segsChunk.length >= segsSize);
		}

		// prepare request options
		const opts: FirstSaveReqOpts = { header: header.length };
		if (isObjDone) {
			opts.last = true;
		}

		// send bytes
		await this.sender.sendObj(obj.objId, [ header, segsChunk ],
			opts, undefined);
		
		// record progress
		obj.upload.headerDone = true;
		obj.upload.segsOffset = segsChunk.length;
		if (this.doStateRecording) {
			obj.upload.header = base64.pack(header);
		}
		this.updateInfo(header.length + segsChunk.length);
		return isObjDone;
	}

	/**
	 * This method does following object sending request(s).
	 * When last segments are sent, returned promise resolves to true. Otherwise,
	 * when there are more segments, promise resolves to false.
	 * @param obj is a message object to send
	 */
	private async followingObjSendingRequest(obj: CurrentObj): Promise<boolean> {
		// read from source
		const segsSize = obj.upload.expectedSegsSize;
		const chunk = await obj.src.segSrc.readNext(this.sender.maxChunkSize);
		
		// return early, when there are no bytes
		if (!chunk) {
			await this.sender.sendObj(
				obj.objId, EMPTY_BYTE_ARR, undefined,
				{ ofs: obj.upload.segsOffset, last: true }
			);
			return true;
		}

		// check for an overrun
		const ofs = obj.upload.segsOffset;
		if (segsSize && ((ofs + chunk.length) > segsSize)) {
			throw new Error(
				`Segments source produced ${obj.upload.segsOffset} bytes, while expectation was for ${segsSize} bytes.`
			);
		}
		
		// if we shouldn't expect any more bytes from source, we are done
		const isObjDone = (chunk.length < this.sender.maxChunkSize) ||
			(!!segsSize && ((ofs + chunk.length) === segsSize));
		
		// prepare request options
		const opts: FollowingSaveReqOpts = { ofs };
		if (isObjDone) {
			opts.last = true;
		}

		// send bytes
		await this.sender.sendObj(obj.objId, chunk, undefined, opts);
		
		obj.upload.segsOffset += chunk.length;
		this.updateInfo(chunk.length);
		return isObjDone;
	}

}
Object.freeze(WIP.prototype);
Object.freeze(WIP);

Object.freeze(exports);