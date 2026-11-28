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
import { deepEqual } from '../../../libs-for-tests/json-equal';

type FileException = web3n.files.FileException;

export const specs: SpecDescribe = {
	description: '.copyXAttrs',
	its: []
};

let it: SpecIt = {
	expectation: 'fails for missing file',
	notIncludedIn: 'device-fs'
};
it.func = async function(s) {
	const { testFS } = s;
	const unknown = 'non-existing-file';
	try {
		await testFS.copyXAttrs(unknown, 'copy');
		fail('should fail for missing source file');
	} catch (e) {
		expect((e as FileException).notFound).toBe(true);
	}
	const src = `source.txt`;
	const content = await randomBytes(250);
	await testFS.writeBytes(src, content);
	await testFS.copyXAttrs(src, unknown).catch(err => {
		fail(`When there are no xattr's to copy, missing destination shouldn't get noticed`);
	});
	await testFS.updateXAttrs(src, { set: { 'some-attr': 'value' } });
	try {
		await testFS.copyXAttrs(src, unknown);
		fail('should fail for missing source file');
	} catch (e) {
		expect((e as FileException).notFound).toBe(true);
	}
};
specs.its.push(it);

it = {
	expectation: 'copies xattrs',
	notIncludedIn: 'device-fs'
};
it.func = async function(s) {
	const { testFS } = s;
	const src = `source.txt`;
	const attrs = {
		'attr-binary': await randomBytes(40),
		'attr-str': await stringOfB64Chars(30),
		'attr-obj': {
			a: await stringOfB64Chars(10),
			b: await stringOfB64Chars(20),
			c: Math.round(1024*Math.random())
		}
	};
	await testFS.writeBytes(src, await randomBytes(150));
	await testFS.updateXAttrs(src, { set: attrs });

	// actually, dst and src don't have to be same
	const dst = `destination.txt`;
	await testFS.writeBytes(dst, await randomBytes(200));
	expect((await testFS.listXAttrs(dst)).length).toBe(0);

	await testFS.copyXAttrs(src, dst);
	expect(bytesEqual(
		attrs['attr-binary'],
		await testFS.getXAttr(dst, 'attr-binary')
	)).toBeTrue();
	expect(await testFS.getXAttr(dst, 'attr-str')).toBe(attrs['attr-str']);
	expect(deepEqual(
		attrs['attr-obj'],
		await testFS.getXAttr(dst, 'attr-obj')
	)).toBeTrue();
};
specs.its.push(it);

Object.freeze(exports);