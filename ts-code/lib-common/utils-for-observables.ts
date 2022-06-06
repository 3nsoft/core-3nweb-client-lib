/*
 Copyright (C) 2017, 2019 - 2020, 2022 3NSoft Inc.

 This program is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.

 This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for more details.

 You should have received a copy of the GNU General Public License along with this program. If not, see <http://www.gnu.org/licenses/>.
*/

import { Observable, of, PartialObserver, Subject, Subscription, throwError } from 'rxjs';
import { share, tap } from 'rxjs/operators';

/**
 * This is a pipeable operator that runs given async process on completion and
 * sends result downstream, followed by complete signal.
 * @param mapCompletion async map of completion to one more event.
 */
export function flatMapComplete<T, R>(
	mapCompletion: () => Promise<R>
): (src: Observable<T>) => Observable<T|R> {
	return src => new Observable(downstream => src.subscribe({
		next: x => downstream.next(x),
		error: err => downstream.error(err),
		complete: () => mapCompletion().then(
			mapped => {
				downstream.next(mapped);
				downstream.complete();
			},
			err => downstream.error(err)
		)
	}));
}

/**
 * This is a pipeable operator that allows only one start of an upstream
 * process, irrespectful of how many subscribe calls happen downstream.
 * Use share after this operator when several branches of processing are needed.
 * Combination of this operand and share ensures that upstream process can be
 * started only once.
 */
export function allowOnlySingleStart<T>(
): (src: Observable<T>) => Observable<T> {
	let wasStarted = false;
	let isComplete = false;
	let okCompletion = false;
	let err: any = undefined;
	return src => new Observable(downstream => {
		if (wasStarted) {
			if (!isComplete) { throw new Error(
				`Attempt to subscribe, when process hasn't completed indicates that functional closure is captured and called somewhere else, not in accordance with expected rxjs processing.`); }
			if (okCompletion) {
				return of().subscribe(downstream);
			} else {
				return throwError(err).subscribe(downstream);
			}
		} else {
			wasStarted = true;
			return src.pipe(
				tap({
					error: e => {
						isComplete = true;
						err = e;
					},
					complete: () => {
						isComplete = true;
						okCompletion = true;
					}
				})
			).subscribe(downstream);
		}
	});
}

/**
 * This is a pipeable operator that is like tap, but takes in async functions,
 * ensuring that they complete running before passing events to downstream.
 * At least one tapping function should be given.
 * @param onNext 
 * @param onError 
 * @param onComplete 
 */
export function flatTap<T>(
	onNext: ((x: T) => Promise<void>)|undefined|null,
	onError?: ((err: any) => Promise<void>)|undefined|null,
	onComplete?: (() => Promise<void>)|undefined|null
): (src: Observable<T>) => Observable<T> {
	if (!onNext && !onError && !onComplete) { throw new Error(
		`No tapping function given.`); }
	return src => new Observable(downstream => src.subscribe({
		next: (onNext ?
			x => onNext(x).then(
				() => downstream.next(x),
				err => downstream.error(err)
			) :
			x => downstream.next(x)),
		error: (onError ?
			err => onError(err).then(
				() => downstream.error(err),
				err2 => downstream.error(err)
			) :
			err => downstream.error(err)),
		complete: (onComplete ?
			() => onComplete().then(
				() => downstream.complete(),
				err => downstream.error(err)
			) :
			() => downstream.complete())
	}));
}

/**
 * @param obs 
 * @return given observer, or one with noop's in place of missing functions
 */
export function toRxObserver<T>(obs: web3n.Observer<T>): PartialObserver<T> {
	if (obs.next && obs.error && obs.complete) {
		return obs as PartialObserver<T>;
	} else {
		const next = (obs.next ? obs.next.bind(obs) : noop);
		const complete = (obs.complete ? obs.complete.bind(obs) : noop);
		const error = (obs.error ? obs.error.bind(obs) : noop);
		return { next, complete, error };
	}
}

function noop() {}


export class Broadcast<T> {

	private readonly src = new Subject<T>();
	public readonly event$ = this.src.asObservable().pipe(share());
	private sub: Subscription|undefined;

	constructor() {
		this.sub = this.event$.subscribe(toRxObserver({}));
		Object.seal(this);
	}

	next(ev: T): void {
		if (!this.sub) { return; }
		this.src.next(ev);
	}

	done(err?: any): void {
		if (!this.sub) { return; }
		if (err) {
			this.src.error(err);
		} else {
			this.src.complete();
		}
		this.sub = undefined;
	}

	isON(): boolean {
		return !!this.sub;
	}

}
Object.freeze(Broadcast.prototype);
Object.freeze(Broadcast);
