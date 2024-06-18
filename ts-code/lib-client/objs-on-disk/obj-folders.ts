/*
 Copyright (C) 2016 - 2020, 2022 3NSoft Inc.

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

import * as fs from '../../lib-common/async-fs-node';
import { NamedProcs } from '../../lib-common/processes/synced';
import { FileException } from '../../lib-common/exceptions/file';
import { LogError } from '../logging/log-to-file';
import { NONCE_LENGTH } from 'xsp-files';
import { assert } from '../../lib-common/assert';
import { errWithCause } from '../../lib-common/exceptions/error';
import { join } from 'path';
import { ObjId } from '../3nstorage/xsp-fs/common';

export interface Exception extends web3n.RuntimeException {
	type: 'cache';
	notFound?: true;
	alreadyExist?: true;
	concurrentTransaction?: true;
}

export function makeNotFoundExc(msg: string): Exception {
	return {
		runtimeException: true,
		type: 'cache',
		cause: msg,
		notFound: true
	};
}

export function makeAlreadyExistExc(msg: string): Exception {
	return {
		runtimeException: true,
		type: 'cache',
		cause: msg,
		alreadyExist: true
	};
}

function alreadyExistsOrReThrow(exc: FileException): void {
	if (!exc.alreadyExists) { throw exc; }
}

export interface GenerationCfg {
	period: number;
	lastDone: number;
}

export interface Cfg {
	numOfSplits: number;
	charsInSplit: number;
}

export interface CfgWithGens extends Cfg {
	generations: GenerationCfg[];
}

function defaultCfg(): Cfg {
	return { charsInSplit: 3, numOfSplits: 3 };
}

function defaultCfgWithGens(): CfgWithGens {
	const cfg = defaultCfg() as CfgWithGens;
	const hour = 60*60;
	const now = Math.floor(Date.now()/1000);
	cfg.generations = [
		{ period: 24*hour, lastDone: now },
		{ period: 7*24*hour, lastDone: now },
		{ period: 30*24*hour, lastDone: now } ];
	return cfg;
}

const ROOT_OBJ_DIR = '=root=';
const ACCESS_DIR = 'objs';
const GENERATIONS_DIR = 'generations';
const CONFIG_FILE = 'obj-folders-cfg.json';

export type CanMoveObjToDeeperCache = (
	objId: string, folderPath: string
) => Promise<boolean>;

export class ObjFolders {

	/**
	 * Process ids here are values of the first section in each folder tree.
	 */
	private readonly syncProcs = new NamedProcs();
	private readonly accessFolder: string;
	private readonly generationsFolder: string;
	// XXX rotation process is disabled, till its error is fixed
	private readonly rotationsProc: RotationsProc|undefined;

	private constructor(
		private readonly path: string,
		private readonly numOfSplits: number,
		private readonly charsInSplit: number,
		private readonly logError: LogError,
		private readonly generations?: GenerationCfg[],
		canMove?: CanMoveObjToDeeperCache
	) {
		assert(Number.isInteger(this.numOfSplits) && (this.numOfSplits > 0) &&
			Number.isInteger(this.charsInSplit) && (this.charsInSplit > 0));
		this.accessFolder = join(this.path, ACCESS_DIR);
		if (this.generations) {
			if (!canMove) { throw new Error(
				`Missing a can-move predicate when generations are present`); }
			this.generationsFolder = join(this.path, GENERATIONS_DIR);
			// XXX rotation process is disabled, till its error is fixed
			// this.rotationsProc = new RotationsProc(
			// 	this.accessFolder, this.generationsFolder,
			// 	this.generations, this.syncProcs, canMove, this.saveCfg,
			// 	this.logError);
			// this.rotationsProc.scheduleStart(10*60);
		}
		Object.freeze(this);
	}

	static async makeWithGenerations(
		path: string, canMove: CanMoveObjToDeeperCache, logError: LogError
	): Promise<ObjFolders> {
		let cfg = await readCfgFrom(path);
		if (cfg === undefined) {
			cfg = defaultCfgWithGens();
			await writeCfgTo(path, cfg);
		}
		checkCfg(cfg);
		await fs.mkdir(join(path, ACCESS_DIR)).catch(alreadyExistsOrReThrow);
		await fs.mkdir(join(path, GENERATIONS_DIR)).catch(alreadyExistsOrReThrow);
		return new ObjFolders(path, cfg.numOfSplits, cfg.charsInSplit, logError,
			(cfg as CfgWithGens).generations, canMove);
	}

	static async makeSimple(
		path: string, logError: LogError
	): Promise<ObjFolders> {
		let cfg = await readCfgFrom(path);
		if (cfg === undefined) {
			cfg = defaultCfg();
			await writeCfgTo(path, cfg);
		}
		checkCfg(cfg);
		await fs.mkdir(join(path, ACCESS_DIR)).catch(alreadyExistsOrReThrow);
		return new ObjFolders(path, cfg.numOfSplits, cfg.charsInSplit, logError);
	}

	private readonly saveCfg = () => writeCfgTo(this.path, {
		charsInSplit: this.charsInSplit,
		numOfSplits: this.numOfSplits,
		generations: this.generations
	});

	private idToPathSections(objId: string): string[] {
		const path: string[] = [];
		for (let i=0; i<this.numOfSplits; i+=1) {
			const idSection = objId.substring(
				i*this.charsInSplit, (i+1)*this.charsInSplit);
			if (idSection.length === 0) { throw new Error(
				`Given id "${objId}" is too short for splitting`); }
			path.push(idSection);
		}
		path.push(objId.substring(this.numOfSplits*this.charsInSplit));
		return path;
	}

	private genBucketPath(bucketIndex: number): string {
		return join(this.generationsFolder, `${bucketIndex}`);
	}

	private async findObjFolder(
		pathSections: string[]
	): Promise<{ genBacket?: number; folder: string; }|undefined> {
		const folder = join(this.accessFolder, ...pathSections);
		if (await folderExists(folder)) {
			return { folder };
		}
		if (!this.generations) { return; }
		for (let i=0; i<this.generations.length; i+=1) {
			const folder = join(this.genBucketPath(i), ...pathSections);
			if (await folderExists(folder)) {
				return { folder, genBacket: i };
			}
		}
	}

	getFolderAccessFor(
		objId: ObjId, createIfMissing = false
	): Promise<string|undefined> {
		if (!objId) {
			const folder = join(this.accessFolder, ROOT_OBJ_DIR);
			return this.syncProcs.startOrChain(ROOT_OBJ_DIR, async () => {
				if (await folderExists(folder)) { return folder; }
				if (!createIfMissing) { return; }
				await fs.mkdir(folder);
				return folder;
			});
		}
		const pathSections = this.idToPathSections(objId);
		return this.syncProcs.startOrChain(pathSections[0], async () => {
			const found = await this.findObjFolder(pathSections);
			if (found) {
				if (found.genBacket === undefined) { return found.folder; }
				const folder = await move(this.genBucketPath(found.genBacket),
					pathSections, this.accessFolder);
				return folder;
			}
			if (!createIfMissing) { return; }
			const folder = await makeTreeExclusively(
				this.accessFolder, pathSections);
			return folder;
		});
	}

	removeFolderOf(objId: string): Promise<void> {
		assert(!!objId, `Root object can't be removed.`);
		const pathSections = this.idToPathSections(objId);
		return this.syncProcs.startOrChain(pathSections[0], async () => {
			const found = await this.findObjFolder(pathSections);
			if (!found) { return; }
			const backetPath = ((found.genBacket === undefined) ?
				this.accessFolder : this.genBucketPath(found.genBacket));
			await deleteTree(backetPath, pathSections);
		});
	}

	async listRecent(): Promise<{ path: string; objId: ObjId; }[]> {
		const lst = (await allTreePaths(
			this.accessFolder, this.numOfSplits, this.logError))
		.map(pathSections => ({
			path: join(this.accessFolder, ...pathSections),
			objId: pathSections.join('') as ObjId
		}));
		const rootObjPath = join(this.accessFolder, ROOT_OBJ_DIR);
		if (await fs.existsFolder(rootObjPath)) {
			lst.unshift({ objId: null, path: rootObjPath });
		}
		return lst;
	}

}
Object.freeze(ObjFolders.prototype);
Object.freeze(ObjFolders);

