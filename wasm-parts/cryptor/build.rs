use std::io::Result;
use std::fs::{read_dir};

const PROTOS_DIR: &str = "./protos";

fn main() -> Result<()> {
	let proto_file_paths: Vec<_> = read_dir(PROTOS_DIR)?
	.filter_map(|res| {
		if res.is_ok() {
			res.ok()
		} else {
			eprintln!("Path Listing error: {}", res.err().unwrap());
			None
		}
	})
	.filter(|entry| {
		let f_type_res = entry.file_type();
		if f_type_res.is_ok() {
			f_type_res.ok().unwrap().is_file()
		} else {
			eprintln!("Path Listing error: {}", f_type_res.err().unwrap());
			false
		}
	})
	.map(|file_entry| file_entry.path())
	.collect();
	prost_build::compile_protos(&proto_file_paths, &[PROTOS_DIR])?;
	Ok(())
}
