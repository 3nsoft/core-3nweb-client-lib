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
	description: '.getXAttr',
	its: []
};

let it: SpecIt = {
	expectation: 'fails to read xattr for non-existent path',
	notIncludedIn: 'device-fs'
};
it.func = async function(s) {
	const { testFS } = s;
	let fName = 'unknown-file';
	await testFS.getXAttr(fName, 'attribute name')
	.then(() => {
		fail('stat-ing must fail, when path does not exist');
	}, (err: FileException) => {
		expect(err.notFound).toBe(true);
		if (!err.notFound) { throw err; }
	});
};
specs.its.push(it);

it = {
	expectation: 'reads extended attribute',
	notIncludedIn: 'device-fs'
};
it.func = async function(s) {
	const { testFS } = s;

	async function testforPath(path: string) {
		let attrValue = await testFS.getXAttr(path, 'unknown attribute');
		expect((attrValue === null) || (attrValue === undefined)).toBe(true, 'for attribute that is not present');

		const attr1Name = 'attribute name 1';
		const attr1Value = 'some string value';
		const attr2Name = 'attr2';
		const attr2Value = 1234;
		await testFS.updateXAttrs(path, {
			set: {
				[attr1Name]: attr1Value,
				[attr2Name]: attr2Value
			}
		});

		attrValue = await testFS.getXAttr(path, attr1Name);
		expect(attrValue).toBe(attr1Value);
		attrValue = await testFS.getXAttr(path, attr2Name);
		expect(attrValue).toBe(attr2Value);
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