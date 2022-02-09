/*
 Copyright (C) 2020 3NSoft Inc.
 
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

/**
 * @param u is an unsigned integer up to 16-bits to be stored big-endian way in
 * 2 bytes.
 */
export function packUintTo2Bytes(u: number, b: Buffer, i: number): void {
	if (u > 0xffff) { throw new Error(
		'Cannot store number bigger than 2^16-1'); }
	if (b.length < i+2) { throw new Error(
		'Given array has less than 2 bytes, starting with a given index.'); }
	b[i] = u >>> 8;
	b[i+1] = u;
}

/**
 * @param x
 * @param i
 * @return unsigned integer (up to 16 bits), stored big-endian way
 * in 2 bytes of x, starting at index i.
 */
export function uintFrom2Bytes(x: Uint8Array, i = 0): number {
	if (x.length < i+2) { throw new Error(
		'Given array has less than 2 bytes, starting with a given index.'); }
	return (x[i] << 8) | x[i+1];
}

/**
 * @param u is an unsigned integer up to 24-bits to be stored big-endian way in
 * 3 bytes.
 */
export function packUintTo3Bytes(u: number, b: Buffer, i: number): void {
	if (u > 0xffffff) { throw new Error(
		'Cannot store number bigger than 2^24-1'); }
	if (b.length < i+3) { throw new Error(
		'Given array has less than 3 bytes, starting with a given index.'); }
	b[i] = u >>> 16;
	b[i+1] = u >>> 8;
	b[i+2] = u;
}

/**
 * @param x
 * @param i
 * @return unsigned integer (up to 24 bits), stored big-endian way
 * in 3 bytes of x, starting at index i.
 */
export function uintFrom3Bytes(x: Uint8Array, i = 0): number {
	if (x.length < i+3) { throw new Error(
		'Given array has less than 3 bytes, starting with a given index.'); }
	return (x[i] << 16) | (x[i+1] << 8) | x[i+2];
}

/**
 * @param u is an unsigned integer up to 32-bits to be stored big-endian way in
 * 4 bytes.
 */
export function packUintTo4Bytes(u: number, b: Buffer, i: number): void {
	if (u > 0xffffffff) { throw new Error(
		'Cannot store number bigger than 2^32-1'); }
	if (b.length < i+4) { throw new Error(
		'Given array has less than 4 bytes, starting with a given index.'); }
	b[i] = u >>> 24;
	b[i+1] = u >>> 16;
	b[i+2] = u >>> 8;
	b[i+3] = u;
}

/**
 * @param x
 * @param i
 * @return unsigned integer (up to 32 bits), stored big-endian way
 * in 4 bytes of x, starting at index i.
 */
export function uintFrom4Bytes(x: Uint8Array, i = 0): number {
	if (x.length < i+4) { throw new Error(
		'Given array has less than 4 bytes, starting with a given index.'); }
	// Note that (x << 24) may produce negative number, probably due to
	// treating intermediate integer as signed, and pulling sign to resulting
	// float number. Hence, we need a bit different operation here.
	return (x[i] * 0x1000000) + ((x[i+1] << 16) | (x[i+2] << 8) | x[i+3]);
}

/**
 * @param u is an unsigned integer up to 48-bits to be stored big-endian way in
 * 6 bytes.
 */
export function packUintTo6Bytes(u: number, b: Buffer, i: number): void {
	if (u > 0xffffffffffff) { throw new Error(
		'Cannot store number bigger than 2^48-1'); }
	if (b.length < i+6) { throw new Error(
		'Given array has less than 6 bytes, starting with a given index.'); }
	const h = Math.floor(u / 0x100000000);
	const l = u % 0x100000000;
	b[i] = h >>> 8;
	b[i+1] = h;
	b[i+2] = l >>> 24;
	b[i+3] = l >>> 16;
	b[i+4] = l >>> 8;
	b[i+5] = l;
}

/**
 * @param x
 * @param i
 * @return unsigned integer (up to 48 bits), stored big-endian way
 * in 6 bytes of x, starting at index i.
 */
export function uintFrom6Bytes(x: Uint8Array, i = 0): number {
	if (x.length < i+6) { throw new Error(
		'Given array has less than 6 bytes, starting with a given index.'); }
	// Note that (x << 24) may produce negative number, probably due to
	// treating intermediate integer as signed, and pulling sign to resulting
	// float number. Hence, we need a bit different operation here.
	const h = (x[i] << 8) | x[i+1];
	const l = (x[i] * 0x1000000) + ((x[i+3] << 16) | (x[i+4] << 8) | x[i+5]);
	return (h*0x100000000 + l);
}

/**
 * @param u is an unsigned integer up to 53-bits to be stored big-endian way in
 * 8 bytes.
 */
export function packUintTo8Bytes(u: number, b: Buffer, i: number): void {
	if (u > Number.MAX_SAFE_INTEGER) { throw new Error(
		'Cannot store number bigger than 2^53-1'); }
	if (b.length < i+8) { throw new Error(
		'Given array has less than 8 bytes, starting with a given index.'); }
	const h = Math.floor(u / 0x100000000);
	const l = u % 0x100000000;
	b[i] = h >>> 24;
	b[i+1] = h >>> 16;
	b[i+2] = h >>> 8;
	b[i+3] = h;
	b[i+4] = l >>> 24;
	b[i+5] = l >>> 16;
	b[i+6] = l >>> 8;
	b[i+7] = l;
}

/**
 * @param x
 * @param i
 * @return unsigned integer (up to 53 bits), stored big-endian way
 * in 8 bytes of x, starting at index i.
 */
export function uintFrom8Bytes(x: Uint8Array, i = 0): number {
	if (x.length < i+8) { throw new Error(
		'Given array has less than 8 bytes, starting with a given index.'); }
	// Note that (x << 24) may produce negative number, probably due to
	// treating intermediate integer as signed, and pulling sign to resulting
	// float number. Hence, we need a bit different operation here.
	const h = (x[i] * 0x1000000) + ((x[i+1] << 16) | (x[i+2] << 8) | x[i+3]);
	const l = (x[i+4] * 0x1000000) + ((x[i+5] << 16) | (x[i+6] << 8) | x[i+7]);
	return (h*0x100000000 + l);
}


Object.freeze(exports);