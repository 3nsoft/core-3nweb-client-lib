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

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.BYTES_PER_ELEMENT !== b.BYTES_PER_ELEMENT) { return false; }
	if (a.length !== b.length) { return false; }
	for (let i=0; i<a.length; i+=1) {
		if (a[i] !== b[i]) { return false; }
	}
	return true;
}