
PROTOS_DIR="$1"

if [ ! -d "$PROTOS_DIR" ]
then
	echo "First argument, '$PROTOS_DIR', is not a folder"
	exit 1
fi

MOD_FILE="$PROTOS_DIR/../proto-defs.js"

PROTOS_OBJ="protos"

echo "exports.$PROTOS_OBJ = {};" > $MOD_FILE || exit $?

add_file_to_module () {
	local file_name=$1
	echo "exports.$PROTOS_OBJ['$file_name'] = \`" >> $MOD_FILE
	cat $PROTOS_DIR/$file_name >> $MOD_FILE
	echo "\`;" >> $MOD_FILE
}

for file in $(ls $PROTOS_DIR)
do
	add_file_to_module $file
done

echo "Object.freeze(exports.$PROTOS_OBJ);" >> $MOD_FILE
echo "Object.freeze(exports);" >> $MOD_FILE
