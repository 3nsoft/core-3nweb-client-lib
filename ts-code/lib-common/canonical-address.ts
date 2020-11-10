/*
 Copyright (C) 2016, 2020 3NSoft Inc.
 
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

import { toASCII } from 'punycode';

/**
 * @param address
 * @return a canonical form of a given address.
 * If given address is not ok, exception is thrown.
 */
export function toCanonicalAddress(address: string): string {
	const indOfAt = address.indexOf('@');
	let user: string;
	let domain: string;
	if (indOfAt < 0) {
		domain = address;
		user = '';
	} else {
		domain = address.substring(indOfAt+1);
		user = address.substring(0, indOfAt).replace(whiteSpace, '');
	}
	checkDomainString(domain, address);
	return (user+'@'+domain).toLowerCase();
}

const whiteSpace = /\s/g;
const invalidInDomain = /[^a-zA-Z0-9\-\.]/;

function checkDomainString(d: string, addrForErrMsg: string): void {
	if (d.length === 0) { throw makeParseExc(addrForErrMsg, `Domain is empty`); }
	if (d.startsWith('xn--')) { throw makeParseExc(addrForErrMsg,
		`Domain can't be in puny code`); }
	let ascii: string;
	try {
		ascii = toASCII(d);
	} catch (err) {
		throw makeParseExc(addrForErrMsg, err);
	}
	if (invalidInDomain.test(ascii)) {
		throw makeParseExc(addrForErrMsg);
	}
}

function makeParseExc(address: string, cause?: any): UserIdParseException {
	return {
		runtimeException: true,
		type: 'user-id-parse',
		address,
		message: `Can't parse given address as valid user id`,
		cause
	};
}

export interface UserIdParseException extends web3n.RuntimeException {
	type: 'user-id-parse';
	address: string;
}

export function areAddressesEqual(a: string, b: string): boolean {
	const canonicalA = toCanonicalAddress(a);
	if (!canonicalA) { return false; }
	const canonicalB = toCanonicalAddress(b);
	if (!canonicalB) { return false; }
	return (canonicalA === canonicalB);
}

/**
 * @param address
 * @return if given address is ok, its canonical form is returned.
 * Otherwise, undefined is returned.
 */
export function checkAndTransformAddress(address: string): string|undefined {
	try {
		return toCanonicalAddress(address);
	} catch (err) { }
}

Object.freeze(exports);