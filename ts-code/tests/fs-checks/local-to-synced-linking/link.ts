/*
 Copyright (C) 2016, 2018, 2020 3NSoft Inc.
 
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

import { SpecDescribe } from '../../libs-for-tests/spec-module';
import { SpecItWithTwoFSs } from '../test-utils';

export const specs: SpecDescribe = {
	description: '.link, when linking from local into synced storage,',
	its: []
};

let it: SpecItWithTwoFSs = { expectation: 'links readonly file' };
it.func = async function(s) {
	const { syncedTestFS, localTestFS } = s;
	const original = 'Should I be at BlackHat conference or working?';
	const fName = 'file1';
	await syncedTestFS.writeTxtFile(fName, original);
	let file = await syncedTestFS.readonlyFile(fName);

	const linkPath = 'link1';
	await localTestFS.link(linkPath, file);

	const link = await localTestFS.readLink(linkPath);
	expect(link.isFile).toBe(true, 'this link should be for a file');
	expect(link.readonly).toBe(true, 'this link should be readonly');

	file = (await link.target()) as web3n.files.ReadonlyFile;
	expect(!!file).toBe(true, 'target should be instantiated');
	expect(await file.readTxt()).toBe(original);
	expect(file.writable).toBe(false);
};
specs.its.push(it);

it = { expectation: 'links writable file' };
it.func = async function(s) {
	const { syncedTestFS, localTestFS } = s;
	const original = 'Should I be at BlackHat conference or working?';
	const fName = 'file1';
	await syncedTestFS.writeTxtFile(fName, original);
	let file = await syncedTestFS.writableFile(fName);

	const linkPath = 'link1';
	await localTestFS.link(linkPath, file);

	const link = await localTestFS.readLink(linkPath);
	expect(link.isFile).toBe(true, 'this link should be for a file');
	expect(link.readonly).toBe(false, 'this link should be writable');

	file = (await link.target()) as web3n.files.WritableFile;
	expect(!!file).toBe(true, 'target should be instantiated');
	expect(await file.readTxt()).toBe(original);
	const newTxt = 'I better work. A-a-a!!!';
	await file.writeTxt(newTxt);
	expect(await file.readTxt()).toBe(newTxt);
};
specs.its.push(it);

it = { expectation: 'links writable folder' };
it.func = async function(s) {
	const { syncedTestFS, localTestFS } = s;
	const original = 'Should I be at BlackHat conference or working?';
	const folderName = 'folder1';
	const fName = 'file1';
	await syncedTestFS.writeTxtFile(`${folderName}/${fName}`, original);
	let folder = await syncedTestFS.writableSubRoot(folderName);

	const linkPath = 'link1';
	await localTestFS.link(linkPath, folder);

	const link = await localTestFS.readLink(linkPath);
	expect(link.isFolder).toBe(true, 'this link should be for a folder');
	expect(link.readonly).toBe(false, 'this link should be writable');

	folder = (await link.target()) as web3n.files.WritableFS;
	expect(!!folder).toBe(true, 'target should be instantiated');
	expect(await folder.readTxtFile(fName)).toBe(original);
	const newTxt = 'I better work. A-a-a!!!';
	await folder.writeTxtFile(fName, newTxt);
	expect(await folder.readTxtFile(fName)).toBe(newTxt);
};
specs.its.push(it);
