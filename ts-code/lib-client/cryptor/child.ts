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
 * This is a start script for crypotor's child process.
 */

import { commToParent, RequestEnvelope }
	from '../../lib-common/ipc/node-child-ipc';
import { reqNames, ScryptRequest, CRYPTOR_CHANNEL, OpenWNRequest, OpenRequest,
	PackRequest, DHSharedKeyRequest, SignatureRequest, VerifySigRequest,
	SigKeyPairReply }
	from './common';
import * as nacl from 'ecma-nacl';
import { toBuffer, bufFromJson } from '../../lib-common/buffer-utils';

const parent = commToParent(CRYPTOR_CHANNEL);
const arrFactory = nacl.arrays.makeFactory();

parent.addHandler(reqNames.scrypt, scrypt);
async function scrypt(env: RequestEnvelope<ScryptRequest>):
		Promise<Buffer> {
	return toBuffer(nacl.scrypt(
		bufFromJson(env.req.passwd),
		bufFromJson(env.req.salt),
		env.req.logN,
		env.req.r,
		env.req.p,
		env.req.dkLen,
		(p: number) => { parent.notifyOfProgressOnRequest(env, p); },
		arrFactory));
}

parent.addHandler(reqNames.sboxWNOpen, sboxWNOpen);
async function sboxWNOpen(env: RequestEnvelope<OpenWNRequest>):
		Promise<Buffer> {
	return toBuffer(nacl.secret_box.formatWN.open(
		bufFromJson(env.req.c),
		bufFromJson(env.req.k),
		arrFactory));
}

parent.addHandler(reqNames.sboxOpen, sboxOpen);
async function sboxOpen(env: RequestEnvelope<OpenRequest>):
		Promise<Buffer> {
	return toBuffer(nacl.secret_box.open(
		bufFromJson(env.req.c),
		bufFromJson(env.req.n),
		bufFromJson(env.req.k),
		arrFactory));
}

parent.addHandler(reqNames.sboxPack, sboxPack);
async function sboxPack(env: RequestEnvelope<PackRequest>):
		Promise<Buffer> {
	return toBuffer(nacl.secret_box.pack(
		bufFromJson(env.req.m),
		bufFromJson(env.req.n),
		bufFromJson(env.req.k),
		arrFactory));
}

parent.addHandler(reqNames.sboxWNPack, sboxWNPack);
async function sboxWNPack(env: RequestEnvelope<PackRequest>):
		Promise<Buffer> {
	return toBuffer(nacl.secret_box.formatWN.pack(
		bufFromJson(env.req.m),
		bufFromJson(env.req.n),
		bufFromJson(env.req.k),
		arrFactory));
}

parent.addHandler(reqNames.boxGenPubKey, boxGenPubKey);
async function boxGenPubKey(env: RequestEnvelope<Buffer>):
		Promise<Buffer> {
	return toBuffer(nacl.box.generate_pubkey(
		bufFromJson(env.req),
		arrFactory));
}

parent.addHandler(reqNames.boxDHSharedKey, boxDHSharedKey);
async function boxDHSharedKey(env: RequestEnvelope<DHSharedKeyRequest>):
		Promise<Buffer> {
	return toBuffer(nacl.box.calc_dhshared_key(
		bufFromJson(env.req.pk),
		bufFromJson(env.req.sk),
		arrFactory));
}

parent.addHandler(reqNames.signature, signature);
async function signature(env: RequestEnvelope<SignatureRequest>):
		Promise<Buffer> {
	return toBuffer(nacl.signing.signature(
		bufFromJson(env.req.m),
		bufFromJson(env.req.sk),
		arrFactory));
}

parent.addHandler(reqNames.verifySignature, verifySignature);
async function verifySignature(env: RequestEnvelope<VerifySigRequest>):
		Promise<boolean> {
	return nacl.signing.verify(
		bufFromJson(env.req.sig),
		bufFromJson(env.req.m),
		bufFromJson(env.req.pk),
		arrFactory);
}

parent.addHandler(reqNames.signatureKeyPair, signatureKeyPair);
async function signatureKeyPair(env: RequestEnvelope<Buffer>):
		Promise<SigKeyPairReply> {
	const pair = nacl.signing.generate_keypair(
		bufFromJson(env.req),
		arrFactory);
	const reply: SigKeyPairReply = {
		skey: toBuffer(pair.skey),
		pkey: toBuffer(pair.pkey)
	}
	return reply;
}
