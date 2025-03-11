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
import { bytes as randomBytes,  } from '../../../lib-common/random-node';
import { SpecIt } from '../fs-checks/test-utils';
import { ErrorWithCause } from '../../../lib-common/exceptions/error';


export const specs: SpecDescribe = {
	description: 'gives file sink',
	its: []
	// ,focused:true
};

let it: SpecIt = { expectation: 'to write big chunks' };
it.func = async function(s) {
	const { testFS } = s;

// XXX This is WIP. This catches bug, presumably in writing stage.


	const fileName = 'big file';
	const sink = await testFS.getByteSink(fileName, {create:true});

	// write big chunk
	const bytes = await randomBytes(1000000);
	await sink.splice(0, bytes.length, bytes);
// console.log(` -> layout after splice: ${JSON.stringify(await sink.showLayout(), null, 2)}`);
	await sink.done();

console.log(`Reading file ${fileName}`);

	const fileContent = await testFS.readBytes(fileName)
.catch((err: ErrorWithCause) => {
	console.log(err.cause);
	throw err;
});
console.log(` file content length ${fileContent!.length}`);

	// XXX add some expect checks

};
// specs.its.push(it);


Object.freeze(exports);