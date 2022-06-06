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

import { errWithCause } from "../exceptions/error";
import { defer, Deferred } from "./deferred";

export class PressureValve {

	private stopper: Deferred<void>|undefined = undefined;

	constructor() {
		Object.seal(this);
	}

	toggle(flag: boolean): void {
		if (flag) {
			if (this.stopper) { return; }
			this.stopper = defer();
		} else {
			if (!this.stopper) { return; }
			this.stopper.resolve();
			this.stopper = undefined;
		}
	}

	pressWithError(err: any): void {
		this.toggle(true);
		this.stopper!.reject(errWithCause(err, `Backpressure error`));
	}

	readonly pressure = async (): Promise<void> => {
		if (!this.stopper) { return; }
		await this.stopper.promise;
	}

}
Object.freeze(PressureValve.prototype);
Object.freeze(PressureValve);


Object.freeze(exports);