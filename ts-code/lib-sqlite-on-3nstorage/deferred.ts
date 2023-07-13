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

export interface Deferred<T> {
	promise: Promise<T>;
	resolve: (result?: T|PromiseLike<T>) => void;
	reject: (err: any) => void;
}

export function defer<T>(): Deferred<T> {
	const d = <Deferred<T>> {};
	d.promise = new Promise<T>((resolve, reject) => {
		d.resolve = resolve as Deferred<T>['resolve'];
		d.reject = reject;
	});
	Object.freeze(d);
	return d;
}
