/*
 Copyright (C) 2016 3NSoft Inc.
 
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
 * @param address
 * @return a canonical form of a given address.
 * If given address is not ok, exception is thrown.
 */
export function toCanonicalAddress(address: string): string {
	address = address.trim();
	const indOfAt = address.lastIndexOf('@');
	let user: string;
	let domain: string;
	if (indOfAt <= 0) {
		domain = address;
		user = '';
	} else {
		domain = address.substring(indOfAt+1);
		user = address.substring(0, indOfAt);
		if (user.indexOf('@') >= 0) { throw new Error(
			`Malformed address string: "${address}".`); }
		user = user.split(/\s+/).join('');
	}
	if (domain.length === 0) { throw new Error(
		`Domain is empty in "${address}"`); }
	return (user+'@'+domain).toLowerCase();
}

export function areAddressesEqual(a: string, b: string): boolean {
	if (!a || !b) { return false; }
	return (toCanonicalAddress(a) === toCanonicalAddress(b));
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