class RotationsProc {

	private readonly numOfSplits: number;

	constructor(
		private readonly accessFolder: string,
		private readonly generationsFolder: string,
		private readonly generations: GenerationCfg[],
		private readonly syncProcs: NamedProcs,
		private readonly canMove: CanMoveObjToDeeperCache,
		private readonly saveCfg: () => Promise<void>,
		private readonly logError: LogError
	) {
		Object.seal(this);
	}

	scheduleStart(secs: number): void {
		this.setNextCacheRotation(secs);
	}

	private genBacketPath(backetIndex: number): string {
		return join(this.generationsFolder, `${backetIndex}`);
	}

	private setNextCacheRotation(secs: number): void {
		setTimeout(async () => {
			await this.rotate();
			this.setNextCacheRotation(this.generations[0].period);
		}, secs*1000).unref();
	}
	
	private async rotate(): Promise<void> {
		const now = Math.floor(Date.now()/1000);
		for (let i=(this.generations.length-1); i>=0; i-=1) {
			const gen = this.generations[i];
			if (now < (gen.lastDone + gen.period)) { continue; }
			gen.lastDone = now;
			await this.saveCfg();
			if (i === 0) {
				await this.moveFromAccessBacket();
			} else {
				await this.moveFromGenerationBacket(i);
			}
		}
	}

