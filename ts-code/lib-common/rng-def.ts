/*
 Copyright (C) 2026 3NSoft Inc.
 
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

import { base64urlSafe } from "./buffer-utils";

export type AsyncRNG = (n: number) => Promise<Uint8Array>;

export async function stringOfB64UrlSafeChars(numOfChars: number, random: AsyncRNG): Promise<string> {
  const numOfbytes = 3*(1 + Math.floor(numOfChars/4));
  const byteArr = await random(numOfbytes);
  return base64urlSafe.pack(byteArr).substring(0, numOfChars);
}

export async function stringOfB64Chars(numOfChars: number, random: AsyncRNG): Promise<string> {
  const numOfbytes = 3*(1 + Math.floor(numOfChars/4));
  const byteArr = await random(numOfbytes);
  return (byteArr as Buffer).toString('base64').substring(0, numOfChars);
}

Object.freeze(exports);