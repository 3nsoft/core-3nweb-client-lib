/*
 Copyright (C) 2021 3NSoft Inc.

 This program is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.

 This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for more details.

 You should have received a copy of the GNU General Public License along with this program. If not, see <http://www.gnu.org/licenses/>.
*/

export interface WasmInstance {
	setMsgListener: (listener: (msg: Uint8Array) => void) => void;
	sendMsgIntoWASM: (msg: Uint8Array) => void;
}

type ExportFn = '_3nweb_mp1_accept_msg' | '_start';

type ImportedEnv = {
	_3nweb_mp1_send_out_msg: (ptr: number, len: number) => void;
	_3nweb_mp1_write_msg_into: (ptr: number) => void;
};


class MP1 {

	private readonly instance: WebAssembly.Instance;
	private readonly mp1_accept_msg: (len: number) => void;
	private sinkMsgFromWasmInstance:
		((msg: Uint8Array) => void)|undefined = undefined;
	private msgWaitingWriteCB: Uint8Array|undefined = undefined;

	constructor(
		wasmBytes: Uint8Array,
	) {
		const module = new WebAssembly.Module(wasmBytes as Uint8Array<ArrayBuffer>);
		this.instance = new WebAssembly.Instance(module, this.makeImports());
		this.mp1_accept_msg = this.getExportedFn('_3nweb_mp1_accept_msg');
		Object.seal(this);
	}

	private getExportedFn<F extends Function>(fName: ExportFn): F {
		const fn = this.instance.exports[fName];
		if (typeof fn !== 'function') {
			throw Error(`WASM instance doesn't export function ${fName}`);
		}
		return fn as F;
	}
	
	private makeImports(): WebAssembly.Imports {
		const env: ImportedEnv = {

			_3nweb_mp1_send_out_msg:
				(ptr, len) => this.processMsgFromModule(ptr, len),

			_3nweb_mp1_write_msg_into: (ptr) => this.writeMsgInCB(ptr),

		};
		return { env };
	}

	private processMsgFromModule(ptr: number, len: number): void {
		if (!this.sinkMsgFromWasmInstance) { return; }
		const msgBuf = this.getWasmMemoryArea(ptr, len);
		const msg = new Uint8Array(msgBuf.length);
		msg.set(msgBuf);
		this.sinkMsgFromWasmInstance(msg);
	}

	private writeMsgInCB(ptr: number): void {
		const buf = this.getWasmMemoryArea(ptr, this.msgWaitingWriteCB!.length);
		buf.set(this.msgWaitingWriteCB!);
		this.msgWaitingWriteCB = undefined;
	}

	private getWasmMemoryArea(ptr: number, len: number): Uint8Array {
		const memBuf = (this.instance.exports.memory as
			WebAssembly.Memory).buffer;
		return new Uint8Array(memBuf, ptr, len);
	}

	start(): void {
		this.getExportedFn('_start')();
	}

	sendMsg(msg: Uint8Array): void {
		this.msgWaitingWriteCB = msg;
		// Note that following call to WASM expects it to call back imported
		// function that actually copies bytes from this.msgWaitingWriteCB into
		// then given memory area.
		this.mp1_accept_msg(msg.length);
	}

	setMsgListener(listener: (msg: Uint8Array) => void): void {
		this.sinkMsgFromWasmInstance = listener;
	}

}
Object.freeze(MP1.prototype);
Object.freeze(MP1);


export function startWasmFrom(wasmModuleBytes: Uint8Array): WasmInstance {
	let mp1 = new MP1(wasmModuleBytes);
	mp1.start();
	return {
		sendMsgIntoWASM: msg => mp1.sendMsg(msg),
		setMsgListener: listener => mp1.setMsgListener(listener)
	};
}


Object.freeze(exports);