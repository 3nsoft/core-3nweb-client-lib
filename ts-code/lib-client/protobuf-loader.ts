/*
 Copyright (C) 2020 - 2021 3NSoft Inc.
 
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

import * as protobuf from 'protobufjs';
import { join, relative, resolve } from 'path';
import * as fs from 'fs';


export class ProtoType<T extends object> {

	private constructor(
		private type: protobuf.Type
	) {
		Object.freeze(this);
	}

	static makeFrom<T extends object>(
		searchDir: string, protoFile: string, typeName: string
	): ProtoType<T> {
		const root = loadRoot(searchDir, protoFile);
		const type = root.lookupType(typeName);
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


const roots = new Map<string, protobuf.Root>();

function loadRoot(searchDir: string, fileName: string): protobuf.Root {
	const filePath = resolve(searchDir, 'protos', fileName);
	let root = roots.get(filePath);
	if (!root) {
		// if proto files file, we try to get definitions from the module
		try {
			root = protobuf.loadSync(filePath);
		} catch (err) {
			// make sure to generate proto-defs with compile step (use npm script)
			const fallbackMod = join(relative(__dirname, searchDir), 'proto-defs');
			const protos = require(fallbackMod).protos;
			if (!protos || (typeof protos !== 'object')) { throw new Error(
				`proto-defs doesn't have expected object`); }
			const initFunc = fs.readFileSync;
			try {
				(fs as any).readFileSync = (fName: string): Buffer => {
					const protoDefsStr = protos[fName];
					if (!protoDefsStr) { throw new Error(
						`Don't have in module proto definition for ${fName}`); }
					return Buffer.from(protoDefsStr, 'utf8');
				}
				root = protobuf.loadSync(fileName);
			} finally {
				(fs as any).readFileSync = initFunc;
			}
		}
		roots.set(filePath, root);
	}
	return root;
}


Object.freeze(exports);