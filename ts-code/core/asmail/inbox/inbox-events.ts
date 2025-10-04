/*
 Copyright (C) 2017, 2019, 2022, 2024 - 2025 3NSoft Inc.
 
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
import { Observable, Subject, Subscription } from 'rxjs';
import { msgRecievedCompletely } from '../../../lib-common/service-api/asmail/retrieval';
import { LogError } from '../../../lib-client/logging/log-to-file';
import { ServerEvents } from '../../../lib-client/server-events';
import { mergeMap, share } from 'rxjs/operators';
import { toRxObserver } from '../../../lib-common/utils-for-observables';
import { WSException } from '../../../lib-common/ipc/ws-ipc';
import { ConnectException, HTTPException } from '../../../lib-common/exceptions/http';
import { sleep } from '../../../lib-common/processes/sleep';

type IncomingMessage = web3n.asmail.IncomingMessage;
type InboxEventType = web3n.asmail.InboxEventType;
type Observer<T> = web3n.Observer<T>;
type Events = msgRecievedCompletely.Event;
type EventNames = (typeof msgRecievedCompletely.EVENT_NAME);

const SERVER_EVENTS_RESTART_WAIT_SECS = 5;


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
	private listeningProc: Subscription|undefined = undefined;
	private readonly makeServerEvents: () => ServerEvents<EventNames, Events>;
	private networkActive = true;

	constructor(
		msgReceiver: MailRecipient,
		private readonly getMsg: (msgId: string) => Promise<IncomingMessage>,
		private readonly rmMsg: (msgId: string) => Promise<void>,
		private readonly logError: LogError
	) {
		this.makeServerEvents = () => new ServerEvents<EventNames, Events>(
			() => msgReceiver.openEventSource(this.logError),
			this.logError
		);
		this.startListening();
		Object.seal(this);
	}

	private startListening(): void {
		if (this.listeningProc || !this.networkActive) {
			return;
		}
		function clearListeningProc() {
			if (this.listeningProc === sub) {
				this.listeningProc = undefined;
			}
		}
		const sub = this.makeServerEvents()
		.observe(msgRecievedCompletely.EVENT_NAME)
		.pipe(
			mergeMap(async ev => {
				try {
					return await this.getMsg(ev.msgId)
				} catch (err) {
					await this.rmMsg(ev.msgId);
					await this.logError(err, `Cannot get message ${ev.msgId}, and removing it as a result`);
				}
			}, 5)
		)
		.subscribe({
			next: msg => {
				if (msg) {
					this.newMsgs.next(msg)
				}
			},
			complete: () => {
				clearListeningProc();
			},
			error: async exc => {
				clearListeningProc();
				if (this.shouldRestartAfterErr(exc)) {
					await sleep(SERVER_EVENTS_RESTART_WAIT_SECS);
					this.startListening();
				}
			}
		});
		this.listeningProc = sub;
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
	}

	get isListening(): boolean {
		return !!this.listeningProc;
	}

	private shouldRestartAfterErr(
		exc: WSException|ConnectException|HTTPException
	): boolean {
		if (!exc.runtimeException) { return false; }
		if (exc.type === 'connect') {
			return true;
		} else if (exc.type === 'http-request') {
			return false;
		} else if (exc.type === 'websocket') {
			return true;
		} else {
			return false;
		}
	}

	private stopListening(): void {
		this.listeningProc?.unsubscribe();
		this.listeningProc = undefined;
	}

	suspendNetworkActivity(): void {
		this.networkActive = false;
		if (this.isListening) {
			this.stopListening();
		}
	}

	resumeNetworkActivity(): void {
		this.networkActive = true;
		if (!this.isListening) {
			this.startListening();
		}
	}

	// XXX we may expose health info that can be used elsewhere in the system;
	//     server ping timing info can be taken from used websocket, etc.

}
Object.freeze(InboxEvents.prototype);
Object.freeze(InboxEvents);


Object.freeze(exports);