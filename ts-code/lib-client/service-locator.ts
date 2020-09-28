/*
 Copyright (C) 2015 - 2017, 2020 3NSoft Inc.
 
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

import { resolveTxt as resolveDnsTxt } from 'dns';
import { SignedLoad, isLikeSignedKeyCert } from '../lib-common/jwkeys';
import { parse as parseUrl } from 'url';
import { Reply, makeException, NetClient } from './request-utils';

async function readJSONLocatedAt<T>(
	client: NetClient, url: string
): Promise<Reply<T>> {
	if (parseUrl(url).protocol !== 'https:') {
		throw new Error("Url protocol must be https.");
	}
	const rep = await client.doBodylessRequest<T>({
		url,
		method: 'GET',
		responseType: 'json'
	});
	if (rep.status === 200) {
		if (!rep.data) {
			throw makeException(rep, 'Malformed reply');
		}
		return rep;
	} else {
		throw makeException(rep, 'Unexpected status');
	}
}

function transformPathToCompleteUri(
	url: string, path: string, rep: Reply<any>
): string {
	const uInit = parseUrl(url);
	const protoAndHost = `${uInit.protocol}//${uInit.host}`;
	const uPath = parseUrl(path);
	if (!uPath.path || !uPath.href || !uPath.href.startsWith(uPath.path)) {
		throw makeException(rep, `Malformed path parameter ${path}`);
	}
	if (uPath.href.startsWith('/')) {
		return `${protoAndHost}${uPath.href}`;
	} else {
		return `${protoAndHost}/${uPath.href}`;
	}
}

export interface ASMailRoutes {
	delivery?: string;
	retrieval?: string;
	config?: string;
}

/**
 * This returns a promise, resolvable to ASMailRoutes object.
 * @param client
 * @param url
 */
