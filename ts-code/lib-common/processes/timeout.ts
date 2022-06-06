/*
 Copyright (C) 2015, 2017, 2019 - 2022 3NSoft Inc.
 
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

import { defer } from "./deferred";
import { sleep } from "./sleep";


export function callWithTimeout<T>(
	f: () => Promise<T>, timeout: number, timeoutErr: () => any
): Promise<T> {
	let isDone = false;
	const deferred = defer<T>();
	f().then(res => {
		if (isDone) { return; }
		isDone = true;
		deferred.resolve(res);
	}, err => {
		if (isDone) { return; }
		isDone = true;
		deferred.reject(err);
	});
	sleep(timeout).then(() => {
		if (isDone) { return; }
		isDone = true;
		const err = timeoutErr();
		if (err) {
			deferred.reject(err);
		}
	});
	return deferred.promise;
}

Object.freeze(exports);