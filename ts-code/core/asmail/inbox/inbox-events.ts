/*
 Copyright (C) 2017, 2019, 2022, 2024 3NSoft Inc.
 
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

import { MailRecipient } from '../../../lib-client/asmail/recipient';
import { Observable, MonoTypeOperatorFunction } from 'rxjs';
import { msgRecievedCompletely } from '../../../lib-common/service-api/asmail/retrieval';
import { LogError } from '../../../lib-client/logging/log-to-file';
import { ServerEvents } from '../../../lib-client/server-events';
import { mergeMap, filter, share, tap } from 'rxjs/operators';
import { toRxObserver } from '../../../lib-common/utils-for-observables';

type IncomingMessage = web3n.asmail.IncomingMessage;
type InboxEventType = web3n.asmail.InboxEventType;
type Observer<T> = web3n.Observer<T>;
type Events = msgRecievedCompletely.Event;
type EventNames = (typeof msgRecievedCompletely.EVENT_NAME);

const SERVER_EVENTS_RESTART_WAIT_SECS = 30;


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

	constructor(
		msgReceiver: MailRecipient,
		getMsg: (msgId: string) => Promise<IncomingMessage>,
		logError: LogError
	) {
		const serverEvents = new ServerEvents<EventNames, Events>(
			() => msgReceiver.openEventSource(),
			SERVER_EVENTS_RESTART_WAIT_SECS,
			logError
		);

		this.newMsg$ = serverEvents.observe(msgRecievedCompletely.EVENT_NAME)
		.pipe(
			// XXX tap to log more details
			tap({
				complete: () => logError({}, `InboxEvents.newMsg$ completes`),
				error: err => logError(err, `InboxEvents.newMsg$ has error`)
			}),
			mergeMap(async ev => {
				try {
					const msg = await getMsg(ev.msgId)
					return msg;
				} catch (err) {
					// TODO should more error handling logic be added here?
					await logError(err, `Cannot get message ${ev.msgId}`);
				}
			}),
			filter(msg => !!msg) as MonoTypeOperatorFunction<IncomingMessage>,
			share()
		);

		Object.seal(this);
	}

	private newMsg$: Observable<IncomingMessage>;

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

}
Object.freeze(InboxEvents.prototype);
Object.freeze(InboxEvents);


Object.freeze(exports);