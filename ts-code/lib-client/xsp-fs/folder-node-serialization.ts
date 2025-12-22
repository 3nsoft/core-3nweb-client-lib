/*
 Copyright (C) 2017, 2022 3NSoft Inc.
 
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

import { makeUint8ArrayCopy, utf8 } from '../../lib-common/buffer-utils';
import { FolderInfo, NodeInfo } from './folder-node';
import { KEY_LENGTH } from 'xsp-files';
import { packUintTo4Bytes, uintFrom4Bytes } from '../../lib-common/big-endian';
import { assert } from '../../lib-common/assert';

const ver1Serialization = new Uint8Array([ 1 ]);

export function parseFolderInfo(bytes: Uint8Array|undefined): FolderInfo {
	if (!bytes) { throw parsingException(`Can't parse folder from no bytes`); }
	if (bytes[0] === ver1Serialization[0]) {
		return formatV1.parse(bytes.subarray(1));
	} else {
		throw parsingException(`Cannot recognize folder's serialization version`);
	}
}

export function serializeFolderInfo(folderInfo: FolderInfo): Uint8Array[] {
	return formatV1.pack(folderInfo);
}

interface ParsingException extends  web3n.RuntimeException {
	type: 'folder-parsing',
}

function parsingException(msg: string, cause?: any): ParsingException {
	return {
		runtimeException: true,
		type: 'folder-parsing',
		message: msg,
		cause
	};
}


namespace formatV1 {

	export function pack(folderInfo: FolderInfo): Uint8Array[] {
		const bytes = [ ver1Serialization ];
		for (const nodeInfo of Object.values(folderInfo.nodes)) {
			bytes.push(...packNode(nodeInfo));
		}
		return bytes;
	}

	function packNode(nodeInfo: NodeInfo): Uint8Array<ArrayBuffer>[] {
		const bytes = [ nodeInfo.key as Uint8Array<ArrayBuffer> ];
		const json: NodeJSON = {
			t: (nodeInfo.isFolder ? 1 : (nodeInfo.isFile ? 2 : 3)),
			n: nodeInfo.name,
			o: nodeInfo.objId
		};
		const jsonBytes = utf8.pack(JSON.stringify(json)) as Uint8Array<ArrayBuffer>;
		assert(jsonBytes.length < 0xffffffff);
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

	function numberToBytes(x: number): Uint8Array<ArrayBuffer> {
		const arr = Buffer.allocUnsafe(4);
		packUintTo4Bytes(x, arr, 0);
		return arr;
	}

	export function parse(bytes: Uint8Array): FolderInfo {
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

	function deserializeNodeInfoV1(
		bytes: Uint8Array
	): { node: NodeInfo, bytesRead: number; } {
		if (bytes.length < (KEY_LENGTH + 4)) {
			throw parsingException(`Cannot deserialize node key from bytes`);
		}

		const key = makeUint8ArrayCopy(bytes.subarray(0, KEY_LENGTH));
		bytes = bytes.subarray(KEY_LENGTH);

		const jsonBytesLen = uintFrom4Bytes(bytes);
		bytes = bytes.subarray(4);

		try {
			const json: NodeJSON = JSON.parse(utf8.open(bytes.subarray(0, jsonBytesLen)));
			
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
				throw parsingException('unidentified node type');
			}
			
			return {
				node,
				bytesRead: KEY_LENGTH + 4 + jsonBytesLen
			};
		} catch (err) {
			throw parsingException(`Cannot deserialize node info from bytes.`, err);
		}
	}
	
}
Object.freeze(formatV1);


Object.freeze(exports);