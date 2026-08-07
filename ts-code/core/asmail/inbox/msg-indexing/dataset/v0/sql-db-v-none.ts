/*
 Copyright (C) 2026 3NSoft Inc.
 
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

import { objectFromQueryExecResult } from '../../../../../../lib-sqlite-on-3nstorage';
import { Database } from '../../../../../../lib-sqlite-on-3nstorage/sqljs';

export interface MsgIndexDbVNoneEntry {
	msg_id: string;
	msg_type: string;
	delivery_ts: number;
	key: Uint8Array;
	key_status: string;
	main_obj_header_ofs: number;
	remove_after: number;
}

export function getAllRecordsFromVersionNone(db: Database): MsgIndexDbVNoneEntry[] {
	const result = db.exec(
		`--sql
		SELECT * FROM inbox_index`
	)[0];
	return (result ? objectFromQueryExecResult<MsgIndexDbVNoneEntry>(result) : []);
}
