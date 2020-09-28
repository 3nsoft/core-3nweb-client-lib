/*
 Copyright (C) 2018 3NSoft Inc.
 
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

import { deepFind } from '../json-utils';

export function packIntoArr<T extends object>(
		o: T, filterSpecial: (val: any) => boolean): any[] {
	const special: [ string[], any ][] = [];
	for (const x of deepFind(o, filterSpecial)) {
		special.push([ x.pos, x.val ]);
	}

	if (special.length === 0) {
		return [ JSON.stringify(o) ];
	}

	const jsonReplacer = (_, v) => (
		special.find(posAndVal => (posAndVal[1] === v)) ? undefined : v);
	const arr: any[] = [ JSON.stringify(o, jsonReplacer) ];

	for (const [ pos, val ] of special) {
		arr.push(pos.join('.'), val);
	}

	return arr;
}

export function unpackFromArr<T>(arr: any[]): T {
	const o: any = JSON.parse(arr[0]);
	for (let i=1; (i+1)<arr.length; i+=2) {
		const place = (arr[i] as string).split('.');
		const value = arr[i+1];
		setDeep(o, place, value);
	}
	return o;
}

function setDeep(obj: object, place: string[], val: any): void {
	let fieldInd = 0;
	while (fieldInd < (place.length-1)) {
		obj = obj[place[fieldInd]];
		fieldInd += 1;
	}
	obj[place[fieldInd]] = val;
}