	private async moveFromAccessBacket(): Promise<void> {
		const srcBacket = this.accessFolder;
		const dstBacket = this.genBacketPath(0);
		const objPathSections = await allTreePaths(
			srcBacket, this.numOfSplits, this.logError);
		for (let i=0; i<objPathSections.length; i+=1) {
			const sections = objPathSections[i];
			const objId = sections.join('');
			const objFolderPath = join(srcBacket, ...sections);
			await this.syncProcs.startOrChain(sections[0], async () => {
				if (!(await this.canMove(objId, objFolderPath))) { return; }
				await move(srcBacket, sections, dstBacket);
			});
		}
	}

	private async moveFromGenerationBacket(srcBacketInd: number): Promise<void> {
		const srcBacket = this.genBacketPath(srcBacketInd);
		const dstBacket = this.genBacketPath(srcBacketInd+1);
		const objPathSections = await allTreePaths(
			srcBacket, this.numOfSplits, this.logError);
		for (let i=0; i<objPathSections.length; i+=1) {
			const sections = objPathSections[i];
			const srcObjPath = join(srcBacket, ...sections);
			await this.syncProcs.startOrChain(sections[0], async () => {
				if (!(await folderExists(srcObjPath))) { return; }
				await move(srcBacket, sections, dstBacket);
			});
		}
	}

}
Object.freeze(RotationsProc.prototype);
Object.freeze(RotationsProc);

/**
 * Function to create tree of folders, according to given path sections, rooted
 * in given base. Returned promise resolves to the whole path. Intermediate
 * folders may exist before this call, but if the last folder exists, exception
 * is thrown.
 * @param base 
 * @param pathSections 
 */
async function makeTreeExclusively(
	base: string, pathSections: string[]
): Promise<string> {
	assert(pathSections.length > 0);
	const treePaths = treePathsFor(base, pathSections);
	const intermediateFolders = treePaths.slice(0, treePaths.length-1);
	await makeFoldersNonexclusively(intermediateFolders);
	const exclusiveFolder = treePaths[treePaths.length-1];
	await fs.mkdir(exclusiveFolder).catch((exc: FileException) => {
		if (exc.alreadyExists) { throw makeAlreadyExistExc(
			`Object folder ${exclusiveFolder} already exists`); }
		throw exc;
	});
	return exclusiveFolder;
}

