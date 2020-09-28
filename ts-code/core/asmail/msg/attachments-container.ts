/*
 Copyright (C) 2017 3NSoft Inc.
 
 This program is free software: you can redistribute it and/or modify it under
 the terms of the GNU General Public License as published by the Free Software
 Foundation, either version 3 of the License, or (at your option) any later
 version.
 
 This program is distributed in the hope that it will be useful, but
 WITHOUT ANY WARRANTY; without even the implied warranty of
 MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 See the GNU General Public License for more details.
 
 You should have received a copy of the GNU General Public License along with
 this program. If not, see <http://www.gnu.org/licenses/>. */

export type AttachmentsContainer = web3n.asmail.AttachmentsContainer;
export type FS = web3n.files.FS;
export type File = web3n.files.File;

export function isContainerEmpty(c: AttachmentsContainer|undefined): boolean {
	if (!c) { return true; }
	if (c.files && (Object.keys(c.files).length > 0)) { return false; }
	if (c.folders && (Object.keys(c.folders).length > 0)) { return false; }
	return true;
}

export function* iterFilesIn(c: AttachmentsContainer|undefined):
		IterableIterator<{ fileName: string; file: File; }> {
	if (!c || !c.files) { return; }
	for (const fileName of Object.keys(c.files)) {
		const file = c.files[fileName];
		yield { fileName, file };
	}
}

export function* iterFoldersIn(c: AttachmentsContainer|undefined):
		IterableIterator<{ folderName: string; folder: FS; }> {
	if (!c || !c.folders) { return; }
	for (const folderName of Object.keys(c.folders)) {
		const folder = c.folders[folderName];
		yield { folderName, folder };
	}
}

export function addFileTo(c: AttachmentsContainer, file: File,
		name?: string): void {
	if (!c.files) { c.files = {}; }
	if (!name) { name = file.name; }
	if (c.files[name] || (c.folders && c.folders[name])) { throw new Error(
		`File name ${name}, as it is already used`); }
	c.files[name] = file;
}

export function addFolderTo(c: AttachmentsContainer, folder: FS,
		name?: string): void {
	if (!c.folders) { c.folders = {}; }
	if (!name) { name = folder.name; }
	if (c.folders[name] || (c.files && c.files[name])) { throw new Error(
		`Folder name ${name}, as it is already used by other `); }
	c.folders[name] = folder;
}

export function renameFileIn(c: AttachmentsContainer,
		initName: string, newName: string): void {
	if (!c.files || !c.files[initName]) { throw new Error(
		`File ${initName} is not found`); }
	const file = c.files[initName];
	addFileTo(c, file, newName);
	delete c.files[initName];
}

export function renameFolderIn(c: AttachmentsContainer,
		initName: string, newName: string): void {
	if (!c.folders || !c.folders[initName]) { throw new Error(
		`Folder ${initName} is not found`); }
	const folder = c.folders[initName];
	addFolderTo(c, folder, newName);
	delete c.folders[initName];
}
