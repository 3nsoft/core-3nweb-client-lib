/*
 Copyright (C) 2015, 2025 3NSoft Inc.
 
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

export function deepEqual(a: any, b: any, trimUndefinedObjFields = true): boolean {
	
	let t = typeof a;
	
	if (t !== typeof b) { return false; }
	
	if (t !== 'object') {
		return (a === b);
	}
	
	if (a === b) { return true; }
	if ((a === null) || (b === null)) { return false; }
		
	if (Array.isArray(a)) {
		if (!Array.isArray(b)) { return false; }
		let aArr = <Array<any>> a;
		let bArr = <Array<any>> b;
		if (aArr.length !== bArr.length) { return false; }
		for (let i=0; i<aArr.length; i+=1) {
			if (!deepEqual(aArr[i], bArr[i])) { return false; }
		}
	} else {
		let aKeys = Object.keys(a);
		let bKeys = Object.keys(b);
		if (trimUndefinedObjFields) {
			for (let i=0; i<aKeys.length; i+=1) {
				if (a[aKeys[i]] === undefined) {
					aKeys.splice(i, 1);
					i -= 1;
				}
			}
			for (let i=0; i<bKeys.length; i+=1) {
				if (b[bKeys[i]] === undefined) {
					bKeys.splice(i, 1);
					i -= 1;
				}
			}
		}
		if (aKeys.length !== bKeys.length) { return false; }
		for (let i=0; i<aKeys.length; i+=1) {
			let key = aKeys[i];
			if (!deepEqual(a[key], b[key])) { return false; }
		}
	}
	
	return true;
}

Object.freeze(exports);