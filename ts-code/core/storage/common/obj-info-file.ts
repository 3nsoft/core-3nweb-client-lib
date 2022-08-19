/*
 Copyright (C) 2020, 2022 3NSoft Inc.

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

import * as fs from '../../../lib-common/async-fs-node';
import { join } from 'path';
import { makeStorageException } from '../../../lib-client/3nstorage/exceptions';

export async function readJSONInfoFileIn<T>(
	objFolder: string, fileName: string
): Promise<T|undefined> {
	try {
		const infoJSONStr = await fs.readFile(
			join(objFolder, fileName),
			{ encoding: 'utf8' }
		).catch((exc: fs.FileException) => {
			if (!exc.notFound) { throw exc; }
			return;
		});
		if (typeof infoJSONStr !== 'string') { return; }
		const status = JSON.parse(infoJSONStr) as T;
		return status;
	} catch (err) {
		throw makeStorageException({
			message: `Can't read and parse content of obj info file ${fileName} in obj folder ${objFolder}`,
			cause: err
		});
	}
}

export interface VersionsInfo {

	/**
	 * This field indicates current object version in cache.
	 */
	current?: number;

	/**
	 * This is a list of archived versions in the cache.
	 */
	archived?: number[];

	/**
	 * This is a map from base version to diff-ed version, that uses base.
	 */
	baseToDiff: { [baseVersion: number]: number; };

	/**
	 * This is a map from diff version to base version.
	 */
	diffToBase: { [diffVersion: number]: number; };

}

/**
 * This function adds base->diff link to given versions info.
 * @param versions
 * @param diffVer
 * @param baseVer
 */
export function addBaseToDiffLinkInVersInfo(
	versions: VersionsInfo, diffVer: number, baseVer: number
): void {
	if (diffVer <= baseVer) { throw new Error(
		`Given diff version ${diffVer} is not greater than base version ${baseVer}`); }
	versions.diffToBase[diffVer] = baseVer;
	versions.baseToDiff[baseVer] = diffVer;
}

export function isVersionIn(version: number, vers: VersionsInfo): boolean {
	if (vers.current === version) { return true; }
	if (vers.archived && vers.archived.includes(version)) { return true; }
	return false;
}

/**
 * This function removes given version from versions info, if it is neither
 * archived, nor is a base for another version. If given version is itself
 * based on another, this function is recursively applied to base version, as
 * well.
 * @param versions
 * @param ver
 */
export function rmNonArchVersionsIn(versions: VersionsInfo, ver: number): void {
	if (versions.archived
	&& versions.archived.includes(ver)) { return; }
	if (versions.baseToDiff[ver]) { return; }
	const base = versions.diffToBase[ver];
	if (base) {
		delete versions.diffToBase[ver];
		delete versions.baseToDiff[base];
		rmNonArchVersionsIn(versions, base);
	}
}

export function rmArchVersionFrom(
	versions: VersionsInfo, ver: number
): boolean {
	if (!versions.archived) { return false; }
	const vInd = versions.archived.indexOf(ver);
	if (vInd < 0) { return false; }
	versions.archived.splice(vInd, 1);
	if (versions.archived.length === 0) {
		versions.archived = undefined;
	}
	rmNonArchVersionsIn(versions, ver);
	return true;
}

export function setCurrentVersionIn(
	versions: VersionsInfo, version: number, baseVer: number|undefined
): void {
	if (baseVer !== undefined) {
		// base->diff links should be added before removals
		addBaseToDiffLinkInVersInfo(versions, version, baseVer);
	}
	const initCurrent = versions.current;
	if (typeof initCurrent === 'number') {
		rmNonArchVersionsIn(versions, initCurrent);
	}
	versions.current = version;
}

export function rmCurrentVersionIn(versions: VersionsInfo): number|undefined {
	const current = versions.current;
	if (typeof current === 'number') {
		rmNonArchVersionsIn(versions, current);
		versions.current = undefined;
	}
	return current;
}

export function rmVersionIn(version: number, vers: VersionsInfo): void {
	if (vers.current === version) {
		vers.current = undefined;
		rmNonArchVersionsIn(vers, version);
	}
	if (isVersionIn(version, vers)) {
		rmArchVersionFrom(vers, version);
	}
}

export function nonGarbageVersionsIn(versions: VersionsInfo): Set<number> {
	const nonGarbage = new Set<number>();
	addWithBasesTo(nonGarbage, versions.current, versions);
	if (versions.archived) {
		for (const archVer of versions.archived) {
			addWithBasesTo(nonGarbage, archVer, versions);
		}
	}
	return nonGarbage;
}

export interface NonGarbageVersions {
	gcMaxVer?: number;
	nonGarbage: Set<number>;
}

export function addWithBasesTo(
	nonGarbage: Set<number>, ver: number|undefined, versions: VersionsInfo
): void {
	while (typeof ver === 'number') {
		if (nonGarbage.has(ver)) { break; }
		nonGarbage.add(ver);
		if (!versions.diffToBase) { break; }
		ver = versions.diffToBase[ver];
	}
}

export function addArchived(versions: VersionsInfo, version: number): boolean {
	if (!versions.archived) {
		versions.archived = [];
	} else if (versions.archived.includes(version)) {
		return false;
	}
	versions.archived.push(version);
	versions.archived.sort();
	return true;
}

export function isEmptyVersions(versions: VersionsInfo): boolean {
	if (versions.current) { return false; }
	if (!versions.archived) {
		return true;
	} else if (versions.archived.length > 0) {
		return false;
	} else {
		versions.archived = undefined;
		return true;
	}
}


Object.freeze(exports);