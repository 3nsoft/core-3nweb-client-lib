/*
 Copyright (C) 2017 3NSoft Inc.
 
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

export interface RequestEnvelope<T> {
	type: 'request';
	name: string;
	count: number;
	req: T;
}

export interface ReplyEnvelope<T> {
	type: 'reply';
	reqCount: number;
	isInProgress?: boolean;
	rep?: T;
	err?: any;
}

export interface EventEnvelope<T> {
	type: 'event';
	eventChannel: string;
	eventPayload: T;
}

export type Envelope = RequestEnvelope<any> | ReplyEnvelope<any> |
	EventEnvelope<any>;

export namespace events {

	export const MISSED_EVENTS_CHANNEL = 'missed-events';

	export const SUBSCRIBE_REQ_NAME = 'subscribe';
	export const UNSUBSCRIBE_REQ_NAME = 'unsubscribe';

	export function subscriptionRequest(act: 'subscribe'|'unsubscribe',
			channel: string, reqCount: number): string {
		const reply: RequestEnvelope<string> = {
			type: 'request',
			name: act,
			count: reqCount,
			req: channel
		};
		return JSON.stringify(reply);
	}

	export function subscriptionReply(reqCount: number, status: string): string {
		const reply: ReplyEnvelope<string> = {
			type: 'reply',
			reqCount,
			rep: status,
		};
		return JSON.stringify(reply);
	}

	export const SUBSCRIBE_SC = {
		ok: 'ok',
		unknownChannel: 'unknown-channel'
	};
	Object.freeze(SUBSCRIBE_SC);

}
Object.freeze(events);

export function errorReplyTo(req: RequestEnvelope<any>, err: any): string {
		const reply: ReplyEnvelope<any> = {
		type: 'reply',
		err,
		reqCount: req.count
	};
	return JSON.stringify(reply);
}

Object.freeze(exports);