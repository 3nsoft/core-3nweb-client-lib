/*
 Copyright (C) 2015 - 2017, 2020 - 2021, 2024 - 2026 3NSoft Inc.
 
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

import { isLikeSignedKeyCert } from '../lib-common/jwkeys';
import { Reply, NetClient } from './request-utils';
import { MailerIdRootRoute } from '../lib-common/service-api/mailer-id/root-route';
import { StorageRootRoute } from '../lib-common/service-api/3nstorage/root-route';
import { ASMailRootRoute } from '../lib-common/service-api/asmail/root-route';
import { makeMalformedReplyHTTPException, makeUnexpectedStatusHTTPException } from '../lib-common/exceptions/http';
import { ServiceLocator } from './networks';

type SignedLoad = web3n.keys.SignedLoad;

async function readJSONLocatedAt<T>(
	client: NetClient, url: string
): Promise<Reply<T>> {
	if ((new URL(url)).protocol !== 'https:') {
		throw new Error("Url protocol must be https.");
	}
	const rep = await client.doBodylessRequest<T>({
		url,
		method: 'GET',
		responseType: 'json'
	});
	if (rep.status === 200) {
		if (!rep.data) {
			throw makeMalformedReplyHTTPException(rep);
		}
		return rep;
	} else {
		throw makeUnexpectedStatusHTTPException(rep);
	}
}

function transformPathToCompleteUri(
	url: string, path: string, rep: Reply<any>
): string {
	const uInit = new URL(url);
	const protoAndHost = `${uInit.protocol}//${uInit.host}`;
	if (path.startsWith('/')) {
		return `${protoAndHost}${path}`;
	} else {
		return `${protoAndHost}/${path}`;
	}
}

/**
 * This returns a promise, resolvable to ASMailRootRoute object.
 * @param client
 * @param url
 */
export async function asmailInfoAt(
	client: NetClient, url: string
): Promise<ASMailRootRoute> {
	const rep = await readJSONLocatedAt<ASMailRootRoute>(client, url);
	const json = rep.data;
	const transform: ASMailRootRoute = {};
	if ('string' === typeof json.delivery) {
		transform.delivery = transformPathToCompleteUri(url, json.delivery, rep);
	}
	if ('string' === typeof json.retrieval) {
		transform.retrieval = transformPathToCompleteUri(url, json.retrieval, rep);
	}
	if ('string' === typeof json.config) {
		transform.config = transformPathToCompleteUri(url, json.config, rep);
	}
	Object.freeze(transform);
	return transform;
}

export interface MailerIdServiceInfo {
	provisioning: string;
	currentCert: SignedLoad;
	previousCerts: SignedLoad[];
}

/**
 * This returns a promise, resolvable to MailerIdRootRoute object.
 * @param client
 * @param url
 */
export async function mailerIdInfoAt(
	client: NetClient, url: string
): Promise<MailerIdServiceInfo> {
	const rep = await readJSONLocatedAt<MailerIdRootRoute>(client, url);
	const json = rep.data;
	const transform = {} as MailerIdServiceInfo;
	if ('string' === typeof json.provisioning) {
		transform.provisioning = transformPathToCompleteUri(url, json.provisioning, rep);
	} else {
		throw makeMalformedReplyHTTPException(rep);
	}
	if (isLikeSignedKeyCert(json["current-cert"])) {
		transform.currentCert = json["current-cert"];
		transform.previousCerts = (Array.isArray(json["previous-certs"]) ?
			json["previous-certs"].filter(isLikeSignedKeyCert) : []
		);
	} else {
		throw makeMalformedReplyHTTPException(rep);
	}
	Object.freeze(transform);
	return transform;
}

/**
 * This returns a promise, resolvable to StorageRootRoute object.
 * @param client
 * @param url
 */
export async function storageInfoAt(
	client: NetClient, url: string
): Promise<StorageRootRoute> {
	const rep = await readJSONLocatedAt<StorageRootRoute>(client, url);
	const json = rep.data;
	const transform = <StorageRootRoute> {};
	if (typeof json.owner === 'string') {
		transform.owner = transformPathToCompleteUri(url, json.owner, rep);
	}
	if (typeof json.shared === 'string') {
		transform.shared = transformPathToCompleteUri(url, json.shared, rep);
	}
	if (typeof json.config === 'string') {
		transform.config = transformPathToCompleteUri(url, json.config, rep);
	}
	return transform;
}

/**
 * @param resolver
 * @param address
 * @return a promise, resolvable to ASMailRoutes object and mid root domain.
 */
export async function getMailerIdInfoFor(
	resolver: ServiceLocator, client: NetClient, address: string
): Promise<{ info: MailerIdServiceInfo; domain: string; }> {
	const serviceURL = await resolver(address);
	const rootAddr = (new URL(serviceURL)).hostname;
	const info = await mailerIdInfoAt(client, serviceURL);
	return {
		info: info,
		domain: rootAddr
	};
}

Object.freeze(exports);