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

import { Action, SingleProc } from '../lib-common/processes/synced';
import initSqlJs, { Database as DBClass, BindParams as QueryParams, QueryExecResult as QueryResult } from './sqljs';

export type Database = DBClass;
export type BindParams = QueryParams;
export type QueryExecResult = QueryResult;

type WritableFile = web3n.files.WritableFile;
type ReadonlyFile = web3n.files.ReadonlyFile;
type FileException = web3n.files.FileException;


export abstract class SQLiteOn3NStorage {

	protected readonly syncProc = new SingleProc();

	protected constructor(
		protected readonly database: Database,
		protected readonly file: WritableFile
	) {}

	get db(): Database {
		return this.database;
	}

	get dbFile(): WritableFile {
		return this.file;
	}

	sync<T>(action: Action<T>): Promise<T> {
		return this.syncProc.startOrChain(action);
	}

	listTables(): string[] {
		const result = this.database.exec(
			`SELECT tbl_name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'`
		);
		return ((result.length > 0) ?
			result[0].values.map(row => row[0] as string) :
			[]
		);
	}

}
Object.freeze(SQLiteOn3NStorage.prototype);
Object.freeze(SQLiteOn3NStorage);


export class SQLiteOnUnversionedFS extends SQLiteOn3NStorage {

	static async makeAndStart(
		file: WritableFile
	): Promise<SQLiteOnUnversionedFS> {
		const db = await readDbFrom(file);
		return new SQLiteOnUnversionedFS(db, file);
	}

	async saveToFile(): Promise<void> {
		await this.syncProc.startOrChain(async () => {
			const dbFileContent = this.database.export();
			await this.file.writeBytes(dbFileContent);
		});
	}

}
Object.freeze(SQLiteOnUnversionedFS.prototype);
Object.freeze(SQLiteOnUnversionedFS);


export class SQLiteOnVersionedFS extends SQLiteOn3NStorage {

	protected constructor(db: Database, file: WritableFile) {
		super(db, file);
		if (!file.v) { throw new Error(`Given file is not versioned`); }
	}

	static async makeAndStart(file: WritableFile): Promise<SQLiteOnVersionedFS> {
		const db = await readDbFrom(file);
		return new SQLiteOnVersionedFS(db, file);
	}

	async saveToFile(): Promise<number> {
		return await this.syncProc.startOrChain(async () => {
			const dbFileContent = this.database.export();
			return await this.file.v!.writeBytes(dbFileContent);
		});
	}

}
Object.freeze(SQLiteOnVersionedFS.prototype);
Object.freeze(SQLiteOnVersionedFS);


export class SQLiteOnSyncedFS extends SQLiteOnVersionedFS {

	protected constructor(db: Database, file: WritableFile) {
		super(db, file);
		if (!file.v?.sync) { throw new Error(`Given file is not synced`); }
	}

	static async makeAndStart(file: WritableFile): Promise<SQLiteOnSyncedFS> {
		const db = await readDbFrom(file);
		return new SQLiteOnSyncedFS(db, file);
	}

}
Object.freeze(SQLiteOnSyncedFS.prototype);
Object.freeze(SQLiteOnSyncedFS);


export async function readDbFrom(file: ReadonlyFile): Promise<Database> {
	const SQL = await initSqlJs(true);
	const fileContent = await readFileContent(file);
	return new SQL.Database(fileContent);
}

async function readFileContent(
	file: ReadonlyFile
): Promise<Uint8Array|undefined> {
	try {
		return await file.readBytes();
	} catch (exc) {
		if ((exc as FileException).notFound) {
			return undefined;
		} else {
			throw exc;
		}
	}
}
