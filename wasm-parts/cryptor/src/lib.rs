// Copyright(c) 2021 3NSoft Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Lesser General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Lesser General Public License for more details.
//
// You should have received a copy of the GNU Lesser General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

mod pb;

use wasm_bindgen::prelude::*;
use wasm_message_passing_3nweb::wasm_mp1::{ send_msg_out, set_msg_processor };
use pb::cryptor::{ Request, Reply, Keypair, request, BytesVal, BoolVal, reply };
use prost::Message;
use prost::bytes::Bytes;
use nacl::{ secret_box as sbox, public_box as pbox, scrypt, sign, Error, ErrorCondition };

#[wasm_bindgen]
pub fn _start() -> () {
	set_msg_processor(&process_nacl_call);
}

fn process_nacl_call(msg: Vec<u8>) -> () {
	let req = match Request::decode(Bytes::from(msg)) {
		Ok(r) => r,
		Err(err) => {
			send_error(reply::Error {
				condition: "message-passing-error".to_string(),
				message: format!("{}", err)
			});
			return;
		}
	};

	let reply = match req.func {
		1 => {
			let request::ScryptArgs {
				passwd, salt, log_n, r, p, dk_len
			} = req.scrypt_args.unwrap();
			let progress_cb = |p: u32| send_msg_out(& pack_interim(vec!(p as u8)));
			scrypt(&passwd, &salt,
				log_n as u8, r as usize, p as usize, dk_len as usize, & progress_cb)
		},
		2 => pbox::calc_dhshared_key(arg(&req, 0), arg(&req, 1)),
		3 => pbox::generate_pubkey(arg(&req, 0)),
		4 => sbox::open(arg(&req, 0), arg(&req, 1), arg(&req, 2)),
		5 => sbox::pack(arg(&req, 0), arg(&req, 1), arg(&req, 2)),
		6 => sbox::format_wn::open(arg(&req, 0), arg(&req, 1)),
		7 => sbox::format_wn::pack(
			arg(&req, 0), arg(&req, 1), arg(&req, 2)),
		8 => {
			let sign::Keypair{ skey, pkey } =
				sign::generate_keypair(arg(&req, 0));
			let bytes = Keypair {
				skey: skey.to_vec(), pkey: pkey.to_vec()
			}.encode_to_vec();
			Ok(bytes)
		},
		9 => sign::signature(arg(&req, 0), arg(&req, 1)),
		10 => match sign::verify(
			arg(&req, 0), arg(&req, 1), arg(&req, 2)
		) {
			Ok(b) => Ok(BoolVal { val: b }.encode_to_vec()),
			Err(err) => Err(err)
		},
		fnum => {
			send_error(reply::Error {
				condition: "message-passing-error".to_string(),
				message: format!("Unrecognized func number {}", fnum)
			});
			return;
		}
	};

	let reply_msg = match reply {
		Ok(res) => pack_ok(res),
		Err(err) => pack_err(nacl_err_to_msg(err)),
	};

	send_msg_out(&reply_msg);
}

fn arg(req: &Request, i: usize) -> &[u8] {
	req.byte_args[i].val.as_slice()
}

fn pack_bytes(bytes: Vec<u8>) -> Option<BytesVal> {
	Some(BytesVal {
		val: bytes
	})
}

fn pack_ok(bytes: Vec<u8>) -> Vec<u8> {
	Reply {
		res: pack_bytes(bytes), interim: None, err: None
	}.encode_to_vec()
}

fn pack_interim(bytes: Vec<u8>) -> Vec<u8> {
	Reply {
		res: None, interim: pack_bytes(bytes), err: None
	}.encode_to_vec()
}

fn nacl_err_to_msg(err: Error) -> reply::Error {
	reply::Error {
		condition: match err.condition {
			ErrorCondition::CipherVerification => "cipher-verification",
			ErrorCondition::SignatureVerification => "signature-verification",
			ErrorCondition::Configuration => "configuration-error",
		}.to_string(),
		message: err.message,
	}
}

fn pack_err(err: reply::Error) -> Vec<u8> {
	Reply {
		res: None, interim: None, err: Some(err)
	}.encode_to_vec()
}

fn send_error(err: reply::Error) -> () {
	send_msg_out(& pack_err(err));
}
