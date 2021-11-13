/*
 Copyright (C) 2020 3NSoft Inc.

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

import { parentPort, workerData } from 'worker_threads';
import { WorkerData } from './cryptor-in-worker';
import { join } from 'path';
import { startWasmFrom } from './wasm-mp1-modules';
import { readFileSync } from 'fs';

if (!parentPort) {
	throw new Error(`Missing expected parentPort. Is this called within WebWorker process?`);
}

const wasmFName = 'cryptor.wasm';
const wasmModPath = join((workerData as WorkerData).loadDir, wasmFName);
const wasmInstance = startWasmFrom(readFileSync(wasmModPath));

wasmInstance.setMsgListener(msg => parentPort!.postMessage(msg));

parentPort.on('message', (msg: Uint8Array) => {
	try {
		wasmInstance.sendMsgIntoWASM(msg);
	} catch (err) {
		console.error(err);
	}
});
