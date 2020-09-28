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

/*
 * This file contains elements common for both parent and child parts of cryptor
 * service.
 */

export const CRYPTOR_CHANNEL = 'cryptor';

export const reqNames = {
	scrypt: 'scrypt',
	sboxPack: 'sbox-pack',
	sboxOpen: 'sbox-open',
	sboxWNPack: 'sbox-wn-pack',
	sboxWNOpen: 'sbox-wn-open',
	boxDHSharedKey: 'box-dh-shared-key',
	boxGenPubKey: 'box-gen-pub-key',
	signatureKeyPair: 'signature-key-pair',
	signature: 'signature',
	verifySignature: 'verify-signature'
};
Object.freeze(reqNames);

export interface ScryptRequest {
	passwd: Buffer;
	salt: Buffer;
	logN: number;
	r: number;
	p: number;
	dkLen: number;
}

export interface OpenWNRequest {
	c: Buffer;
	k: Buffer;
}

export interface OpenRequest extends OpenWNRequest {
	n: Buffer;
}

export interface PackRequest {
	m: Buffer;
	n: Buffer;
	k: Buffer;
}

export interface DHSharedKeyRequest {
	pk: Buffer;
	sk: Buffer;
}

export interface SignatureRequest {
	m: Buffer;
	sk: Buffer;
}

export interface VerifySigRequest {
	sig: Buffer;
	m: Buffer;
	pk: Buffer;
}

export interface SigKeyPairReply {
	pkey: Buffer;
	skey: Buffer;
}

Object.freeze(exports);