export async function asmailInfoAt(
	client: NetClient, url: string
): Promise<ASMailRoutes> {
	const rep = await readJSONLocatedAt<ASMailRoutes>(client, url);
	const json = rep.data;
	const transform = <ASMailRoutes> {};
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
 * This returns a promise, resolvable to MailerIdRoutes object.
 * @param client
 * @param url
 */
export async function mailerIdInfoAt(
	client: NetClient, url: string
): Promise<MailerIdServiceInfo> {
	const rep = await readJSONLocatedAt<MailerIdServiceInfo>(client, url);
	const json = rep.data;
	const transform = <MailerIdServiceInfo> {};
	if ('string' === typeof json.provisioning) {
		transform.provisioning = transformPathToCompleteUri(
			url, json.provisioning, rep);
	} else {
		throw makeException(rep, 'Malformed reply');
	}
	if (('object' === typeof json["current-cert"]) &&
			isLikeSignedKeyCert(json["current-cert"])) {
		transform.currentCert = json["current-cert"];
		transform.previousCerts = json["previous-certs"];
	} else {
		throw makeException(rep, 'Malformed reply');
	}
	Object.freeze(transform);
	return transform;
}

export interface StorageRoutes {
	owner?: string;
	shared?: string;
	config?: string;
}

/**
 * This returns a promise, resolvable to StorageRoutes object.
 * @param client
 * @param url
 */
export async function storageInfoAt(
	client: NetClient, url: string
): Promise<StorageRoutes> {
	const rep = await readJSONLocatedAt<StorageRoutes>(client, url);
	const json = rep.data;
	const transform = <StorageRoutes> {};
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
 * @param address
 * @return domain string, extracted from a given address
 */
function domainOfAddress(address: string): string {
	address = address.trim();
	const indOfAt = address.lastIndexOf('@');
	if (indOfAt < 0) {
		return address;
	} else {
		return address.substring(indOfAt+1);
	}
}

function checkAndPrepareURL(value: string): string {
	// XXX insert some value sanity check
	
	return 'https://'+value;
}

type ServLocException = web3n.asmail.ServLocException;

function domainNotFoundExc(address: string): ServLocException {
	const exc: ServLocException = {
		runtimeException: true,
		type: 'service-locating',
		address,
		domainNotFound: true
	};
	return exc;
}

function noServiceRecordExc(address: string): ServLocException {
	const exc: ServLocException = {
		runtimeException: true,
		type: 'service-locating',
		address,
		noServiceRecord: true
	};
	return exc;
}

/**
 * This implementation extracts exactly one string value for a given service.
 * All other values are ignored, without raising error about misconfiguration.
 * In time we may have several records for the same service type, yet, for now
 * only one TXT per service per domain is considered valid.
 * @param txtRecords are TXT records from dns.
 * @param serviceLabel is a label of service, for which we want to get string
 * value from TXT record.
 * @return string value for a given service among given dns TXT records, or
 * undefined, when service record is not found.
 */
function extractPair(
	txtRecords: string[][], serviceLabel: string
): string|undefined {
	for (const txtRecord of txtRecords) {
		const txt = txtRecord.join(' ');
		const eqPos = txt.indexOf('=');
		if (eqPos < 0) { continue; }
		const name = txt.substring(0, eqPos).trim();
		if (name === serviceLabel) {
			const value = txt.substring(eqPos+1).trim();
			return value;
		}
	}
	return;
}

/**
 * This is promisifying of node's dns.resolveTxt().
 * @param domain for which we need to get TXT dns records
 * @return a promise, resolvable to two dimensional array of strings, which
 * node's function returns.
 */
function resolveTxt(domain: string): Promise<string[][]> {
	return new Promise<string[][]>((resolve, reject) => {
		// As of March 2017, docs for node say that texts given in a callback
		// are string[][], and node works this way, but definition is incorrect.
		// Therefore, need to insert "as any" into resolve function.
		resolveDnsTxt(domain, (err, texts) => {
			if (err) {
				reject(err);
			} else {
				resolve(texts as any);
			}
		});
	});
}

interface DnsError extends Error {
	code: string;
	hostname: string;
}

const DNS_ERR_CODE = {
	NODATA: 'ENODATA',
	NOTFOUND: 'ENOTFOUND'
};
Object.freeze(DNS_ERR_CODE);

async function getServiceFor(
	address: string, serviceLabel: string
): Promise<string> {
	try {
		const domain = domainOfAddress(address);
		const txtRecords = await resolveTxt(domain);
		const recValue = extractPair(txtRecords, serviceLabel);
		if (!recValue) { throw noServiceRecordExc(address); }
		const url = checkAndPrepareURL(recValue);
		return url;
	} catch (err) {
		if ((<DnsError> err).code === DNS_ERR_CODE.NODATA) {
			throw noServiceRecordExc(address);
		} else if ((<DnsError> err).code === DNS_ERR_CODE.NOTFOUND) {
			throw domainNotFoundExc(address)
		} else {
			throw err;
		}
	}
}

/**
 * @param address
 * @return a promise, resolvable to MailerId service url, that serves
 * domain of a given address.
 */
export async function getMailerIdServiceFor(address: string): Promise<string> {
	return getServiceFor(address, 'mailerid');
}

/**
 * @param address
 * @return a promise, resolvable to ASMail service url, that serves
 * domain of a given address.
 */
export async function getASMailServiceFor(address: string): Promise<string> {
	return getServiceFor(address, 'asmail');
}

/**
 * @param address
 * @return a promise, resolvable to 3NStorage service url, that serves
 * domain of a given address.
 */
export async function getStorageServiceFor(address: string): Promise<string> {
	return getServiceFor(address, '3nstorage');
}

/**
 * @param address
 * @return a promise, resolvable to ASMailRoutes object and mid root domain.
 */
export async function getMailerIdInfoFor(
	client: NetClient, address: string
): Promise<{ info: MailerIdServiceInfo; domain: string; }> {
	const serviceURL = await getMailerIdServiceFor(address);
	const rootAddr = parseUrl(serviceURL).hostname!;
	const info = await mailerIdInfoAt(client, serviceURL);
	return {
		info: info,
		domain: rootAddr
	};
}

Object.freeze(exports);