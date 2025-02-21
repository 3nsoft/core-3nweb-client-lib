/*
 Copyright (C) 2015, 2025 3NSoft Inc.
 
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

/**
 * This defines interfaces for mail configuration requests.
 */

import * as midApi from '../mailer-id/login';

type ASMailConfigParams = web3n.asmail.ASMailConfigParams;

export const ERR_SC = {
	malformed: 400,
	needAuth: midApi.ERR_SC.needAuth,
	server: 500
};
Object.freeze(ERR_SC);

export const PARAM_SC = {
	ok: 200
};
Object.freeze(PARAM_SC);

export namespace midLogin {

	export const MID_URL_PART = 'login/mailerid/';
	export const START_URL_END = MID_URL_PART + midApi.startSession.URL_END;
	export const AUTH_URL_END = MID_URL_PART + midApi.authSession.URL_END;

}
Object.freeze(midLogin);

export namespace closeSession {

	export const URL_END = 'close-session';

}
Object.freeze(closeSession);
	
export interface InvitesList {
	[invite: string]: number;
}

export namespace p {

	export namespace initPubKey {

		export const URL_END = 'param/init-pub-key';

		export type Certs = ASMailConfigParams['init-pub-key'];

	}
	Object.freeze(initPubKey);
	
	export namespace authSenderPolicy {

		export const URL_END = 'param/auth-sender/policy';

		export type Policy = ASMailConfigParams['auth-sender/policy'];

	}
	Object.freeze(authSenderPolicy);

	export namespace authSenderWhitelist {

		export const URL_END = 'param/auth-sender/whitelist';

		export type List = ASMailConfigParams['auth-sender/whitelist'];

	}
	Object.freeze(authSenderWhitelist);

	export namespace authSenderBlacklist {

		export const URL_END = 'param/auth-sender/blacklist';

		export type List = ASMailConfigParams['auth-sender/blacklist'];

	}
	Object.freeze(authSenderBlacklist);
	
	export namespace authSenderInvites {

		export const URL_END = 'param/auth-sender/invites';

		export type List = ASMailConfigParams['auth-sender/invites'];

	}
	Object.freeze(authSenderInvites);

	export namespace anonSenderPolicy {

		export const URL_END = 'param/anon-sender/policy';

		export type Policy = ASMailConfigParams['anon-sender/policy'];

	}
	Object.freeze(anonSenderPolicy);

	export namespace anonSenderInvites {

		export const URL_END = 'param/anon-sender/invites';

		export type List = ASMailConfigParams['anon-sender/invites'];

	}
	Object.freeze(anonSenderInvites);

}
Object.freeze(p);

export interface ErrorReply {
	error: string;
}

Object.freeze(exports);