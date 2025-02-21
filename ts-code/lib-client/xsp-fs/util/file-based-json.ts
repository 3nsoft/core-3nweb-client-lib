/*
 Copyright (C) 2017, 2020, 2025 3NSoft Inc.
 
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

import { Observable, Subscription } from 'rxjs';
import { mergeMap } from 'rxjs/operators';
import { SingleProc } from '../../../lib-common/processes/synced';

type WritableFile = web3n.files.WritableFile;
type FileEvent = web3n.files.FileEvent;
type RemoteEvent = web3n.files.RemoteEvent;

export type FileEventHandler = (
	ev: FileEvent|RemoteEvent
) => Promise<void>;


// XXX File proc can have general flow for sync

export class JsonFileProc<T> {

	private proc: Subscription|undefined = undefined;
	private file: WritableFile = undefined as any;

	constructor(
		private readonly onFileEvent: FileEventHandler,
		public readonly order = new SingleProc()
	) {
		Object.seal(this);
	}

	async start(
		file: WritableFile,
		initVal: T|(() => T)|(() => Promise<T>)
	): Promise<void> {
		if (this.proc) {
			throw new Error(`Json file process is already started`);
		}
		if (!file.writable || !file.v || !file.v.sync) {
			throw new Error(
				`Given file is expected to be both writable and versioned from a synchronized storage.`
			);
		}
		this.file = file;

		if (this.file.isNew) {
			const fstVal = ((typeof initVal === 'function') ?
				await (initVal as (() => Promise<T>))() :
				initVal
			);
			await this.file.writeJSON(fstVal);
		}

		this.proc = (new Observable<FileEvent|RemoteEvent>(
			obs => this.file.watch(obs))
		)
		.pipe(
			mergeMap(ev => this.onFileEvent(ev), 1)
		)
		.subscribe();
	}

	close(): Promise<void> {
		return this.order.startOrChain(async () => {
			if (!this.proc) { return; }
			this.proc.unsubscribe();
			this.proc = undefined;
			this.file = undefined as any;
		});
	}

	private ensureActive(): void {
		if (!this.proc) {
			throw new Error(
				`Json file process is either not yet initialized, or already closed.`
			);
		}
	}

	writeFile(val: T): Promise<number> {
		this.ensureActive();
		// XXX should we also add v.sync operation(s) ?
		return this.file.v!.writeJSON(val);
	}

	/**
	 * This saves a given json to file, returning a promise, resolvable to new
	 * file version.
	 * @param val is a json to be saved to file
	 */
	save(val: T, orderOperation = true): Promise<number> {
		return (orderOperation ?
			this.order.startOrChain(() => this.writeFile(val)) :
			this.writeFile(val)
		);
	}

	private readFile(): ReturnType<JsonFileProc<T>['get']> {
		this.ensureActive();
		return this.file.v!.readJSON<T>();
	}

	get(orderOperation = true): Promise<{ json: T; version: number; }> {
		return (orderOperation ?
			this.order.startOrChain(() => this.readFile()) :
			this.readFile()
		);
	}

}
Object.freeze(JsonFileProc.prototype);
Object.freeze(JsonFileProc);
	
Object.freeze(exports);