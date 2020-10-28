/*
 Copyright (C) 2015, 2017, 2020 3NSoft Inc.
 
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

import * as api from '../../lib-common/service-api/mailer-id/login';
import { NetClient, makeException } from '../request-utils';
import { HTTPException } from '../../lib-common/exceptions/http';
import { user as mid } from '../../lib-common/mid-sigs-NaCl-Ed';
import { parse as parseUrl } from 'url';

export interface LoginException extends HTTPException {
	loginFailed?: boolean;
	unknownUser?: boolean;
}

export async function startMidSession(
	userId: string, net: NetClient, loginUrl: string
): Promise<{ sessionId?: string; redirect?: string; }> {
	const reqData: api.startSession.Request = { userId };
	if (!loginUrl.endsWith('/')) {
		loginUrl += '/';
	}
	const rep = await net.doJsonRequest<
			api.startSession.Reply|api.startSession.RedirectReply>({
		url: `${loginUrl}${api.startSession.URL_END}`,
		method: api.startSession.method,
		responseType: 'json'
	}, reqData);
	if (rep.status === api.startSession.SC.ok) {
		const r = rep.data as api.startSession.Reply;
		if (!r || (typeof r.sessionId !== 'string') || !r.sessionId) {
			throw makeException(rep, 'Malformed reply to starting session');
		}
		return { sessionId: r.sessionId };
	} else if (rep.status === api.startSession.SC.redirect) {
		const rd =  rep.data as api.startSession.RedirectReply;
		if (!rd || ('string' !== typeof rd.redirect) || !rd.redirect) {
			throw makeException(rep,
				'Malformed redirect reply to starting session');
		}
		return { redirect: rd.redirect };
	} else if (rep.status === api.startSession.SC.unknownUser) {
		const exc = makeException(rep) as LoginException;
		exc.unknownUser = true;
		throw exc;
	} else {
		throw makeException(rep, 'Unexpected status');
	}
}
	
export async function authenticateMidSession(
	sessionId: string, midSigner: mid.MailerIdSigner,
	net: NetClient, loginUrl: string
): Promise<void> {
	const domain = parseUrl(loginUrl).hostname!;
	const reqData: api.authSession.Request = {
		assertion: midSigner.generateAssertionFor(domain, sessionId),
		userCert: midSigner.userCert,
		provCert: midSigner.providerCert
	};
	if (!loginUrl.endsWith('/')) {
		loginUrl += '/';
	}
	const rep = await net.doJsonRequest<void>({
		url: `${loginUrl}${api.authSession.URL_END}`,
		method: api.authSession.method,
		sessionId
	}, reqData);
	if (rep.status === api.authSession.SC.ok) {
		return;
	} else if (rep.status === api.authSession.SC.authFailed) {
		const exc = makeException(rep) as LoginException;
		exc.loginFailed = true;
		throw exc;
	} else {
		throw makeException(rep, 'Unexpected status');
	}
}


Object.freeze(exports);