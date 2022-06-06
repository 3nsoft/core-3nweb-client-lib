/*
 Copyright (C) 2016 - 2020 3NSoft Inc.
 
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

import { FileException } from '../../../lib-common/exceptions/file';
import { SingleProc } from '../../../lib-common/processes/synced';
import { MsgKeyInfo, MsgKeyRole } from '../keyring';
import { base64 } from '../../../lib-common/buffer-utils';
import { makeTimedCache } from "../../../lib-common/timed-cache";

type WritableFS = web3n.files.WritableFS;

interface MsgRecord extends web3n.asmail.MsgInfo {
	key: string;
	keyStatus: MsgKeyRole;
	mainObjHeaderOfs: number;
	removeAfter?: number;
}

interface MsgRecords {
	fileTS: number;
	byId: Map<string, MsgRecord>;
	ordered: MsgRecord[];
}

const LIMIT_RECORDS_PER_FILE = 200;

const LATEST_INDEX = 'latest.json';
const INDEX_EXT = '.json';
const INDEX_FNAME_REGEXP = /^\d+\.json$/;

// XXX request to 'undefined.json' was spotted, and it probably comes from here.
//		Either ensure that it doesn't happen here, or find it and fix it.

function fileTSOrderComparator(a: number, b: number): number {
	return (a - b);
}

function insertInto(records: MsgRecords, rec: MsgRecord): void {
	records.byId.set(rec.msgId, rec);
	if (records.ordered.length === 0) {
		records.ordered.push(rec);
	} else {
		const ts = rec.deliveryTS;
		for (let i=(records.ordered.length-1); i>=0; i-=1) {
			if (records.ordered[i].deliveryTS <= ts) {
				records.ordered.splice(i+1, 0, rec);
				return;
			}
		}
		records.ordered.splice(0, 0, rec);
	}
}

function removeFrom(records: MsgRecords, msgId: string): void {
	records.byId.delete(msgId);
	for (let i=0; i<records.ordered.length; i+=1) {
		if (records.ordered[i].msgId === msgId) {
			records.ordered.splice(i, 1);
			break;
		}
	}
}

function extractEarlyRecords(records: MsgRecords, recToExtract: number):
		MsgRecords {
	if (records.ordered.length < recToExtract) { throw new Error(
		'Given too few records.'); }
	const byId = new Map<string, MsgRecord>();
	const ordered = records.ordered.splice(0, recToExtract);
	const fileTS = ordered[ordered.length-1].deliveryTS;
	for (const rec of ordered) {
		byId.set(rec.msgId, rec);
		records.byId.delete(rec.msgId);
	}
	return { byId, ordered, fileTS };
}

function reduceToMsgInfosInPlace(records: web3n.asmail.MsgInfo[]): void {
	for (let i=0; i<records.length; i+=1) {
		const orig = records[i];
		records[i] = {
			msgType: orig.msgType,
			msgId: orig.msgId,
			deliveryTS: orig.deliveryTS
		};
	}
}
	
interface MsgInfoWithoutType {
	msgId: string;
	deliveryTS: number;
}

/**
 * This message index stores MsgRecord's for message present on the server, i.e.
 * inbox. Records contain message key info, time of delivery, and time of
 * desired removal. Note that when user wants to keep a particular message for
 * a long time, it should be copied elsewhere, and not kept in the asmail
 * server inbox. Therefore, this index has to deal only with more-or-less
 * recent messages.
 * 
 * This implementation is not using database for records, but a log-like files.
 * Latest file is appended to certain length, and then is left to a mostly-read
 * existence, carrying messages' info till message removal.
 * When lookup is done only with message id, all files potentially need to be
 * read. When both message id and delivery timestamp are given, lookup will at
 * most touch two-three files.
 * 
 */
export class MsgIndex {
	
	private latest: MsgRecords = (undefined as any);
	private readonly cached = makeTimedCache<number, MsgRecords>(10*60*1000);
	private fileTSs: number[] = (undefined as any);
	private readonly fileProc = new SingleProc();
	
	private constructor(
		private files: WritableFS
	) {
		Object.seal(this);
	}
	
	static async makeWith(files: WritableFS): Promise<MsgIndex> {
		const index = new MsgIndex(files);
			
		// 1) initialize latest records index
		const latest = await index.getRecords(undefined);
		if (latest) {
			index.latest = latest;
		} else {
			index.latest = {
				fileTS: (undefined as any),
				byId: new Map<string, MsgRecord>(),
				ordered: []
			};
			await index.saveRecords(index.latest);
		}
		
		// 2) initialize list of file timestamps, that act as index file names
		index.fileTSs = (await index.files.listFolder('.'))
		.map(f => f.name)
		.filter(fName => fName.match(INDEX_FNAME_REGEXP))
		.map(fName => parseInt(fName.substring(
			0, fName.length-INDEX_EXT.length)))
		.sort(fileTSOrderComparator);

		return index;
	}

