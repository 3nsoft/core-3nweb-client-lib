/*
 Copyright (C) 2022 3NSoft Inc.
 
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

import { defer, Deferred } from '../../../lib-common/processes/deferred';
import { SpecDescribe } from '../../libs-for-tests/spec-module';
import { SpecIt } from '../test-utils';

type FileException = web3n.files.FileException;
type FileChangeEvent = web3n.files.FileChangeEvent;

export const specs: SpecDescribe = {
	description: '.watchFile',
	its: []
};

let it: SpecIt = { expectation: 'fails to watch non-existent path' };
it.func = async function(s) {
	const { testFS } = s;
	const fName = 'unknown-file';
	expect(await testFS.checkFilePresence(fName)).toBe(false);
	const expectedExc: Deferred<FileException> = defer();
	const sub = testFS.watchFile(fName, {
		next: () => expectedExc.reject('watching must fail, when path does not exist'),
		complete: () => expectedExc.reject('watching must fail, when path does not exist'),
		error: exc => expectedExc.resolve(exc)
	});
	const exc = await expectedExc.promise;
	expect(exc.type).toBe('file');
	expect(exc.notFound).toBe(true);
};
specs.its.push(it);

it = { expectation: 'gets file change event' };
it.func = async function(s) {
	const { testFS } = s;
	const fName = 'file to watch';
	await testFS.writeTxtFile(fName, '');
	const expectedEv: Deferred<FileChangeEvent> = defer();

	const sub = testFS.watchFile(fName, {
		next: ev => {
			if (ev.type === 'file-change') {
				expectedEv.resolve(ev);
			}
		},
		complete: () => expectedEv.reject(`Early completion`),
		error: err => expectedEv.reject(err)
	});

	// change file to get file
	await testFS.writeTxtFile(fName, 'new value');

	const changeEvent = await expectedEv.promise;
	expect(!!changeEvent.isRemote).toBeFalse();
	expect(typeof changeEvent.newVersion).toBe('number');
};
specs.its.push(it);

Object.freeze(exports);