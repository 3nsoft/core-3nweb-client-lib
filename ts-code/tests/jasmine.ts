/*
 Copyright (C) 2016, 2020 - 2021 3NSoft Inc.
 
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

import { stringifyErr } from '../lib-common/exceptions/error';
import jasmine = require('jasmine');

const jas = new jasmine({});

const specsFromCLI: string[] = [];
for (let i=2; i<process.argv.length; i+=1) {
	specsFromCLI.push(process.argv[i]);
}

const ALL_SPECS = [
	'units/*.js',
	'startup/*.js',
	'mailerid.js',
	'storage.js',
	'asmail.js'
];

jas.loadConfig({
	spec_dir: 'build/tests',
	spec_files: ((specsFromCLI.length > 0) ? specsFromCLI : ALL_SPECS),
	random: false
});

jas.configureDefaultReporter({
	showColors: true
});

const unhandledRejections = new WeakMap();
process.on('unhandledRejection', (reason, p) => {
	unhandledRejections.set(p, reason);
	console.error(`
Got an unhandled rejection:
${stringifyErr(reason)}`);
});
process.on('rejectionHandled', (p) => {
	const reason = unhandledRejections.get(p);
	console.error(`
Handling previously unhandled rejection:
${stringifyErr(reason)}`);
	unhandledRejections.delete(p);
});

jas.execute();
