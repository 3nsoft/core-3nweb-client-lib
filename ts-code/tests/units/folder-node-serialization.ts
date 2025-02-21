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

import { parseFolderInfo, serializeFolderInfo } from '../../lib-client/xsp-fs/folder-node-serialization';
import { FolderInfo, NodeInfo } from '../../lib-client/xsp-fs/folder-node';
import * as random from '../../lib-common/random-node';
import { BytesFIFOBuffer } from '../../lib-common/byte-streaming/bytes-fifo-buffer';
import { bytesEqual } from '../libs-for-tests/bytes-equal';

const fileNode1: NodeInfo = {
	name: 'file 1',
	objId: random.stringOfB64UrlSafeCharsSync(32),
	key: random.bytesSync(32),
	isFile: true
};

const folderNode1: NodeInfo = {
	name: 'folder 1',
	objId: random.stringOfB64UrlSafeCharsSync(32),
	key: random.bytesSync(32),
	isFolder: true
};

const f1: FolderInfo = { nodes: {} };
f1.nodes[fileNode1.name] = fileNode1;
f1.nodes[folderNode1.name] = folderNode1;

const emptyFI: FolderInfo = { nodes: {} };

function compareNodeInfos(actual: NodeInfo, expected: NodeInfo): void {
	expect(actual).toBeTruthy();
	expect(actual.name).toBe(expected.name);
	expect(actual.objId).toBe(expected.objId);
	expect(bytesEqual(actual.key, expected.key)).toBe(true);
	expect(actual.isFile).toBe(expected.isFile);
	expect(actual.isFolder).toBe(expected.isFolder);
	expect(actual.isLink).toBe(expected.isLink);
}

describe('Folder node serialization', () => {

	it('function serializeFolderInfo produces array of byte arrays', () => {
		let bytes = serializeFolderInfo(emptyFI);
		expect(Array.isArray(bytes)).toBe(true);
		expect(bytes[0].length).toBe(1, 'version section take one byte');
		bytes = serializeFolderInfo(f1);
		expect(bytes.length).toBeGreaterThan(1);
	});

	it('function parseFolderInfo assembles empty folder info', () => {
		const buf = new BytesFIFOBuffer();
		serializeFolderInfo(emptyFI)
		.forEach(chunk => buf.push(chunk));
		let info = parseFolderInfo(buf.getBytes(undefined)!);
		expect(typeof info.nodes).toBe('object');
		expect(Object.values(info.nodes).length).toBe(0);
	});

	it('function parseFolderInfo assembles non-empty folder info', () => {
		const buf = new BytesFIFOBuffer();
		serializeFolderInfo(f1)
		.forEach(chunk => buf.push(chunk));
		let info = parseFolderInfo(buf.getBytes(undefined)!);
		expect(typeof info.nodes).toBe('object');
		expect(Object.values(info.nodes).length).toBe(2);
		compareNodeInfos(info.nodes[fileNode1.name], fileNode1);
		compareNodeInfos(info.nodes[folderNode1.name], folderNode1);
	});

});