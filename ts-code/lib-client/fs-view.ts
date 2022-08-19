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

type ReadonlyFS = web3n.files.ReadonlyFS;
type WritableFS = web3n.files.WritableFS;
type ReadonlyFile = web3n.files.ReadonlyFile;
type WritableFile = web3n.files.WritableFile;


export interface FSReadView extends ReadonlyFS {}

export interface FSWriteView extends WritableFS {
	rollbackWrite(): Promise<void>;
}

export type FSWrite = FSReadView | FSWriteView;


export interface FileWriteView extends WritableFile {
	rollbackWrite(): Promise<void>;
}


export async function readonlyFSView(
	fs: ReadonlyFS, state
): Promise<FSReadView> {
	// XXX

	// Notes:
	// - state info with objId->version can't expose objId to user here,
	//   keeping it on core's side.
	// ! Hiding objId is incompatible with idea of having syncWall info
	//   accessible, if/when objId is used in it.
	// - Map path->num-id-within-given-sync-wall

	// - When anything is changed within FSWriteView, it is added to map,
	//   as being part of sync wall.


	throw new Error('Function not implemented.');
}


Object.freeze(exports);