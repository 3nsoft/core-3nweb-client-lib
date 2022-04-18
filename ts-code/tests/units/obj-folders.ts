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

import { itCond, beforeAllWithTimeoutLog, afterAllCond } from '../libs-for-tests/jasmine-utils';
import { stringOfB64UrlSafeCharsSync, bytes as randomBytes } from '../../lib-common/random-node';
import { join, basename } from 'path';
import { mkdir, rmDirWithContent, existsFolderSync, readFile, readdir, writeFile } from '../../lib-common/async-fs-node';
import { ObjFolders, Cfg } from '../../lib-client/objs-on-disk/obj-folders';

const TEST_DATA = join(__dirname,
	`../../../test-ObjFolders-${stringOfB64UrlSafeCharsSync(10)}`);

// internal constants from source file with used names
const ROOT_OBJ_DIR = '=root=';
const ACCESS_DIR = 'objs';
const GENERATIONS_DIR = 'generations';
const CONFIG_FILE = 'obj-folders-cfg.json';

const objsDir = join(TEST_DATA, ACCESS_DIR);
const gensDir = join(TEST_DATA, GENERATIONS_DIR);

async function readJSONFile<T>(path: string): Promise<T> {
	const str = await readFile(path, { encoding: 'utf8' });
	return JSON.parse(str);
}

async function numOfItemsIn(path: string): Promise<number> {
	return (await readdir(path)).length
}

async function writeFilesTo(folder: string, numOfFiles: number): Promise<void> {
	for (let i=1; i<=numOfFiles; i+=1) {
		const fileContent = await randomBytes(100);
		await writeFile(join(folder, `${i}.x`), fileContent);
	}
}

const charsInSplit = 3;
const numOfSplits = 3;

const idA = `111222333aaaaaa`;
const idB = `111222333bbbbbb`;
const idC = `111222555cccccc`;

