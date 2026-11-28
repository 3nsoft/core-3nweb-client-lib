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

import { SpecDescribe } from '../../../libs-for-tests/spec-module';
import { bytes as randomBytes, stringOfB64Chars } from '../../../../lib-common-on-node/random-node';
import { bytesEqual } from '../../../libs-for-tests/bytes-equal';
import { SpecIt } from '../test-utils';

type FileException = web3n.files.FileException;

export const specs: SpecDescribe = {
	description: '.copyFile',
	its: []
};

let it: SpecIt = {
	expectation: 'if not allowed to create, fails for missing file',
};
it.func = async function(s) {
	const { testFS } = s;
	try {
		await testFS.copyFile('non-existing-file', 'copy');
		fail('should fail for missing source file');
	} catch (e) {
		expect((e as FileException).notFound).toBe(true);
	}
};
specs.its.push(it);

it = {
	expectation: 'copies file content'
};
it.func = async function(s) {
	const { testFS } = s;
	const src = `source.txt`;
	const dst = `destination.txt`;
	const content = await randomBytes(250);
	await testFS.writeBytes(src, content);

	await testFS.copyFile(src, dst);
	const bytesInDst = await testFS.readBytes(dst);
	expect(bytesEqual(bytesInDst!, content)).toBeTrue();
};
specs.its.push(it);

it = {
	expectation: 'copies file content but not xattrs',
	notIncludedIn: 'device-fs'
};
it.func = async function(s) {
	const { testFS } = s;
	const src = `source.txt`;
	const attrName = `some-attr`;
	const dst = `destination.txt`;
	const content = await randomBytes(250);
	await testFS.writeBytes(src, content);
	await testFS.updateXAttrs(src, { set: { [attrName]: await stringOfB64Chars(30) } });

	await testFS.copyFile(src, dst);
	const bytesInDst = await testFS.readBytes(dst);
	expect(bytesEqual(bytesInDst!, content)).toBeTrue();
	const attrInDst = await testFS.getXAttr(dst, attrName);
	expect(attrInDst).toBeUndefined();
};
specs.its.push(it);

Object.freeze(exports);