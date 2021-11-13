
const fs = require('fs');

const mod = new WebAssembly.Module(fs.readFileSync('./pkg/cryptor_bg.wasm'));

function msgFromWASM(ptr, len) {
	console.log(`Invoked _3nweb_mp1_send_out_msg(ptr = ${ptr}, len = ${len})`);
	const msgInBuf = new Uint8Array(instance.exports.memory.buffer, ptr, len);
	replyFromWasm = new Uint8Array(msgInBuf.length);
	replyFromWasm.set(msgInBuf);
	console.log(`Reply from WASM is`, replyFromWasm);
}

let replyFromWasm;

const imports = {
	env: {
		_3nweb_mp1_send_out_msg: msgFromWASM,
	}
};

const instance = new WebAssembly.Instance(mod, imports);
console.log(`WASM instance has following exports:`, instance.exports);

console.log(`\nStarting instance`);
instance.exports._start();

function test(msg) {
	console.log(`Sending message to WASM`);

	console.log(`Getting buffer for message length`, msg.length);

	let ptr = instance.exports._3nweb_mp1_get_buffer(msg.length);
	console.log(`Pointer is`, ptr);

	let buf = new Uint8Array(instance.exports.memory.buffer, ptr, msg.length);
	buf.set(msg);
	console.log(`Message is placed into buffer`, buf);

	console.log(`Telling WASM instance to process message`);
	instance.exports._3nweb_mp1_accept_msg(msg.length);
}

console.log(`\nTest 1`);
test(new Uint8Array([1,2,3,4,5,6,7,8,9,10]));
for (let i of [2,3,4]) {
	console.log(`\nTest ${i}`);
	test(replyFromWasm);
}
