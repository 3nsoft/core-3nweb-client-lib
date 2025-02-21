/*
 Copyright (C) 2016 - 2017, 2025 3NSoft Inc.
 
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

import { toCanonicalAddress } from '../../lib-common/canonical-address';
import { relyingParty as mid, makeMalformedCertsException } from '../../lib-common/mid-sigs-NaCl-Ed';
import { getKeyCert } from '../../lib-common/jwkeys';
import { getMailerIdInfoFor, ServiceLocator } from '../../lib-client/service-locator';
import { NetClient } from '../../lib-client/request-utils';

type JsonKey = web3n.keys.JsonKey;
type SignedLoad = web3n.keys.SignedLoad;
type PKeyCertChain = web3n.keys.PKeyCertChain;

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
	address: string, certs: PKeyCertChain
): Promise<JsonKey> {
	address = toCanonicalAddress(address);
	const validAt = Math.round(Date.now() / 1000);

	// get MailerId provider's info with a root certificate(s)
	const {
		domain: rootAddr, rootCert
	} = await getRootCertForKey(certs.provCert.kid, resolver, client, address);

	const pkey = mid.verifyPubKey(certs.pkeyCert, address,
		{ user: certs.userCert, prov: certs.provCert, root: rootCert },
		rootAddr, validAt);
	return pkey;
}

async function getRootCertForKey(
	kid: string, resolver: ServiceLocator, client: NetClient, address: string
): Promise<{ domain: string; rootCert: SignedLoad; }> {
	const {
		domain,
		info: { currentCert, previousCerts }
	} = await getMailerIdInfoFor(resolver, client, address);
	let rootCert: SignedLoad;
	if (currentCert.kid === kid) {
		rootCert = currentCert ;
	} else {
		const pastCert = previousCerts.find((cert) => (cert.kid === kid));
		if (!pastCert) {
			throw new Error(
				`Root cert for given key id is not found in server's reply.`
			);
		}
		rootCert = pastCert;
	}
	return { domain, rootCert };
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
	certs: PKeyCertChain, validAt: number
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
	const {
		domain: rootAddr, rootCert
	} = await getRootCertForKey(certs.provCert.kid, resolver, client, address);

	const pkey = mid.verifyPubKey(certs.pkeyCert, address,
		{ user: certs.userCert, prov: certs.provCert, root: rootCert },
		rootAddr, validAt);
	return { address, pkey };
}

Object.freeze(exports);