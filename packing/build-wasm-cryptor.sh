#!/bin/bash

rust_dir="wasm-parts/cryptor"
generated_wasm="$rust_dir/pkg/cryptor_bg.wasm"
wasm_dst_dir="build/lib-client/cryptor"
wasm_dst="$wasm_dst_dir/cryptor.wasm"
wasm_str_file="$wasm_dst_dir/cryptor-wasm.js"

echo "Building WASM cryptor"
wasm-pack build $rust_dir || exit $?

echo "Copying WASM module into folder with javascript"
mkdir -p $wasm_dst_dir
cp $generated_wasm $wasm_dst || exit $?

echo "Pack wasm binary into base64 static string"
node -e "
const wasm = fs.readFileSync('$wasm_dst').toString('base64');
console.log('exports.wasm = \"'+wasm+'\"; Object.freeze(exports);')
" > $wasm_str_file