	/**
	 * @param recs that need to be saved
	 * @return a promise, resolvable when given records are saved. Latest
	 * records can also be chunked and saved as needed. 
	 */
	private async saveRecords(recs: MsgRecords): Promise<void> {
		if (typeof recs.fileTS !== 'number') {
			if (this.latest.ordered.length > 1.25*LIMIT_RECORDS_PER_FILE) {
				const recs = extractEarlyRecords(this.latest, LIMIT_RECORDS_PER_FILE);
				const recsFileTS = recs.ordered[recs.ordered.length-1].deliveryTS;
				const fName = recsFileTS+INDEX_EXT;
				await this.files.writeJSONFile(fName, recs.ordered);
				this.cached.set(recsFileTS, recs);
				this.fileTSs.push(recsFileTS);
			}
			await this.files.writeJSONFile(LATEST_INDEX, this.latest.ordered);
		} else {
			const fName = recs.fileTS+INDEX_EXT;
			await this.files.writeJSONFile(fName, recs.ordered);
			this.cached.set(recs.fileTS, recs);
		}
	}
	
	/**
	 * @param fileTS is index file's timestamp. Undefined value means latest
	 * records.
	 * @return a promise, resolvable to found records, either from a memory
	 * cache, or from a file.
	 */
	private async getRecords(fileTS: number|undefined):
			Promise<MsgRecords|undefined> {
		if (typeof fileTS === 'number') {
			const recs = this.cached.get(fileTS);
			if (recs) { return recs; }
		} else {
			if (this.latest) { return this.latest; }
		}
		const fName = (typeof fileTS === 'number') ?
			`${fileTS}INDEX_EXT` : LATEST_INDEX;
		const ordered = await this.files.readJSONFile<MsgRecord[]>(fName)
		.catch(notFoundOrReThrow);
		if (!ordered) { return; }
		ordered.sort(sortMsgByDeliveryTime);
		const byId = new Map<string, MsgRecord>();
		for (const rec of ordered) {
			byId.set(rec.msgId, rec);
		}
		const records = { byId, ordered, fileTS: fileTS! };
		if (typeof fileTS === 'number') {
			this.cached.set(fileTS, records);
		}
		return records;
	}
	
	/**
	 * @param msgInfo is a minimal message info object
	 * @param decrInfo
	 * @return a promise, resolvable when given message info bits are recorded. 
	 */
	add(msgInfo: web3n.asmail.MsgInfo, decrInfo: MsgKeyInfo): Promise<void> {
		if (!decrInfo.key) { throw new Error(`Given message decryption info doesn't have a key for message ${msgInfo.msgId}`); }
		const msg: MsgRecord = {
			msgType: msgInfo.msgType,
			msgId: msgInfo.msgId,
			deliveryTS: msgInfo.deliveryTS,
			key: decrInfo.key,
			keyStatus: decrInfo.keyStatus,
			mainObjHeaderOfs: decrInfo.msgKeyPackLen
		};
		return this.fileProc.startOrChain(async () => {
			
			// 1) msg should be inserted into latest part of index
			if ((this.fileTSs.length === 0) ||
					(msg.deliveryTS >= this.fileTSs[this.fileTSs.length-1])) {
				insertInto(this.latest, msg);
				await this.saveRecords(this.latest);
				return;
			}
			
			// 2) find non-latest file for insertion
			let fileTS = this.fileTSs[this.fileTSs.length-1];
			for (let i=(this.fileTSs.length-2); i<=0; i-=1) {
				if (msg.deliveryTS >= this.fileTSs[i]) {
					break;
				} else {
					fileTS = this.fileTSs[i];
				}
			}
			const records = await this.getRecords(fileTS);
			if (!records) { throw new Error(`Expectation fail: there should be some message records.`); }
			insertInto(records, msg);
			await this.saveRecords(records);
		});
	}
	
