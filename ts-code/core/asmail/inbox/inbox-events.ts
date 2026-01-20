/*
 Copyright (C) 2017, 2019, 2022, 2024 - 2026 3NSoft Inc.
 
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

import { MailRecipient } from '../../../lib-client/asmail/recipient';
import { from, Observable, Subject } from 'rxjs';
import { msgRecievedCompletely } from '../../../lib-common/service-api/asmail/retrieval';
import { LogError } from '../../../lib-client/logging/log-to-file';
import { filter, mergeMap, share, tap } from 'rxjs/operators';
import { toRxObserver } from '../../../lib-common/utils-for-observables';
import { addToStatus, ConnectionStatus, WebSocketListening } from '../../../lib-common/ipc/ws-ipc';
import { ConnectException } from '../../../lib-common/exceptions/http';

type IncomingMessage = web3n.asmail.IncomingMessage;
type InboxEventType = web3n.asmail.InboxEventType;
type Observer<T> = web3n.Observer<T>;
type Events = msgRecievedCompletely.Event;
type MsgInfo = web3n.asmail.MsgInfo;

export interface InboxConnectionStatus extends ConnectionStatus {
	service: 'inbox';
}

function toInboxConnectionStatus(
	status: ConnectionStatus, params?: Partial<InboxConnectionStatus>
): InboxConnectionStatus {
	return addToStatus<InboxConnectionStatus>(status, {
		service: 'inbox',
		...params
	});
}

const SERVER_EVENTS_RESTART_WAIT_SECS = 5;
const BUFFER_MILLIS_FOR_LISTING = 2*60*1000;

/**
 * Instance of this class handles event subscription from UI side. It observes
 * inbox server events, handles them, and generates respective events for UI
 * side.
 * 
 * Event stream should hide complexity of going offline, may be sleeping and
 * waking. Consumer should see messages coming, and internally this needs to
 * be opportunistically connected, as long as there are subscribers to messages.
 * Hence, this should do restarts to server around wakeup events.
 */
export class InboxEvents {

	private readonly newMsgs = new Subject<IncomingMessage>();
	private readonly newMsg$ = this.newMsgs.asObservable().pipe(share());
	private readonly connectionEvents = new Subject<InboxConnectionStatus>();
	readonly connectionEvent$ = this.connectionEvents.asObservable().pipe(share());
	private readonly wsProc: WebSocketListening;
	private disconnectedAt: number|undefined = undefined;

	constructor(
		private readonly msgReceiver: MailRecipient,
		private readonly getMsg: (msgId: string) => Promise<IncomingMessage>,
		private readonly listNewMsgs: (fromTS: number) => Promise<MsgInfo[]>,
		private readonly rmMsg: (msgId: string) => Promise<void>,
		private readonly logError: LogError
	) {
		this.wsProc = new WebSocketListening(
			SERVER_EVENTS_RESTART_WAIT_SECS,
			this.makeProc.bind(this)
		);
		this.wsProc.startListening();
		Object.seal(this);
	}

	private makeProc(): Observable<IncomingMessage> {
		const proc$ = from(this.msgReceiver.openEventSource().then(({ client, heartbeat }) => {
			const channel = msgRecievedCompletely.EVENT_NAME;
			heartbeat.subscribe({
				next: ev => {
					this.connectionEvents.next(toInboxConnectionStatus(ev));
					if (ev.type === 'heartbeat') {
						this.msgReceiver.connectedState.setState();
					} else if ((ev.type === 'heartbeat-skip') || (ev.type === 'disconnected')) {
						this.msgReceiver.connectedState.clearState();
					}
				}
			});
			return new Observable<Events>(obs => client.subscribe(channel, obs));
		}))
		.pipe(
			mergeMap(events => events),
			mergeMap(async ev => this.getMessage(ev.msgId), 5),
			filter(msg => !!msg),
			tap({
				next: msg => this.newMsgs.next(msg),
				error: () => {
					if (!this.disconnectedAt) {
						this.disconnectedAt = Date.now();
					}
				}
			})
		);
		// list messages as a side effect of starting, or at point of starting.
		this.listMsgsFromDisconnectedPeriod();
		return proc$;
	}

	async whenConnected(): Promise<void> {
		return this.msgReceiver.connectedState.whenStateIsSet();
	}

	private async getMessage(msgId: string): Promise<IncomingMessage|undefined> {
		try {
			return await this.getMsg(msgId)
		} catch (err) {

			// XXX we need to skip, if it is a connectivity error here;
			//     should we remove on non-connectivity error
			// await this.rmMsg(msgId).catch(noop);

			await this.logError(err, `Cannot get message ${msgId}`);
		}
	}

	subscribe<T>(event: InboxEventType, observer: Observer<T>): () => void {
		if (event === 'message') {
			const subscription = (this.newMsg$ as Observable<any>).subscribe(
				toRxObserver(observer)
			);
			return () => subscription.unsubscribe();
		} else {
			throw new Error(`Event type ${event} is unknown to inbox`);
		}
	}

	close(): void {
		this.newMsgs.complete();
		this.wsProc.close();
	}

	// XXX we should go along:
	//  - last working connection and ping
	//  - may be have an expect suspending of network, with less aggressive attempts to reconnect
	//  - instead of talking about presence of network, expose methods to nudge restarting behaviour, as outside
	//    may have better clues and able to command behaviour switch

	suspendNetworkActivity(): void {

		// XXX code below shutdown for good, but restart sometimes has been failing.
		// 
		// if (this.isListening) {
		// 	if (!this.disconnectedAt) {
		// 		this.disconnectedAt = Date.now();
		// 	}
		// 	this.stopListening();
		// }
	}

	resumeNetworkActivity(): void {
		if (!this.wsProc.isListening) {
			this.wsProc.startListening();
		}
	}

	private async listMsgsFromDisconnectedPeriod(): Promise<void> {
		if (!this.disconnectedAt) {
			return;
		}
		try {
			const fromTS = this.disconnectedAt - BUFFER_MILLIS_FOR_LISTING;
			const msgInfos = (await this.listNewMsgs(fromTS))
			.sort((a, b) => (a.deliveryTS - b.deliveryTS));
			for (const info of msgInfos) {
				const msg = await this.getMessage(info.msgId);
				if (msg) {
					this.newMsgs.next(msg);
					this.disconnectedAt = msg.deliveryTS;
				}
			}
			this.disconnectedAt = undefined;
		} catch (err) {
			if ((err as ConnectException).type !== 'connect') {
				await this.logError(err, `Error while retrieving messages, from disconnected period`);
			}
		}
	}

}
Object.freeze(InboxEvents.prototype);
Object.freeze(InboxEvents);


Object.freeze(exports);