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

import { lastValueFrom, Observable, Subscriber } from 'rxjs';
import { filter, take, tap, timeout } from 'rxjs/operators';

export type WatchSetup<T> = (obs: Subscriber<T>) => (() => void);
export type FilterPredicate<T> = (ev: T) => boolean;

export function watchForEvents<T>(
	setupFn: WatchSetup<T>, numOfEvents: number,
	predicate?: FilterPredicate<T>,
	timeoutMillis = 1000,
): {
	collectedEvents: T[]; completion: Promise<void>;
} {
	const collectedEvents: T[] = [];
	if (!predicate) {
		predicate = (() => true);
	}
	const completion = lastValueFrom(
	(new Observable(setupFn))
	.pipe(
		filter(predicate),
		take(numOfEvents),
		timeout(timeoutMillis),
		tap(event => collectedEvents.push(event))
	))
	.then(noop);
	return { collectedEvents, completion };
}

function noop() {}


Object.freeze(exports);