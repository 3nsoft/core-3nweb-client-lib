/*
 Copyright (C) 2021 - 2022 3NSoft Inc.

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

import { ProtoType } from '../protobuf-type';
import { cryptor as pb } from '../../protos/cryptor.proto';
import { signing } from 'ecma-nacl';

export interface WasmScryptRequest {
	func: 1;
	scryptArgs: {
		passwd: Uint8Array;
		salt: Uint8Array;
		logN: number;
		r: number;
		p: number;
		dkLen: number;
	};
}

export interface WasmBinArgsRequest {
	func: 2|3|4|5|6|7|8|9|10;
	byteArgs: ByteArg[];
}

export interface ByteArg {
	val: Uint8Array;
}

export function toArgs(...args: Uint8Array[]): ByteArg[] {
	return args.map(val => ({ val }));
}

export type WasmRequest = WasmScryptRequest | WasmBinArgsRequest;

export interface WasmReply {
	res?: ByteArg;
	interim?: ByteArg;
	err?: ReplyError;
}

export interface ReplyError {
	condition: 'cipher-verification' | 'signature-verification' |
		'configuration-error' | 'message-passing-error';
	message: string;
}

export function toLocalErr(
	replyErr: ReplyError
): Error|web3n.EncryptionException {
	if (replyErr.condition === 'cipher-verification') {
		return { failedCipherVerification: true };
	} else if (replyErr.condition === 'signature-verification') {
		return { failedSignatureVerification: true };
	} else {
		return new Error(
			`WASM cryptor ${replyErr.condition}: ${replyErr.message}`);
	}
}

const wasmRequestProtoType = ProtoType.for<WasmRequest>(pb.Request);
const wasmReplyProtoType = ProtoType.for<WasmReply>(pb.Reply);

export function packRequestToWASM(req: WasmRequest): Buffer {
	return wasmRequestProtoType.pack(req);
}

export function unpackReplyFromWASM(replyBytes: Buffer): WasmReply {
	return wasmReplyProtoType.unpack(replyBytes);
}

const boolValType = ProtoType.for<{ val: boolean; }>(pb.BoolVal);
const kpairType = ProtoType.for<signing.Keypair>(pb.Keypair);

export function unpackSigningKeyPair(bytes: Buffer): signing.Keypair {
	return kpairType.unpack(bytes);
}

export function unpackBoolVal(bytes: Buffer): boolean {
	return boolValType.unpack(bytes).val;
}


Object.freeze(exports);