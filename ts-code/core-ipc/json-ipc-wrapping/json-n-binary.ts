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

import { ProtoType } from '../../lib-client/protobuf-type';
import { copy as copyJSON } from '../../lib-common/json-utils';
import { json_ipc } from '../../protos/json-ipc.proto';

interface ValuesSequence {
	values: Value[];
}

interface Value {
	json?: string;
	binaryInJson?: BinaryValue[];
	transferredInJson?: TransferredObj[];
	arr?: BinaryValue;
	transferred?: TransferredObj;
}

interface BinaryValue {
	arr: Uint8Array;
	objLocation: string[];
}

interface TransferredObj {
	indexInPassed: number;
	objLocation: string[];
}

const valuesType = ProtoType.for<ValuesSequence>(json_ipc.ValuesSequence);

export function serializeArgs(
	args: any[]
): { bytes: Uint8Array; passedByReference?: any[]; } {
	const { seq, passedByReference } = argsToValuesSequence(args);
	return { bytes: valuesType.pack(seq), passedByReference };
}

function argsToValuesSequence(
	args: any[]
	): { seq: ValuesSequence; passedByReference?: any[]; } {
	const seq: ValuesSequence = { values: [] };
	const passedByReference: any[] = [];
	for (const arg of args) {
		if (arg && (typeof arg === 'object')) {
			if (ArrayBuffer.isView(arg)) {
				seq.values.push({
					arr: { arr: arg as Uint8Array, objLocation: [] }
				});
			} else if ((arg as ObjectFromCore)._isObjectFromCore) {
				const indexInPassed = addToArray(passedByReference, arg);
				seq.values.push({
					transferred: { indexInPassed, objLocation: [] }
				});
			} else {
				seq.values.push(turnToJsonExtractingBinaryAndTransferable(
					arg, passedByReference
				));
			}
		} else {
			seq.values.push({
				json: JSON.stringify(arg)
			});
		}
	}
	return {
		seq,
		passedByReference: ((passedByReference.length > 0) ?
			passedByReference : undefined
		)
	};
}

function addToArray(arr: Array<any>, o: any): number {
	let foundIndex = arr.indexOf(o);
	if (foundIndex < 0) {
		arr.push(o);
		return arr.length - 1;
	} else {
		return foundIndex;
	}
}

function turnToJsonExtractingBinaryAndTransferable<T extends object>(
	arg: T, passedByReference: any[]
): {
	json: string; binaryInJson?: BinaryValue[];
	transferredInJson?: TransferredObj[];
} {
	const parts = extractNonJsonableFrom(arg, passedByReference);
	if (parts) {
		const { copy, binaryInJson, transferredInJson } = parts;
		return {
			json: JSON.stringify(copy),
			binaryInJson: ((binaryInJson.length > 0) ? binaryInJson : undefined),
			transferredInJson: ((transferredInJson.length > 0) ?
				transferredInJson : undefined
			)
		};
	} else {
		return { json: JSON.stringify(arg) };
	}
}

function extractNonJsonableFrom<T extends object>(
	arg: T, passedByReference: any[]
): {
	copy: T; binaryInJson: BinaryValue[];
	transferredInJson: TransferredObj[];
}|undefined {
	const nonJsonLocations = findAllNonJsonable(arg);
	if (!nonJsonLocations) { return; }
	const copy = copyJSON(arg);
	const binaryInJson: BinaryValue[] = [];
	const transferredInJson: TransferredObj[] = [];
	for (const objLocation of nonJsonLocations) {
		const nonJson = getValueAtObjLocation(arg, objLocation);
		setNewValueAtObjLocation(copy, objLocation, null);
		if ((nonJson as ObjectFromCore)._isObjectFromCore) {
			const indexInPassed = addToArray(passedByReference, nonJson);
			transferredInJson.push({ indexInPassed, objLocation });
		} else {
			binaryInJson.push({ arr: nonJson, objLocation });
		}
	}
	return { copy, binaryInJson, transferredInJson };
}

