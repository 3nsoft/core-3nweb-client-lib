/*
 Copyright (C) 2015 3NSoft Inc.
 
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

/**
 * This file contains functionality, used inside keyring.
 */

/**
 * This is a one-to-many, one way map from string ids to string emails in a
 * canonical form.
 */
export class IdToEmailMap {
	
	private idToEmail = new Map<string, string[]>();
	
	constructor() {
		Object.seal(this);
	}

	/**
	 * @param id
	 * @return undefined, if id is not known, or string with email, if there is
	 * one email registered for a given id, or an array of string emails, if
	 * more than one email registered for a given id. 
	 */
	getEmails(id: string): string[] | undefined {
		const emails = this.idToEmail.get(id);
		if (emails) { return emails.concat([]); }
		else { return; }	// undefined in explicit statement
	}

	/**
	 * @param id
	 * @param email
	 * @return true, if given id-email pair is successfully registered,
	 * and false, if such registration already existed.
	 */
	addPair(id: string, email: string): boolean {
		const emails = this.idToEmail.get(id);
		if (emails) {
			if (emails.includes(email)) { return false; }
			emails.push(email);
		} else {
			this.idToEmail.set(id, [ email ]);
		}
		return true;
	}
	
	/**
	 * @param ids is an array of string ids, associated with a given email
	 * @param email
	 */
	addPairs(ids: string[], email: string): void {
		for (let i=0; i < ids.length; i+=1) {
			this.addPair(ids[i], email);
		}
	}

	/**
	 * This removes given id-email pair.
	 * @param id
	 * @param email
	 * @return true, if pair was found and removed, and false, otherwise.
	 */
	removePair(id: string, email: string): boolean {
		let emails = this.idToEmail.get(id);
		if (!emails) { return false; }
		const emailInd = emails.indexOf(email);
		if (emailInd < 0) { return false; }
		emails = emails.splice(emailInd, 1);
		if (emails.length === 0) {
			this.idToEmail.delete(id);
		}
		return true;
	}
	
	removePairs(ids: string[], email: string): void {
		for (let i=0; i < ids.length; i+=1) {
			this.removePair(ids[i], email);
		}
	}
	
}
Object.freeze(IdToEmailMap);
Object.freeze(IdToEmailMap.prototype);

Object.freeze(exports);