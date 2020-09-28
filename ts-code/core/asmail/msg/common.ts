/*
 Copyright (C) 2015 - 2018, 2020 3NSoft Inc.
 
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

import { JsonKeyShort } from '../../../lib-common/jwkeys';
import { FolderInfoWithAttrs } from '../../../lib-client/3nstorage/xsp-fs/common';
import * as confApi from '../../../lib-common/service-api/asmail/config';

/**
 * Metadata for message that uses established key pair. 
 * It is an unencrypted part of a message.
 */
export interface MetaForEstablishedKeyPair {
	pid: string;
}

/**
 * Metadata for message that uses introductory keys.
 * It is an unencrypted part of a message.
 */
export interface MetaForNewKey {
	recipientKid: string;
	senderPKey: string;
}

/**
 * Main (zeroth) object json.
 * It is an encrypted part of a message.
 */
export interface MsgEnvelope {
	'Msg Type': string;
	'Subject'?: string;
	'Body': MainBody;
	'Attachments'?: FolderInfoWithAttrs;

	'Flow Params': FlowParams;

	'From': string;
	'To'?: string[];
	'Cc'?: string[],

	'Do Not Reply'?: true;
}

/**
 * Object with suggested next crypto.
 * Located in main object.
 */
export interface SuggestedNextKeyPair {
	pids: string[];
	senderKid: string;
	isSenderIntroKey?: boolean;
	recipientPKey: JsonKeyShort;
	timestamp: number;
}

/**
 * Object with next sending parameter that correspondent should use for
 * replies.
 * Located in main object.
 */
export interface SendingParams {
	timestamp: number;
	auth?: boolean;
	invitation?: string;
}

/**
 * Classical body of the message.
 */
export interface MainBody {
	text?: {
		plain?: string;
		html?: string;
	},
	json?: any;
}

/**
 * Flow parameters a parameters related to sending or message flow process.
 */
export interface FlowParams {
	msgCount: number;
	introCerts?: confApi.p.initPubKey.Certs;
	nextCrypto?: SuggestedNextKeyPair;
	nextSendingParams?: SendingParams;
}

Object.freeze(exports);