describe('ObjFolders without timed generations', () => {

	let folders: ObjFolders;

	beforeAllWithTimeoutLog(async () => {
		await mkdir(TEST_DATA);
		folders = await ObjFolders.makeSimple(TEST_DATA, async (err, msg) => {
			console.error(`ObjFolders test error logging:\n${msg}`, err);
			fail(err);
		});
	});

	afterAllCond(async () => {
		await rmDirWithContent(TEST_DATA);
	});

	itCond(`static folder content`, async () => {
		expect(existsFolderSync(join(TEST_DATA, ACCESS_DIR))).toBeTrue();
		const cfg = await readJSONFile<Cfg>(join(TEST_DATA, CONFIG_FILE));
		expect(cfg.charsInSplit).withContext('default config value').toBe(charsInSplit);
		expect(cfg.numOfSplits).withContext('default config value').toBe(numOfSplits);
	});

	itCond(`null id for root object`, async () => {
		const rootObjPath = join(objsDir, ROOT_OBJ_DIR);

		// behaviour with missing obj folder and no creation
		expect(existsFolderSync(rootObjPath)).not.toBeTrue();
		let folderPath = await folders.getFolderAccessFor(null);
		expect(folderPath).withContext(`obj folder not present, and is not created`).toBeUndefined();
		expect(existsFolderSync(rootObjPath)).not.toBeTrue();

		folderPath = await folders.getFolderAccessFor(null, true);
		expect(folderPath).toBe(rootObjPath);
		expect(existsFolderSync(folderPath!)).toBeTrue();
		await writeFilesTo(folderPath!, 4);

		// behaviour with exiting obj folder
		let existingPath = await folders.getFolderAccessFor(null);
		expect(existingPath).toBe(folderPath);
		existingPath = await folders.getFolderAccessFor(null);
		expect(existingPath).toBe(folderPath);

		try {
			await folders.removeFolderOf(null as any);
			fail(`attempt to remove root obj must fail`);
		} catch (err) {
			expect(err).toBeDefined();
		}
	});

	itCond(`ids with same start`, async () => {
		const sameFstIdPart = idA.slice(0, charsInSplit*1);
		const sameSndIdPart = idA.slice(charsInSplit*1, charsInSplit*2);
		const sameThirdIdPart = idA.slice(charsInSplit*2, charsInSplit*3);
		const fstDepthCount = await numOfItemsIn(objsDir);

		// behaviour with missing obj folder and no creation
		expect(existsFolderSync(join(objsDir, sameFstIdPart))).not.toBeTrue();
		let folderA = await folders.getFolderAccessFor(idA);
		expect(folderA).withContext(`obj folder not present, and is not created`).toBeUndefined();

		folderA = await folders.getFolderAccessFor(idA, true);
		expect(existsFolderSync(folderA!)).toBeTrue();
		expect(basename(folderA!)).toBe(idA.slice(numOfSplits * charsInSplit));
		const threeLevelsDown = join(objsDir, sameFstIdPart, sameSndIdPart, sameThirdIdPart);
		expect(await numOfItemsIn(threeLevelsDown)).toBe(1);
		await writeFilesTo(folderA!, 4);

		// behaviour with exiting obj folder
		let existingPath = await folders.getFolderAccessFor(idA);
		expect(existingPath).toBe(folderA);
		existingPath = await folders.getFolderAccessFor(idA);
		expect(existingPath).toBe(folderA);

		expect(await numOfItemsIn(objsDir)).toBe(fstDepthCount+1);
		expect(existsFolderSync(join(objsDir, sameFstIdPart))).toBeTrue();
		const twoLevelsDown = join(objsDir, sameFstIdPart, sameSndIdPart);
		const thirdDepthCount = await numOfItemsIn(twoLevelsDown);

		const folderB = await folders.getFolderAccessFor(idB, true);
		expect(existsFolderSync(folderB!)).toBeTrue();
		expect(basename(folderB!)).toBe(idB.slice(numOfSplits * charsInSplit));
		expect(await numOfItemsIn(objsDir)).toBe(fstDepthCount+1);
		expect(await numOfItemsIn(twoLevelsDown)).toBe(thirdDepthCount);
		expect(await numOfItemsIn(threeLevelsDown)).toBe(2);
		await writeFilesTo(folderB!, 4);

		const folderC = await folders.getFolderAccessFor(idC, true);
		expect(existsFolderSync(folderC!)).toBeTrue();
		expect(basename(folderC!)).toBe(idC.slice(numOfSplits * charsInSplit));
		expect(await numOfItemsIn(objsDir)).toBe(fstDepthCount+1);
		expect(await numOfItemsIn(twoLevelsDown)).toBe(thirdDepthCount+1);
		await writeFilesTo(folderC!, 4);

		// listing obj folders
		const lstBeforeRemoval = await folders.listRecent();
		expect(lstBeforeRemoval.find(({ objId, path }) => (
			(objId === idA) && (path === folderA)))
		).toBeDefined();
		expect(lstBeforeRemoval.find(({ objId, path }) => (
			(objId === idB) && (path === folderB)))
		).toBeDefined();
		expect(lstBeforeRemoval.find(({ objId, path }) => (
			(objId === idC) && (path === folderC)))
		).toBeDefined();

		await folders.removeFolderOf(idA);
		let lst = await folders.listRecent();
		expect(lst.length).toBe(lstBeforeRemoval.length - 1);
		expect(await numOfItemsIn(objsDir)).toBe(fstDepthCount+1);
		expect(await numOfItemsIn(twoLevelsDown)).toBe(thirdDepthCount+1);
		expect(await numOfItemsIn(threeLevelsDown)).toBe(1);

		await folders.removeFolderOf(idB);
		lst = await folders.listRecent();
		expect(lst.length).toBe(lstBeforeRemoval.length - 2);
		expect(await numOfItemsIn(objsDir)).toBe(fstDepthCount+1);
		expect(await numOfItemsIn(twoLevelsDown)).toBe(thirdDepthCount);

		await folders.removeFolderOf(idC);
		lst = await folders.listRecent();
		expect(lst.length).toBe(lstBeforeRemoval.length - 3);
		expect(await numOfItemsIn(objsDir)).toBe(fstDepthCount);

		// removing non-existing obj is a noop
		await folders.removeFolderOf('nonExistingObject');
	});

});