interface ObjectFromCore {
	_isObjectFromCore: true;
}

function findAllNonJsonable(o: object): string[][]|undefined {
	const foundObjLocations: string[][] = [];
	if (ArrayBuffer.isView(o)
	|| (o as ObjectFromCore)._isObjectFromCore) {
		return [ [] ];
	}
	if (Array.isArray(o)) {
		for (let i=0; i<o.length; i+=1) {
			const child = o[i];
			if (child && (typeof child === 'object')) {
				const inChild = findAllNonJsonable(child);
				if (inChild) {
					for (const objLocation of inChild) {
						foundObjLocations.push([ `${i}`, ...objLocation ]);
					}
				}
			}
		}
	} else {
		for (const [ field, child ] of Object.entries(o)) {
			if (child && (typeof child === 'object')) {
				const inChild = findAllNonJsonable(child);
				if (inChild) {
					for (const objLocation of inChild) {
						foundObjLocations.push([ field, ...objLocation ]);
					}
				}
			}
		}
	}
	return ((foundObjLocations.length > 0) ? foundObjLocations : undefined);
}

function getValueAtObjLocation(o: object, objLocation: string[]): any {
	const value = (o as any)[objLocation[0]];
	if (objLocation.length > 1) {
		return getValueAtObjLocation(value, objLocation.slice(1));
	} else {
		return value;
	}
}

function setNewValueAtObjLocation(
	o: object, objLocation: string[], newValue: any
): void {
	const value = (o as any)[objLocation[0]];
	if (objLocation.length > 1) {
		setNewValueAtObjLocation(value, objLocation.slice(1), newValue);
	} else {
		(o as any)[objLocation[0]] = newValue;
	}
}

function getInitAndSetNewValueAt(
	o: object, objLocation: string[], newValue: any
): any {
	const value = (o as any)[objLocation[0]];
	if (objLocation.length > 1) {
		return getInitAndSetNewValueAt(value, objLocation.slice(1), newValue);
	} else {
		(o as any)[objLocation[0]] = newValue;
		return value;
	}
}

export function deserializeArgs(
	bytes: Uint8Array, passedByReference: any[]|undefined
): any[] {
	const values = valuesType.unpack(bytes as Buffer);
	const args: any[] = [];
	for (const val of values.values) {
		const {
			json, binaryInJson, transferredInJson, arr, transferred
		} = val;
		if (arr) {
			args.push(arr.arr);
		} else if (transferred) {
			args.push(getTransferred(
				transferred.indexInPassed, passedByReference
			));
		} else if ((typeof json === 'string') && (json.length > 0)) {
			const arg = JSON.parse(json);
			if (binaryInJson) {
				attachBinaryArrays(arg, binaryInJson);
			}
			if (transferredInJson) {
				attachTransferred(arg, transferredInJson, passedByReference);
			}
			args.push(arg);
		} else {
			args.push(undefined);
		}
	}
	return args;
}

function attachBinaryArrays<T extends object>(
	arg: T, binaryInJson: BinaryValue[]
): void {
	for (const { arr, objLocation } of binaryInJson) {
		setNewValueAtObjLocation(arg, objLocation, arr);
	}
}

function getTransferred(
	indexInPassed: number, passedByReference: any[]|undefined
): any {
	if (!passedByReference) {
		// XXX throw error here
		throw new Error(`need better error`);
	}
	const o = passedByReference[indexInPassed];
	if (!o || !(o as ObjectFromCore)._isObjectFromCore) {
		// XXX throw error here
		throw new Error(`need better error`);
	}
	return o;
}

function attachTransferred<T extends object>(
	arg: T, transferredInJson: TransferredObj[],
	passedByReference: any[]|undefined
): void {
	for (const { indexInPassed, objLocation } of transferredInJson) {
		setNewValueAtObjLocation(arg, objLocation, getTransferred(
			indexInPassed, passedByReference
		));
	}
}
