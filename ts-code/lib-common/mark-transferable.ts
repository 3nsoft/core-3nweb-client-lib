/*
 Copyright (C) 2018 3NSoft Inc.
 
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

export type TransferableType = 'SimpleObject' | 'File' | 'FS' | 'FSCollection';

export interface Transferable {
	$_transferrable_type_id_$: TransferableType;
}

export function markTransferable<T extends object>(o: T,
		transferType: TransferableType): T {
	if ((o as any as Transferable).$_transferrable_type_id_$) {
		const currentType = (o as any as Transferable).$_transferrable_type_id_$;
		if (currentType === transferType) {
			return o;
		} else {
			throw new Error(`Given an object that is already marked as transferable with type ${currentType}, which is different from a desired type ${transferType}`);
		}
	}
	if (Object.isSealed(o)) { throw new Error(
		`Given a sealed object that can't be be marked as transferable`); }
	(o as any as Transferable).$_transferrable_type_id_$ = transferType;
	return o;
}

Object.freeze(exports);