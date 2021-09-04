/*
 Copyright (C) 2017 3NSoft Inc.
 
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

/**
 * Everything in this module is assumed to be inside of a file system
 * reliance set.
 */

import { makeUint8ArrayCopy, utf8 } from '../../../lib-common/buffer-utils';
import { FolderInfo, NodeInfo } from './folder-node';
import { KEY_LENGTH } from 'xsp-files';
import { errWithCause } from '../../../lib-common/exceptions/error';

const ver1Serialization = new Uint8Array([ 1 ]);

function serializeFolderInfoV1(folderInfo: FolderInfo): Uint8Array[] {
	const bytes = [ ver1Serialization ];
	Object.values(folderInfo.nodes)
	.map(serializeNodeInfoV1)
	.forEach(nodeBytes => bytes.push(...nodeBytes));
	return bytes;
}

function serializeNodeInfoV1(nodeInfo: NodeInfo): Uint8Array[] {
	const bytes = [ nodeInfo.key ];
	const json: NodeJSON = {
		t: (nodeInfo.isFolder ? 1 : (nodeInfo.isFile ? 2 : 3)),
		n: nodeInfo.name,
		o: nodeInfo.objId
	};
	const jsonBytes = utf8.pack(JSON.stringify(json));
	bytes.push(numberToBytes(jsonBytes.length));
	bytes.push(jsonBytes);
	return bytes;
}

interface NodeJSON {
	/**
	 * t is a type of node. 1 stands for folder, 2 for file, and 3 for link.
	 */
	t: 1 | 2 | 3;
	/**
	 * n is a file/folder/link name of this node in a parent folder.
	 */
	n: string;
	/**
	 * o is this node's object id
	 */
	o: string;
}

function load_bigendian(arr: Uint8Array): number {
	return (arr[3] | arr[2] << 8) | (arr[1] << 16) | (arr[0] << 24);
}

function store_bigendian(arr: Uint8Array, x: number): void {
	if (x > 0xffffffff) { throw new Error(
		`Number ${x} is bigger than expected unsigned 32 bit integer`); }
	arr[3] = x;
	arr[2] = x >>> 8;
	arr[1] = x >>> 16;
	arr[0] = x >>> 24;
}

function numberToBytes(x: number): Uint8Array {
	const arr = new Uint8Array(4);
	store_bigendian(arr, x);
	return arr;
}

export function serializeFolderInfo(folderInfo: FolderInfo): Uint8Array[] {
	return serializeFolderInfoV1(folderInfo);
}

export function deserializeFolderInfo(bytes: Uint8Array): FolderInfo {
	if (bytes[0] === ver1Serialization[0]) {
		return deserializeFolderInfoV1(bytes.subarray(1));
	} else {
		throw new Error(`Cannot recognize folder's serialization version`);
	}
}

function deserializeFolderInfoV1(bytes: Uint8Array): FolderInfo {
	let slice = bytes;
	const folderInfo: FolderInfo = {
		nodes: {}
	};
	while (slice.length > 0) {
		const { node, bytesRead } = deserializeNodeInfoV1(slice);
		slice = slice.subarray(bytesRead);
		folderInfo.nodes[node.name] = node;
	}
	bytes.fill(0);
	return folderInfo;
}

function deserializeNodeInfoV1(bytes: Uint8Array):
		{ node: NodeInfo, bytesRead: number; } {
	if (bytes.length < (KEY_LENGTH + 4)) { throw new Error(
		`Cannot deserialize node key from bytes`); }

	const key = makeUint8ArrayCopy(bytes.subarray(0, KEY_LENGTH));
	bytes = bytes.subarray(KEY_LENGTH);

	const jsonBytesLen = load_bigendian(bytes);
	bytes = bytes.subarray(4);

	try {
		const json: NodeJSON = JSON.parse(utf8.open(
			bytes.subarray(0, jsonBytesLen)));
		
		const node: NodeInfo = {
			name: json.n,
			key,
			objId: json.o
		};

		if (json.t === 1) {
			node.isFolder = true;
		} else if (json.t === 2) {
			node.isFile = true;
		} else if (json.t === 3) {
			node.isLink = true;
		} else {
			throw 'unidentified node type';
		}
		
		return {
			node,
			bytesRead: KEY_LENGTH + 4 + jsonBytesLen
		};
	} catch (err) {
		throw errWithCause(err, `Cannot deserialize node info from bytes.`);
	}
}

Object.freeze(exports);