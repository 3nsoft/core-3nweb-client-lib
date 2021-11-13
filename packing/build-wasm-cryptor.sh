#!/bin/bash

rust_dir="wasm-parts/cryptor"
generated_wasm="$rust_dir/pkg/cryptor_bg.wasm"
wasm_dst_dir="build/lib-client/cryptor"
wasm_dst="$wasm_dst_dir/cryptor.wasm"
wasm_str_file="$wasm_dst_dir/cryptor-wasm.js"
src_protos="$rust_dir/protos"
dst_protos="$wasm_dst_dir/protos"

echo "Building WASM cryptor"
wasm-pack build $rust_dir || exit $?

echo "Copying WASM module into folder with javascript"
mkdir -p $wasm_dst_dir
cp $generated_wasm $wasm_dst || exit $?

echo "Copying raw proto files"
mkdir -p $dst_protos
cp $src_protos/* $dst_protos/ || exit $?

echo "Pack protos into module for those embedding cases that ignore proto files"
bash packing/pack-proto-to-module.sh $dst_protos || exit $?

echo "Pack wasm binary into base64 static string"
node -e "
const wasm = fs.readFileSync('$wasm_dst').toString('base64');
console.log('exports.wasm = \"'+wasm+'\"; Object.freeze(exports);')
" > $wasm_str_file
