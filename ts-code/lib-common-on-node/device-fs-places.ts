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

import { makeFSCollection } from "../lib-client/fs-utils/fs-collection";
import { DeviceFS } from "../lib-index";

type FSItem = web3n.files.FSItem;

export async function sysFilesOnDevice(): Promise<FSItem> {
	const c = makeFSCollection();
	if (process.platform === 'win32') {
		const sysDrive = process.env.SystemDrive!;
		await c.set!(sysDrive, {
			isFolder: true,
			item: await DeviceFS.makeWritable(sysDrive)
		});
	} else {
		await c.set!('', {
			isFolder: true,
			item: await DeviceFS.makeWritable('/')
		});
	}
	return { isCollection: true, item: c };
}


Object.freeze(exports);