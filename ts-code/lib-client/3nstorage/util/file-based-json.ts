/*
 Copyright (C) 2017, 2020 3NSoft Inc.
 
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

type WritableFile = web3n.files.WritableFile;
type FileEvent = web3n.files.FileEvent;
type RemoteEvent = web3n.files.RemoteEvent;

export abstract class JsonFileProc<T> {
	
	private proc: Subscription|undefined = undefined;
	private file: WritableFile = undefined as any;
	
	async start(file: WritableFile, initVal: T|(() => T)|(() => Promise<T>)):
			Promise<void> {
		if (this.proc) { throw new Error(
			`Json file process is already started`); }
		if (!file.writable || !file.v) { throw new Error(
			`Given file is expected to be both writable and versioned.`); }
		this.file = file;

		if (this.file.isNew) {
			const fstVal = ((typeof initVal === 'function') ?
				await (initVal as (() => Promise<T>))() :
				initVal);
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

	protected abstract onFileEvent(ev: FileEvent|RemoteEvent): Promise<void>;

	async close(): Promise<void> {
		if (!this.proc) { return; }
		this.proc.unsubscribe();
		this.proc = undefined;
		this.file = undefined as any;
	}

	private ensureActive(): void {
		if (!this.proc) { throw new Error(
			`Json file process is either not yet initialized, or already closed.`); }
	}

	/**
	 * This saves a given json to file, returning a promise, resolvable to new
	 * file version.
	 * @param val is a json to be saved to file
	 */
	protected save(val: T): Promise<number> {
		this.ensureActive();
		return this.file.v!.writeJSON(val);
	}

	protected get(): Promise<{ json: T; version: number; }> {
		this.ensureActive();
		return this.file.v!.readJSON<T>();
	}

}
Object.freeze(JsonFileProc.prototype);
Object.freeze(JsonFileProc);
	
Object.freeze(exports);