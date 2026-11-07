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
import { Observable, Subject } from 'rxjs';
import { msgRecievedCompletely } from '../../../lib-common/service-api/asmail/retrieval';
import { LogError } from '../../../lib-client/logging/log-to-file';
import { mergeMap, share } from 'rxjs/operators';
import { CancellableProcHolder, toRxObserver } from '../../../lib-common/utils-for-observables';
import { ConnectException } from '../../../lib-common/exceptions/http';
import { addToStatus, type ConnectionStatus } from '../../../lib-client/request-utils';

type IncomingMessage = web3n.asmail.IncomingMessage;
type InboxException = web3n.asmail.InboxException;
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
	private listening = new CancellableProcHolder();
	private disconnectedAt: number|undefined = undefined;

	constructor(
		private readonly msgReceiver: MailRecipient,
		private readonly getMsg: (msgId: string) => Promise<IncomingMessage>,
		private readonly listNewMsgs: (fromTS: number) => Promise<MsgInfo[]>,
		private readonly rmMsg: (msgId: string) => Promise<void>,
		private readonly logError: LogError
	) {
		Object.seal(this);
	}

	private async subscribeToEventSrcAndPassHeartbeats(): Promise<Observable<unknown>> {
		const { client, watchHeartbeat } = await this.msgReceiver.openEventSource();
		this.msgReceiver.connectedState.setState();
		const channel = msgRecievedCompletely.EVENT_NAME;
		watchHeartbeat({
			next: ev => {
				this.connectionEvents.next(toInboxConnectionStatus(ev));
				if (ev.type === 'heartbeat' || ev.type == 'connected') {
					this.msgReceiver.connectedState.setState();
				} else if ((ev.type === 'heartbeat-skip') || (ev.type === 'disconnected')) {
					this.msgReceiver.connectedState.clearState();
				}
			}
		});
		const proc = new Observable<Events>(obs => client.subscribe(channel, obs))
		.pipe(
			mergeMap(async ev => {
				const msg = await this.getMessage(ev.msgId);
				if (msg) {
					this.newMsgs.next(msg);
				}
				return ev;
			}, 5)
		);
		// list messages as a side effect of starting, or at point of starting.
		this.listMsgsFromDisconnectedPeriod();
		return proc;
	}

	async whenConnected(): Promise<void> {
		return this.msgReceiver.connectedState.whenStateIsSet();
	}

	isConnected(): boolean {
		return this.msgReceiver.connectedState.isSet();
	}

	private getMessage(msgId: string): Promise<IncomingMessage|undefined> {
		return this.getMsg(msgId).catch(async (exc: InboxException|ConnectException) => {
			if ((exc.type === 'connect') || (exc.type === 'inbox')) {
				return undefined;
			}
			await this.logError(exc, `Cannot get message ${msgId}`);
		});
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
		this.listening.stop();
		this.newMsgs.complete();
	}

	suspendNetworkActivity(): void {
		this.listening.stop();
	}

	resumeNetworkActivity(): void {
		if (this.listening.proc) {
			this.listening.startWith(
				this.listening.proc.completion.then(() => this.subscribeToEventSrcAndPassHeartbeats())
			);
		} else {
			this.listening.startWith(this.subscribeToEventSrcAndPassHeartbeats());
		}
		this.listening.proc!.completion.then(() => {
			this.disconnectedAt = Date.now();
		});
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