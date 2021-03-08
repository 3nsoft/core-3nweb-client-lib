#!/bin/bash

echo "Copying some TypeScript definitions to build folder"
api_build=build/api-defs
api_src=ts-code/api-defs
if [ ! -d $api_build ]
then
	mkdir $api_build || exit $?
fi
cp $api_src/* $api_build/ || exit $?
lib_def=build/lib-index.d.ts
new_lib_def=build/new-lib-index.d.ts
echo '/// <reference path="api-defs/web3n.d.ts" />' > $new_lib_def || exit $?
cat $lib_def >> $new_lib_def
rm $lib_def
mv $new_lib_def $lib_def

echo "Copying raw proto files"
dst_protos_dir="build/ipc-via-protobuf"
dst_protos="$dst_protos_dir/protos"
if [ -d $dst_protos ]
then
	rm -rf $dst_protos || exit $?
fi
cp -R protos $dst_protos_dir/ || exit $?

echo "Pack protos into module for those embedding cases that ignore proto files"
bash packing/pack-proto-to-module.sh build/ipc-via-protobuf/protos || exit $?