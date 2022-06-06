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

import { FileException, unlink, writeFile } from "../../../lib-common/async-fs-node";


export class JSONSavingProc<T> {

	private proc: Promise<void>|undefined = undefined;
	private jsonNeedsSaving = false;

	/**
	 * @param path where json file is saved
	 * @param getForSerialization function that either returns something to
	 * jsonify and save, or undefined to remove the file.
	 * @param logError is an optional log function saving errors.
	 */
	constructor(
		private readonly path: string,
		private readonly getForSerialization: () => T|undefined
	) {
		Object.seal(this);
	}

	/**
	 * This triggers saving. One may await returned promise, but doesn't have to.
	 * Several triggers can be done, but overlapping ones will save only the
	 * latest value.
	 */
	trigger(): Promise<void> {
		if (!this.jsonNeedsSaving) {
			this.jsonNeedsSaving = true;
			if (!this.proc) {
				this.proc = this.save();
			}
		}
		return this.proc!;
	}

	isSaved(): boolean {
		return !this.jsonNeedsSaving;
	}

	private async save(): Promise<void> {
		try {
			this.jsonNeedsSaving = false;
			const serialForm = this.getForSerialization();
			if (serialForm === undefined) {
				await unlink(this.path)
				.catch((e: FileException) => {
					if (!e.notFound) { throw e; }
				});
			} else {
				const json = JSON.stringify(serialForm);
				await writeFile(this.path, json, { encoding: 'utf8' });
			}
		} finally {
			if (this.jsonNeedsSaving) {
				return this.save();
			} {
				this.proc = undefined;
			}
		}
	}

}
Object.freeze(JSONSavingProc.prototype);
Object.freeze(JSONSavingProc);


Object.freeze(exports);