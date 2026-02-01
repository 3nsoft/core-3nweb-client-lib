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

import { stringOfB64CharsSync } from '../../../../lib-common/random-node';
import { SpecDescribe } from '../../../libs-for-tests/spec-module';
import { SpecItWithTwoDevsFSs } from '../test-utils';

export const specs: SpecDescribe = {
	description: '--',
	its: []
};

let it: SpecItWithTwoDevsFSs = {
	expectation: 'reading and writing file with xattrs'
};
it.func = async function({ dev1FS, dev2, dev2FS }) {
	const file = `file-with-xattrs`;
	const fileContent = stringOfB64CharsSync(100);
	const xattrValue = {
		"string-attr": 'blah, blah',
		"empty-string-attr": '',
		"number-attr": 42
	};

	await dev2FS().writeTxtFile(file, fileContent);
	await dev2FS().updateXAttrs(file, { set: xattrValue });

	await dev2FS().v!.sync!.upload(file);
	await dev2FS().v!.sync!.upload('');

	// Let's read file on another device
	await dev1FS().v!.sync!.status('');
	await dev1FS().v!.sync!.adoptRemote('');
	expect(await dev1FS().readTxtFile(file)).toBe(fileContent);

	// Let's read file on original device after restart
	await dev2.stop();
	await dev2.start();
	expect(await dev2FS().readTxtFile(file)).toBe(fileContent);
};
specs.its.push(it);


Object.freeze(exports);