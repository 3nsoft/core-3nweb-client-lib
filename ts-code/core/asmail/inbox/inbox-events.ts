/*
 Copyright (C) 2017, 2019 3NSoft Inc.
 
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
import { msgRecievedCompletely }
	from '../../../lib-common/service-api/asmail/retrieval';
import { LogError } from '../../../lib-client/logging/log-to-file';
import { ServerEvents } from '../../../lib-client/server-events';
import { mergeMap, filter, share } from 'rxjs/operators';
import { toRxObserver } from '../../../lib-common/utils-for-observables';

type IncomingMessage = web3n.asmail.IncomingMessage;
type Observer<T> = web3n.Observer<T>;

const SERVER_EVENTS_RESTART_WAIT_SECS = 30;

/**
 * Instance of this class handles event subscription from UI side. It observes
 * inbox server events, handles them, and generates respective events for UI
 * side.
 */
export class InboxEvents {

	constructor(
		msgReceiver: MailRecipient,
		getMsg: (msgId: string) => Promise<IncomingMessage>,
		logError: LogError
	) {
		const serverEvents = new ServerEvents(
			() => msgReceiver.openEventSource(),
			SERVER_EVENTS_RESTART_WAIT_SECS);

		this.newMsg$ = serverEvents.observe<msgRecievedCompletely.Event>(
			msgRecievedCompletely.EVENT_NAME)
		.pipe(
			mergeMap(ev => getMsg(ev.msgId)
				.catch(async (err) => {
					// TODO should more error handling logic be added here?
					await logError(err, `Cannot get message ${ev.msgId}`);
				})),
			filter(msg => !!msg) as MonoTypeOperatorFunction<IncomingMessage>,
			share()
		);

		Object.seal(this);
	}

	private newMsg$: Observable<IncomingMessage>;

	subscribe<T>(event: string, observer: Observer<T>): () => void {
		if (event === 'message') {
			const subscription = (this.newMsg$ as Observable<any>).subscribe(
				toRxObserver(observer));
			return () => subscription.unsubscribe();
		} else {
			throw new Error(`Event type ${event} is unknown to inbox`);
		}
	}

}
Object.freeze(InboxEvents.prototype);
Object.freeze(InboxEvents);

Object.freeze(exports);