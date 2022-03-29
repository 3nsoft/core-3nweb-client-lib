#!/bin/bash

echo "Copying some TypeScript definitions to build folder"
api_build=build/api-defs
api_src=ts-code/api-defs
if [ ! -d $api_build ]
then
	mkdir -p $api_build || exit $?
fi
cp $api_src/* $api_build/ || exit $?
lib_def=build/lib-index.d.ts
new_lib_def=build/new-lib-index.d.ts
echo '/// <reference path="api-defs/web3n.d.ts" />' > $new_lib_def || exit $?
cat $lib_def >> $new_lib_def
rm $lib_def
mv $new_lib_def $lib_def
