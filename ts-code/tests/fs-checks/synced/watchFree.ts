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

import { Observable } from 'rxjs';
import { filter, timeout, first } from 'rxjs/operators';
import { stringOfB64Chars } from '../../../lib-common/random-node';
import { SpecDescribe } from '../../libs-for-tests/spec-module';
import { SpecIt } from '../test-utils';

type FSEvent = web3n.files.FSEvent;
type SyncUploadEvent = web3n.files.SyncUploadEvent;

export const specs: SpecDescribe = {
	description: '.watchTree',
	its: []
};

let it: SpecIt = { expectation: 'gets synchronization events', timeout: 5000 };
it.func = async function(s) {
	const { testFS } = s;
	const file1 = 'some folder/file 1';
	let version = -1;
	const evProm = (new Observable<FSEvent>(obs => testFS.watchTree('.', obs)))
	.pipe(
		filter((ev: SyncUploadEvent) => (
			(ev.type === 'sync-upload') && ev.path.endsWith(file1) &&
			(ev.uploaded === version) && (ev.uploaded === ev.current)
		)),
		first(),
		timeout(2000)
	)
	.toPromise();
	version = await testFS.v!.writeTxtFile(file1, await stringOfB64Chars(32));
	const syncEvent = await evProm;
	expect(syncEvent).toBeDefined();
	const stats = await testFS.stat(file1);
	expect(stats.sync).toBeDefined();
	expect(stats.sync!.state).toBe('synced');
};
specs.its.push(it);

Object.freeze(exports);