/**
 * This removes top-most folder in a given tree, and empty intermediate folders.
 * @param base 
 * @param pathSections 
 */
async function deleteTree(
	base: string, pathSections: string[]
): Promise<void> {
	assert(pathSections.length > 0);
	const treePaths = treePathsFor(base, pathSections);
	const intermediateFolders = treePaths.slice(0, treePaths.length-1);
	const leafFolder = treePaths[treePaths.length-1];
	await fs.rmDirWithContent(leafFolder);
	await removeIntermediateFoldersIfEmpty(intermediateFolders);
}

/**
 * This creates folders for given paths, but non-exclusively. It is not an
 * exception if any of folders exist.
 * @param treePaths 
 */
async function makeFoldersNonexclusively(treePaths: string[]): Promise<void> {
	for (let i=0; i<treePaths.length; i+=1) {
		const path = treePaths[i];
		const stats = await fs.stat(path).catch((exc: FileException) => {
			if (!exc.notFound) { throw exc; }
		});
		if (!stats) {
			await fs.mkdir(path).catch((exc: FileException) => {
				if (!exc.alreadyExists) { throw exc; }
			});
			continue;
		} else if (!stats.isDirectory()) {
			throw new Error(`Path ${path} is not a folder in obj's folder tree`);
		}
	}
}

/**
 * This folders for given paths, stopping if folders are not empty.
 * @param treePaths 
 */
async function removeIntermediateFoldersIfEmpty(
	treePaths: string[]
): Promise<void> {
	for (let i=treePaths.length-1; i>=0; i-=1) {
		const path = treePaths[i];
		const isNotEmpty = await fs.rmdir(path).catch((exc: FileException) => {
			if (exc.notEmpty) { return true; }
			throw exc;
		});
		if (isNotEmpty) { return; }
	}
}

/**
 * This returns promise, resolvable either to true, if given path is a folder,
 * or to false, if it doesn't exist.
 * @param path 
 */
async function folderExists(path: string): Promise<boolean> {
	try {
		const stats = await fs.stat(path);
		if (!stats.isDirectory()) { throw new Error(
			`Path ${path} is not a folder in obj's folder tree`); }
		return true;
	} catch(exc) {
		if ((exc as FileException).notFound) { return false; }
		throw exc;
	}
}

/**
 * This produces an array of paths, corresponding to each path sections, rooted
 * in a given base.
 * @param base 
 * @param pathSections 
 */
function treePathsFor(base: string, pathSections: string[]): string[] {
	const paths: string[] = [];
	let path = base;
	for (let i=0; i<pathSections.length; i+=1) {
		path = join(path, pathSections[i]);
		paths.push(path);
	}
	return paths;
}

/**
 * This moves top most folder of a tree, given by path sections, from source
 * base to destination base. In doing so, it creates and removes respective
 * intermediate folders of a tree.
 * @param srcBase 
 * @param pathSections 
 * @param dstBase 
 */
async function move(
	srcBase: string, pathSections: string[], dstBase: string
): Promise<string> {
	const srcTreePaths = treePathsFor(srcBase,pathSections);
	const srcInterimFolders = srcTreePaths.slice(0, srcTreePaths.length-1);
	const srcPath = srcTreePaths[srcTreePaths.length-1];
	if (!(await folderExists(srcPath))) { throw makeNotFoundExc(
		`Can't move object folder ${srcPath}, cause it is not found.`); }

	const dstTreePaths = treePathsFor(dstBase, pathSections);
	const dstInterimFolders = dstTreePaths.slice(0, dstTreePaths.length-1);
	const dstPath = dstTreePaths[dstTreePaths.length-1];

	await makeFoldersNonexclusively(dstInterimFolders);
	await fs.rename(srcPath, dstPath);
	await removeIntermediateFoldersIfEmpty(srcInterimFolders);

	return dstPath;
}

