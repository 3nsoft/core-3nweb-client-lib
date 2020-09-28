/*
 Copyright 2019 - 2020 3NSoft Inc.
 
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

import { SpecIt as GenericSpecIt } from "../libs-for-tests/spec-module";

export interface SetupWithTestFS {
	isUp: boolean;
	testFS: web3n.files.WritableFS;
}

export type SpecIt = GenericSpecIt<SetupWithTestFS>;

export async function clearFS(fs: web3n.files.WritableFS): Promise<void> {
	let items = await fs.listFolder('');
	let delTasks: Promise<void>[] = [];
	for (let f of items) {
		if (f.isFile) {
			delTasks.push(fs.deleteFile(f.name));
		} else if (f.isFolder) {
			delTasks.push(fs.deleteFolder(f.name, true));
		} else if (f.isLink) {
			delTasks.push(fs.deleteLink(f.name));
		} else {
			throw new Error(`File system item is neither file, nor folder, nor link`);
		}
	}
	await Promise.all(delTasks);
}

export interface SetupWithTwoFSs {
	isUp: boolean;
	syncedTestFS: web3n.files.WritableFS;
	localTestFS: web3n.files.WritableFS;
}

export type SpecItWithTwoFSs = GenericSpecIt<SetupWithTwoFSs>;
