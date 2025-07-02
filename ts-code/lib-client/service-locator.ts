/*
 Copyright (C) 2015 - 2017, 2020 - 2021, 2024 3NSoft Inc.
 
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
import { parse as parseUrl } from 'url';
import { Reply, makeException, NetClient } from './request-utils';
import { promises as dnsPromises } from 'dns';
import { makeRuntimeException } from '../lib-common/exceptions/runtime';

type SignedLoad = web3n.keys.SignedLoad;

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

type ServLocException = web3n.ServLocException;
type DNSConnectException = web3n.DNSConnectException;

function domainNotFoundExc(
	address: string,
	cause: { code: string; hostname: string; message: string; }
): ServLocException {
	return makeRuntimeException<ServLocException>(
		'service-locating', { address, cause }, { domainNotFound: true }
	);
}

function noServiceRecordExc(address: string): ServLocException {
	return makeRuntimeException<ServLocException>(
		'service-locating', { address }, { noServiceRecord: true }
	);
}

function noConnectionExc(
	cause: { code: string; hostname: string; message: string; }
): DNSConnectException {
	return makeRuntimeException<DNSConnectException>(
		'connect', {
			connectType: 'dns',
			message: `The most likely cause of this error is device not connected. Next likely cause is DNS not setup, or not connecting properly. Like the saying goes: "It's not DNS. There is no way it's DNS. It was DNS."`,
			cause
		}, {}
	);
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
	txtRecords: string[][], serviceLabel: ServiceTypeDNSLabel
): string|undefined {
	for (const txtRecord of txtRecords) {
		let joinedTXTstanzas = txtRecord.join('');
		let record = getRecordAtStartOf(joinedTXTstanzas);
		while (record) {
			if (record.service === serviceLabel) {
				const value = record.value.trim();
				if (value.length > 0) {
					return value;
				}
			}
			if (record.txtTail) {
				record = getRecordAtStartOf(record.txtTail);
			} else {
				break;
			}
		}
	}
	return;
}

const recordsStarts: { [key in ServiceTypeDNSLabel]: string; } = {
	"3nstorage": '3nstorage=',
	asmail: 'asmail=',
	mailerid: 'mailerid='
}

function getRecordAtStartOf(txt: string): {
	service: ServiceTypeDNSLabel; value: string; txtTail?: string;
}|undefined {
	let service: ServiceTypeDNSLabel|undefined = undefined;
	for (const [ label, startSeq ] of Object.entries(recordsStarts)) {
		if (txt.startsWith(startSeq)) {
			service = label as ServiceTypeDNSLabel;
			txt = txt.substring(startSeq.length);
			break;
		}
	}
	if (!service) { return; }
	for (const delimiter of Object.values(recordsStarts)) {
		const endPos = txt.indexOf(delimiter);
		if (endPos >= 0) {
			return {
				service,
				value: txt.substring(0, endPos),
				txtTail: txt.substring(endPos)
			};
		}
	}
	return {
		service,
		value: txt
	};
}

interface DnsError extends Error {
	code: string;
	hostname: string;
}

const DNS_ERR_CODE = {
	NODATA: 'ENODATA',
	NOTFOUND: 'ENOTFOUND',
	ESERVFAIL: 'ESERVFAIL'
};
Object.freeze(DNS_ERR_CODE);

export type ServiceTypeDNSLabel = 'mailerid' | 'asmail' | '3nstorage';

export type ServiceLocatorMaker = (
	serviceLabel: ServiceTypeDNSLabel
) => ServiceLocator;

export type ServiceLocator = (address: string) => Promise<string>;

export function makeServiceLocator(
	resolver: {
		resolveTxt: (typeof dnsPromises)['resolveTxt'];
	}
): ServiceLocatorMaker {
	return serviceLabel => async address => {
		try {
			const domain = domainOfAddress(address);
			const txtRecords = await resolver.resolveTxt(domain);
			const recValue = extractPair(txtRecords, serviceLabel);
			if (!recValue) { throw noServiceRecordExc(address); }
			const url = checkAndPrepareURL(recValue);
			return url;
		} catch (err) {
			const { code, hostname, message } = (err as DnsError);
			if (code === DNS_ERR_CODE.NODATA) {
				throw noServiceRecordExc(address);
			} else if (code === DNS_ERR_CODE.ESERVFAIL) {
				throw noConnectionExc({ code, hostname, message });
			} else if (hostname) {
				throw domainNotFoundExc(address, { code, hostname, message });
			} else {
				throw err;
			}
		}
	};
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
	const rootAddr = parseUrl(serviceURL).hostname!;
	const info = await mailerIdInfoAt(client, serviceURL);
	return {
		info: info,
		domain: rootAddr
	};
}

Object.freeze(exports);