async function readJSONFile<T>(path: string): Promise<T|undefined> {
	const jsonStr = await fs.readFile(path, { encoding: 'utf8' })
	.catch((exc: FileException) => {
		if (exc.notFound) { return; }
		throw exc;
	});
	if (jsonStr === undefined) { return; }
	try {
		return JSON.parse(jsonStr) as T;
	} catch (err) {
		throw errWithCause(err, `Can't parse json file ${path}`);
	}
}

async function readCfgFrom(path: string): Promise<Cfg|CfgWithGens|undefined> {
	const cfg = await readJSONFile<Cfg|CfgWithGens>(join(path, CONFIG_FILE));
	const accessDir = join(path, ACCESS_DIR);
	const accessDirFound = await folderExists(accessDir);
	const gensDir = join(path, GENERATIONS_DIR);
	const gensDirFound = await folderExists(gensDir);
	if (cfg === undefined) {
		if (accessDirFound || (gensDirFound)) { throw new Error(
			`Configuration for object folder is missing in ${path}, while data folder(s) is(are) present.`); }
		return;
	}
	if (!accessDirFound) {
		await fs.mkdir(accessDir);
	}
	if ((cfg as CfgWithGens).generations && !gensDirFound) {
		await fs.mkdir(gensDir);
	}
	return cfg;
}

async function writeCfgTo(path: string, cfg: Cfg|CfgWithGens): Promise<void> {
	try {
		await fs.writeFile(join(path, CONFIG_FILE),
			JSON.stringify(cfg), { encoding: 'utf8' });
	} catch (err) {
		if (!(err as FileException).notFound) { throw err; }
		await fs.ensureFolderExists(path);
		await fs.writeFile(join(path, CONFIG_FILE),
			JSON.stringify(cfg), { encoding: 'utf8' });
	}
}

function checkCfg(cfg: Cfg|CfgWithGens, needGens = false): void {
	assert(Number.isInteger(cfg.numOfSplits) && (cfg.numOfSplits > 0),
		`Invalid numOfSplits in object folders' configuration: ${cfg.numOfSplits}`);
	assert(Number.isInteger(cfg.charsInSplit) && (cfg.charsInSplit > 0),
		`Invalid charsInSplit in object folders' configuration: ${cfg.charsInSplit}`);
	assert(cfg.numOfSplits*cfg.charsInSplit < Math.floor(NONCE_LENGTH/3*4),
		`Invalid splits configuration, expecting too many letters in object id`);
	if (needGens) {
		const gens = (cfg as CfgWithGens).generations;
		assert(Array.isArray(gens),
			`Invalid generations in object folders' configuration: ${gens}`);
		assert(gens.length > 0, `Config must have at least one generation`);
	}
}

async function allTreePaths(
	path: string, numOfSplits: number, logError: LogError
): Promise<string[][]> {
	const lst = await fs.readdir(path)
	.catch(async (exc: FileException) => {
		if (exc.notFound) { return; }
		await logError(exc, `Enumerating a split tree of objects, got an error while trying to list directory ${path}`);
	});
	if (!lst) { return []; }
	if (numOfSplits <= 0) {
		return lst.map(f => [f]);
	}
	const sections: string[][] = [];
	for (let i=0; i<lst.length; i+=1) {
		const f = lst[i];
		if (f === ROOT_OBJ_DIR) { continue; }
		const treePaths = await allTreePaths(
			join(path, f), numOfSplits-1, logError);
		for (let j=0; j<treePaths.length; j+=1) {
			const branch = treePaths[j];
			branch.unshift(f);
			sections.push(branch);
		}
	}
	return sections;
}

Object.freeze(exports);