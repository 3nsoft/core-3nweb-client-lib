/*
 Copyright (C) 2022 - 2023 3NSoft Inc.
 
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

import initSqlJs, { Database as DBClass, BindParams as QueryParams, QueryExecResult as QueryResult, SqlValue } from './sqljs.js';
import { SingleProc, Action } from './synced.js';

export type Database = DBClass;
export type BindParams = QueryParams;
export type QueryExecResult = QueryResult;

type WritableFile = web3n.files.WritableFile;
type ReadonlyFile = web3n.files.ReadonlyFile;
type FileException = web3n.files.FileException;

export interface SaveOpts {
	skipUpload?: boolean;
}


export abstract class SQLiteOn3NStorage {

	protected readonly syncProc = new SingleProc();

	protected constructor(
		protected readonly database: Database,
		protected readonly file: WritableFile
	) {}

	static async makeAndStart(file: WritableFile): Promise<SQLiteOn3NStorage> {
		const SQL = await initSqlJs(true);
		const fileContent = await readFileContent(file);
		const db = new SQL.Database(fileContent);
		let sqlite: SQLiteOn3NStorage;
		if (file.v?.sync) {
			sqlite = new SQLiteOnSyncedFS(db, file);
		} else if (file.v) {
			sqlite = new SQLiteOnLocalFS(db, file);
		} else {
			sqlite = new SQLiteOnDeviceFS(db, file);
		}
		await sqlite.start();
		return sqlite;
	}

	private async start(): Promise<void> {
		// XXX add listening process(es)

	}

	async saveToFile(opts?: SaveOpts): Promise<void> {
		await this.syncProc.startOrChain(async () => {
			const dbFileContent = this.database.export();
			await this.file.writeBytes(dbFileContent);
		});
	}

	get db(): Database {
		return this.database;
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


class SQLiteOnSyncedFS extends SQLiteOn3NStorage {

	constructor(db: Database, file: WritableFile) {
		super(db, file);
		Object.seal(this);
	}

	async saveToFile(opts?: SaveOpts): Promise<void> {
		await super.saveToFile();
		if (opts?.skipUpload) {
			return;
		} else {
			await this.file.v!.sync!.upload();
		}
	}

}
Object.freeze(SQLiteOnSyncedFS.prototype);
Object.freeze(SQLiteOnSyncedFS);


class SQLiteOnLocalFS extends SQLiteOn3NStorage {

	constructor(db: Database, file: WritableFile) {
		super(db, file);
		Object.seal(this);
	}

}
Object.freeze(SQLiteOnLocalFS.prototype);
Object.freeze(SQLiteOnLocalFS);


class SQLiteOnDeviceFS extends SQLiteOn3NStorage {

	constructor(db: Database, file: WritableFile) {
		super(db, file);
		Object.seal(this);
	}

}
Object.freeze(SQLiteOnDeviceFS.prototype);
Object.freeze(SQLiteOnDeviceFS);


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

export function objectFromQueryExecResult<T>(
	sqlResult: QueryExecResult
): Array<T> {
	const { columns, values: rows } = sqlResult;
	return rows.map(row => row.reduce((obj, cellValue, index) => {
		const field = columns[index] as keyof T;
		obj[field] = cellValue as any;
		return obj;
	}, {} as T));
}

type KeyedInfo<T> = { [columnName in keyof T]: string; };


export class TableColumnsAndParams<EntryType extends object> {

	public readonly c: KeyedInfo<EntryType>;
	public readonly cReversed: { [colName: string ]: keyof EntryType; };
	public readonly p: KeyedInfo<EntryType>;
	public readonly q: KeyedInfo<EntryType>;
	public readonly columnsCreateSection: string;

	constructor(
		public readonly name: string,
		private readonly columnDefs: {
			[columnName in keyof EntryType]: [ string, string ];
		}
	) {
		this.columnsCreateSection = Object.values<[string, string]>(columnDefs)
		.map(([ colName, colCreate ]) => `${colName} ${colCreate}`)
		.join(`,\n`);
		this.c = {} as this['c'];
		this.cReversed = {} as this['cReversed'];
		this.p = {} as this['p'];
		this.q = {} as this['q'];
		for (const [ field, [ colName ]] of
			Object.entries<[string, string]>(this.columnDefs)
		) {
			this.c[field as keyof EntryType] = colName;
			this.cReversed[colName] = field as keyof EntryType;
			this.p[field as keyof EntryType] = `$${field}`;
			this.q[field as keyof EntryType] = `${this.name}.${colName}`;
		}
		Object.freeze(this.c);
		Object.freeze(this.p);
		Object.freeze(this.q);
		Object.freeze(this.name);
		Object.freeze(this.columnsCreateSection);
	}

	private toC(field: string|(keyof EntryType)): string {
		const colName = this.c[field as keyof EntryType];
		if (colName === undefined) {
			throw new Error(`Column for ${field as string} is not found among columns of table ${this.name}`);
		}
		return colName;
	}

	toParams<T extends { [field in keyof EntryType]: any; }>(
		value: Partial<T>, addNullsForMissingFields = false
	): any {
		const params = {} as any;
		for (const [field, columnValue] of Object.entries(value)) {
			this.toC(field);	// does implicit check for column existence
			params[this.p[field as keyof EntryType]] = columnValue;
		}
		if (addNullsForMissingFields) {
			for (const paramName of Object.values(this.p)) {
				if (params[paramName as string] === undefined) {
					params[paramName as string] = null;
				}
			}
		}
		return params;
	}

	fromQueryExecResult<T>(
		sqlResult: QueryExecResult[]
	): Array<T> {
		if (sqlResult.length === 0) { return []; }
		if (sqlResult.length > 1) {
			throw new Error(`This method will not process result of many queries`);
		}
		const { columns, values: rows } = sqlResult[0];
		return rows.map(row => row.reduce((obj, cellValue, index) => {
			const tabColumn = columns[index];
			let field = this.cReversed[tabColumn];
			if (field === undefined) {
				field = tabColumn as keyof EntryType;
			}
			obj[field as string as keyof T] = cellValue as any;
			return obj;
		}, {} as T));
	}

	get insertQuery(): string {
		const colAndParamNames = Object.entries(this.p);
		return `INSERT INTO ${this.name} (${
			colAndParamNames.map(([field]) => this.toC(field)).join(', ')
		}) VALUES (${
			colAndParamNames.map(([n, colParam]) => colParam).join(', ')
		})`;
	}

	updateQuery(
		withTabName: boolean,
		fields: (keyof EntryType)[]|undefined = undefined,
		skipColumns = false
	): string {
		let fieldAndParamNames = Object.entries(this.p);
		if (fields) {
			if (skipColumns) {
				fieldAndParamNames = fieldAndParamNames.filter(
					([field]) => !fields.includes(field as keyof EntryType)
				);
			} else {
				fieldAndParamNames = fieldAndParamNames.filter(
					([field]) => fields.includes(field as keyof EntryType)
				);
			}
		}
		return `UPDATE ${withTabName ? `${this.name} ` : ''}SET ${
			fieldAndParamNames
			.map(([field, pName]) => `${this.toC(field)}=${pName}`)
			.join(', ')
		}`;
	}

	colsEqualSection(...fields: (keyof EntryType)[]): string {
		return (fields)
		.map(n => `${this.toC(n as string)}=${this.p[n]}`)
		.join(' AND ');
	}

	colsSection(...fields: (keyof EntryType)[]): string {
		return (fields)
		.map(n => this.toC(n as string))
		.join(', ');
	}

}
Object.freeze(TableColumnsAndParams.prototype);
Object.freeze(TableColumnsAndParams);