	private async findRecordsWith(msg: MsgInfoWithoutType):
			Promise<MsgRecords|undefined> {
		// 1) msg should be in latest part of index
		if ((this.fileTSs.length === 0) ||
				(msg.deliveryTS >= this.fileTSs[this.fileTSs.length-1])) {
			if (!this.latest.byId.has(msg.msgId)) { return; }
			return this.latest;
		}
		
		// 2) find non-latest index
		let fileTS = this.fileTSs[this.fileTSs.length-1];
		for (let i=(this.fileTSs.length-2); i<=0; i-=1) {
			if (msg.deliveryTS >= this.fileTSs[i]) {
				let records = await this.getRecords(fileTS);
				if (!records || !records.byId.has(msg.msgId)) {
					if (msg.deliveryTS !== this.fileTSs[i]) { return; }
					fileTS = this.fileTSs[i];
					records = await this.getRecords(fileTS);
					if (!records || !records.byId.has(msg.msgId)) { return; }
				}
				return records;
			} else {
				fileTS = this.fileTSs[i];
			}
		}
		const records = await this.getRecords(this.fileTSs[0]);
		if (!records || !records.byId.has(msg.msgId)) { return; }
		return records;
	}
	
	/**
	 * @param msg is a message identifying info used to find and remove message
	 * @return a promise, resolvable when message is removed from this index.
	 */
	remove(msg: MsgInfoWithoutType): Promise<void> {
		return this.fileProc.startOrChain(async () => {
			const records = await this.findRecordsWith(msg);
			if (!records) { return; }
			removeFrom(records, msg.msgId);
			if ((records.fileTS !== null) && (records.ordered.length === 0)) {
				await this.files.deleteFile(records.fileTS+INDEX_EXT);
			} else {
				await this.saveRecords(records);
			}
		});
	}
	
	/**
	 * @param msg is an id of a message to remove
	 * @return a promise, resolvable when message is removed from this index.
	 */
	removeUsingIdOnly(msgId: string): Promise<void> {
		return this.fileProc.startOrChain(async () => {
			let records = this.latest;
			let msgFound = records.byId.has(msgId);
			const i = this.fileTSs.length-1;
			while (!msgFound && (i >= 0)) {
				records = (await this.getRecords(this.fileTSs[i]))!;
				msgFound = records.byId.has(msgId);
			}
			if (msgFound) {
				removeFrom(records, msgId);
				if (!!records.fileTS && (records.ordered.length === 0)) {
					await this.files.deleteFile(records.fileTS+INDEX_EXT);
				} else {
					await this.saveRecords(records);
				}
			}
		});
	}
	
	/**
	 * @param fromTS
	 * @return a promise, resolvable to an ordered array of MsgInfo's that have
	 * delivery timestamp same or later, than the given one.
	 */
	async listMsgs(fromTS: number|undefined): Promise<web3n.asmail.MsgInfo[]> {
		return this.fileProc.startOrChain(async () => {
			// find time starting point and get all records
			let list: web3n.asmail.MsgInfo[] = [];
			for (let i=0; i<this.fileTSs.length; i+=1) {
				if (fromTS && (fromTS > this.fileTSs[i])) { continue; }
				const recs = (await this.getRecords(this.fileTSs[i]))!;
				list = list.concat(recs.ordered);
			}
			list = list.concat(this.latest.ordered);
			// truncate records
			for (let i=0; i<list.length; i+=1) {
				if (fromTS && (fromTS >= list[i].deliveryTS)) {
					list = list.slice(i);
					break;
				}
			}
			reduceToMsgInfosInPlace(list);
			return list;
		});
	}
	
	/**
	 * This returns a promise resolvable to message's file key holder and key
	 * role, when message is found, and resolvabel to an undefined, when message
	 * is not known.
	 * @param msg is a message identifying info used to find message
	 */
	fKeyFor(msg: MsgInfoWithoutType): Promise<
			{ msgKey: Uint8Array; msgKeyRole: MsgKeyRole;
				mainObjHeaderOfs: number; }|undefined> {
		return this.fileProc.startOrChain(async () => {
			const records = await this.findRecordsWith(msg);
			if (!records) { return; }
			const rec = records.byId.get(msg.msgId);
			if (!rec) { return; }
			return {
				msgKey: base64.open(rec.key),
				msgKeyRole: rec.keyStatus,
				mainObjHeaderOfs: rec.mainObjHeaderOfs
			};
		});
	}
	
}
Object.freeze(MsgIndex.prototype);
Object.freeze(MsgIndex);

/**
 * This is a catch callback, which returns undefined on file(folder) not found
 * exception, and re-throws all other exceptions/errors.
 */
function notFoundOrReThrow(exc: FileException): undefined {
	if (!exc.notFound) { throw exc; }
	return;
}

function sortMsgByDeliveryTime(a: MsgInfoWithoutType,
		b: MsgInfoWithoutType): number {
	return (a.deliveryTS - b.deliveryTS);
}

Object.freeze(exports);