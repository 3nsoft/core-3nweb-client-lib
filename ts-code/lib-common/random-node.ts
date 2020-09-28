/*
 Copyright (C) 2015 - 2017 3NSoft Inc.
 
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

import { base64urlSafe } from './buffer-utils';
import { randomBytes } from 'crypto';

export function bytesSync(numOfBytes: number): Uint8Array {
	return randomBytes(numOfBytes);
}

export function bytes(numOfBytes: number): Promise<Uint8Array> {
	return new Promise((res, rej) => randomBytes(numOfBytes, (err, buf) => {
		if (err) { rej(err); }
		else { res(buf); }
	}));
}

export function uint8Sync(): number {
	return randomBytes(1)[0];
}

export async function uint8(): Promise<number> {
	return (await randomBytes(1))[0];
}

export function uint48Sync(): number {
	const b = randomBytes(6);
	const l = b[0] + (b[1] << 8) + (b[2] << 16) + (b[3] << 24);
	const h = b[4] + (b[5] << 8);
	return h*0x100000000 + l;
}

export async function uint48(): Promise<number> {
	const b = await bytes(6);
	const l = b[0] + (b[1] << 8) + (b[2] << 16) + (b[3] << 24);
	const h = b[4] + (b[5] << 8);
	return h*0x100000000 + l;
}

export function stringOfB64UrlSafeCharsSync(numOfChars: number): string {
	const numOfbytes = 3*(1 + Math.floor(numOfChars/4));
	const byteArr = randomBytes(numOfbytes);
	return base64urlSafe.pack(byteArr).substring(0, numOfChars);
}

export function stringOfB64CharsSync(numOfChars: number): string {
	const numOfbytes = 3*(1 + Math.floor(numOfChars/4));
	return randomBytes(numOfbytes).toString('base64').substring(0, numOfChars);
}

export async function stringOfB64UrlSafeChars(numOfChars: number):
		Promise<string> {
	const numOfbytes = 3*(1 + Math.floor(numOfChars/4));
	const byteArr = await bytes(numOfbytes);
	return base64urlSafe.pack(byteArr).substring(0, numOfChars);
}

export async function stringOfB64Chars(numOfChars: number):
		Promise<string> {
	const numOfbytes = 3*(1 + Math.floor(numOfChars/4));
	const byteArr = await bytes(numOfbytes);
	return (byteArr as Buffer).toString('base64').substring(0, numOfChars);
}

Object.freeze(exports);