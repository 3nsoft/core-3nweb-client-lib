/*
 Copyright (C) 2016 - 2017 3NSoft Inc.
 
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

import { toCanonicalAddress } from '../../lib-common/canonical-address';
import { relyingParty as mid, makeMalformedCertsException } from '../../lib-common/mid-sigs-NaCl-Ed';
import { JsonKey, getKeyCert } from '../../lib-common/jwkeys';
import * as confApi from '../../lib-common/service-api/asmail/config';
import { getMailerIdInfoFor, ServiceLocator } from '../../lib-client/service-locator';
import { NetClient } from '../../lib-client/request-utils';

/**
 * This returns a promise, resolvable to public key, when certificates'
 * verification is successful, and rejectable in all other cases.
 * @param client
 * @param resolver
 * @param address is an expected address of a principal in a certificate.
 * It is an error, if certs contain a different address.
 * @param certs is an object with a MailerId certificates chain for a public key
 */
export async function checkAndExtractPKey(
	client: NetClient, resolver: ServiceLocator,
	address: string, certs: confApi.p.initPubKey.Certs
): Promise<JsonKey> {
	address = toCanonicalAddress(address);
	const validAt = Math.round(Date.now() / 1000);

	// get MailerId provider's info with a root certificate(s)
	const data = await getMailerIdInfoFor(resolver, client, address);

	// TODO choose proper root certificate, as it may not be current one

	const rootAddr = data.domain;
	const rootCert = data.info.currentCert;
	const pkey = mid.verifyPubKey(certs.pkeyCert, address,
		{ user: certs.userCert, prov: certs.provCert, root: rootCert },
		rootAddr, validAt);
	return pkey;
}

/**
 * This returns a promise, resolvable to public key and related address, when
 * certificates' verification is successful, and rejectable in all other cases.
 * @param client
 * @param resolver
 * @param certs is an object with a MailerId certificates chain for a public key
 * @param validAt is epoch in seconds (!), for which certificates must be valid
 */
export async function checkAndExtractPKeyWithAddress(
	client: NetClient, resolver: ServiceLocator,
	certs: confApi.p.initPubKey.Certs, validAt: number
): Promise<{ pkey: JsonKey; address: string; }> {
	if (typeof validAt !== 'number') { throw new Error(`Invalid time parameter: ${validAt}`); }

	// address here comes from certificates; we return it for further checks
	let address: string;
	try {
		address = getKeyCert(certs.pkeyCert).cert.principal.address;
	} catch (err) {
		throw makeMalformedCertsException(`Cannot read public key certificate`, err);
	}

	// get MailerId provider's info with a root certificate(s)
	const data = await getMailerIdInfoFor(resolver, client, address);

	// TODO choose proper root certificate, as it may not be current one

	const rootAddr = data.domain;
	const rootCert = data.info.currentCert;
	const pkey = mid.verifyPubKey(certs.pkeyCert, address,
		{ user: certs.userCert, prov: certs.provCert, root: rootCert },
		rootAddr, validAt);
	return { address, pkey };
}

Object.freeze(exports);