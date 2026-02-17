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
import { CONNREFUSED, promises as dnsPromises, NODATA, NOTFOUND, SERVFAIL, TIMEOUT } from 'dns';
import { makeRuntimeException } from '../lib-common/exceptions/runtime';
import { MailerIdRootRoute } from '../lib-common/service-api/mailer-id/root-route';
import { StorageRootRoute } from '../lib-common/service-api/3nstorage/root-route';
import { ASMailRootRoute } from '../lib-common/service-api/asmail/root-route';
import { makeMalformedReplyHTTPException, makeUnexpectedStatusHTTPException } from '../lib-common/exceptions/http';
import { LogError } from './logging/log-to-file';

type RuntimeException = web3n.RuntimeException;
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

export type ServiceTypeDNSLabel = 'mailerid' | 'asmail' | '3nstorage';

export type ServiceLocatorMaker = (
	serviceLabel: ServiceTypeDNSLabel,
	logError: LogError
) => ServiceLocator;

export type ServiceLocator = (address: string) => Promise<string>;

export interface DnsResolver {
	resolveTxt: (typeof dnsPromises)['resolveTxt'];
}

export function makeServiceLocator(...resolvers: DnsResolver[]): ServiceLocatorMaker {
	if (resolvers.length === 0) {
		throw Error(`no DNS resolvers given`);
	}
	return (serviceLabel, logError) => async address => {
		const domain = domainOfAddress(address);
		let prevConnectionExc: DNSConnectException|undefined = undefined;
		for (let i=0; i<resolvers.length; i+=1) {
			const resolver = resolvers[i]
			try {
				const txtRecords = await resolver.resolveTxt(domain);
				const recValue = extractPair(txtRecords, serviceLabel);
				if (!recValue) { throw noServiceRecordExc(address); }
				const url = checkAndPrepareURL(recValue);
				return url;
			} catch (err) {
				await logError(err, `Resolver ${i+1} fails to get TXT records of ${domain}`);
				const { code, hostname, message } = (err as DnsError);
				if (code === NODATA) {
					throw noServiceRecordExc(address);
				} else if ((code === SERVFAIL)
				|| (code === CONNREFUSED)
				|| (code === TIMEOUT)) {
					if (!prevConnectionExc) {
						prevConnectionExc = noConnectionExc({ code, hostname, message });
					}
				} else if ((code === NOTFOUND) || hostname) {
					throw domainNotFoundExc(address, { code, hostname, message });
				} else {
					if (!prevConnectionExc) {
						prevConnectionExc = err;
					}
				}
			}
		}
		throw prevConnectionExc;
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
	const rootAddr = (new URL(serviceURL)).hostname;
	const info = await mailerIdInfoAt(client, serviceURL);
	return {
		info: info,
		domain: rootAddr
	};
}

Object.freeze(exports);