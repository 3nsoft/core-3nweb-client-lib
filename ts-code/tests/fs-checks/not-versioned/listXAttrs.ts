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

import { SpecDescribe } from '../../libs-for-tests/spec-module';
import { SpecIt } from '../test-utils';

type FileException = web3n.files.FileException;

export const specs: SpecDescribe = {
	description: '.listXAttrs',
	its: []
};

let it: SpecIt = {
	expectation: 'fails to read xattrs for non-existent path',
	notIncludedIn: 'device-fs'
};
it.func = async function(s) {
	const { testFS } = s;
	let fName = 'unknown-file';
	await testFS.listXAttrs(fName)
	.then(() => {
		fail('stat-ing must fail, when path does not exist');
	}, (err: FileException) => {
		expect(err.notFound).toBe(true);
		if (!err.notFound) { throw err; }
	});
};
specs.its.push(it);

it = {
	expectation: 'lists extended attributes',
	notIncludedIn: 'device-fs'
};
it.func = async function(s) {
	const { testFS } = s;

	async function testforPath(path: string) {
		let xattrNames = await testFS.listXAttrs(path);
		expect(Array.isArray(xattrNames)).toBe(true);
		expect(xattrNames.length).toBe(0);

		const attr1Name = 'attribute name 1';
		const attr2Name = 'attr2';
		await testFS.updateXAttrs(path, {
			set: {
				[attr1Name]: 'some string value',
				[attr2Name]: 1234
			}
		});

		xattrNames = await testFS.listXAttrs(path);
		expect(xattrNames.length).toBe(2);
		expect(xattrNames).toContain(attr1Name);
		expect(xattrNames).toContain(attr2Name);
	}

	const file = 'file1';
	await testFS.writeTxtFile(file, '');

	await testforPath(file);

	const folder = 'folder1';
	await testFS.makeFolder(folder);

	await testforPath(folder);

};
specs.its.push(it);


Object.freeze(exports);