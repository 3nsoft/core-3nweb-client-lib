/*
 Copyright (C) 2021 3NSoft Inc.
 
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

export function makeRuntimeException<T extends web3n.RuntimeException>(
	type: NonNullable<T['type']>, params: Partial<T>, flags: Partial<T>
): T {
	const exc: web3n.RuntimeException = {
		runtimeException: true,
		type,
	};
	for (const [field, val] of Object.entries(params)) {
		if (val !== undefined) {
			exc[field] = val;
		}
	}
	for (const [field, val] of Object.entries(flags)) {
		if (val === true) {
			exc[field] = val;
		}
	}
	return exc as T;
}


Object.freeze(exports);