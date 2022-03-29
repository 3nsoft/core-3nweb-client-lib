/*
 Copyright (C) 2020 - 2022 3NSoft Inc.
 
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

import { Type as PBType } from 'protobufjs';


export class ProtoType<T extends object> {

	private constructor(
		private readonly type: PBType
	) {
		this.type = type;
		Object.freeze(this);
	}

	static for<T extends object>(type: any): ProtoType<T> {
		return new ProtoType<T>(type);
	}

	pack(msg: T): Buffer {
		const err = this.type.verify(msg);
		if (err) { throw new Error(err); }
		return this.type.encode(msg).finish() as Buffer;
	}

	unpack(bytes: Buffer|void): T {
		if (!bytes) {
			throw {
				runtimeException: true,
				type: 'ipc',
				missingBodyBytes: true
			};
		}
		return this.type.decode(bytes) as T;
	}

	packToBase64(msg: T): string {
		return this.pack(msg).toString('base64');
	}

	unpackFromBase64(str: string): T {
		return this.unpack(Buffer.from(str, 'base64'));
	}

}
Object.freeze(ProtoType.prototype);
Object.freeze(ProtoType);


Object.freeze(exports);