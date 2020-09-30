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

import { ProtoType, ObjectReference, fixInt, errFromMsg, ErrorValue, errToMsg, Value, valOfOpt, toOptVal, fixArray, valOfOptInt, packInt, unpackInt } from './protobuf-msg';
import { ExposedFn, ObjectsConnector, ExposedObj, checkRefObjTypeIs } from './connector';
import { join, resolve } from 'path';

type FileByteSink = web3n.files.FileByteSink;
type FileLayout = web3n.files.FileLayout;
type LayoutSection = web3n.files.LayoutSection;
type FileByteSource = web3n.files.FileByteSource;

export function makeSinkCaller(
	connector: ObjectsConnector, ref: ObjectReference
): FileByteSink {
	checkRefObjTypeIs('FileByteSink', ref);
	const objPath = ref.path;
	const sink: FileByteSink = {
		done: sinkDone.makeCaller(connector, objPath),
		getSize: sinkGetSize.makeCaller(connector, objPath),
		showLayout: sinkShowLayout.makeCaller(connector, objPath),
		splice: sinkSplice.makeCaller(connector, objPath),
		truncate: sinkTruncate.makeCaller(connector, objPath)
	};
	connector.registerClientDrop(sink, ref);
	return sink;
}

export function exposeSinkService(
	sink: FileByteSink, connector: ObjectsConnector
): ObjectReference {
	const wrap: ExposedObj<FileByteSink> = {
		done: sinkDone.wrapService(sink.done),
		getSize: sinkGetSize.wrapService(sink.getSize),
		showLayout: sinkShowLayout.wrapService(sink.showLayout),
		splice: sinkSplice.wrapService(sink.splice),
		truncate: sinkTruncate.wrapService(sink.truncate)
	};
	const ref = connector.exposedObjs.exposeDroppableService(
		'FileByteSink', wrap, sink);
	return ref;
}

export function makeSrcCaller(
	connector: ObjectsConnector, ref: ObjectReference
): FileByteSource {
	checkRefObjTypeIs('FileByteSource', ref);
	const objPath = ref.path;
	const src: FileByteSource = {
		getPosition: srcGetPosition.makeCaller(connector, objPath),
		getSize: srcGetSize.makeCaller(connector, objPath),
		read: srcRead.makeCaller(connector, objPath),
		seek: srcSeek.makeCaller(connector, objPath)
	};
	connector.registerClientDrop(src, ref);
	return src;
}

export function exposeSrcService(
	src: FileByteSource, connector: ObjectsConnector
): ObjectReference {
	const wrap: ExposedObj<FileByteSource> = {
		getPosition: srcGetPosition.wrapService(src.getPosition),
		getSize: srcGetSize.wrapService(src.getSize),
		read: srcRead.wrapService(src.read),
		seek: srcSeek.wrapService(src.seek)
	};
	const ref = connector.exposedObjs.exposeDroppableService(
		'FileByteSource', wrap, src);
	return ref;
}

const bytesProtos = join(resolve(__dirname, '../../protos'), 'bytes.proto');
function bytesType<T extends object>(type: string): ProtoType<T> {
	return ProtoType.makeFrom<T>(bytesProtos, `bytes.${type}`);
}


namespace sinkGetSize {

	export function wrapService(fn: FileByteSink['getSize']): ExposedFn {
		return () => {
			const promise = fn()
			.then(packInt);
			return { promise };
		};
	}

	export function makeCaller(
		connector: ObjectsConnector, objPath: string[]
	): FileByteSink['getSize'] {
		const path = objPath.concat('getSize');
		return () => connector
		.startPromiseCall(path, undefined)
		.then(unpackInt);
	}

}
Object.freeze(sinkGetSize);


namespace sinkSplice {

	interface Request {
		pos: number;
		del: number;
		bytes?: Value<Buffer>;
	}

	const requestType = bytesType<Request>('SpliceRequestBody');

	export function wrapService(fn: FileByteSink['splice']): ExposedFn {
		return buf => {
			const { pos, del, bytes } = requestType.unpack(buf);
			const promise = fn(fixInt(pos), fixInt(del), valOfOpt(bytes));
			return { promise };
		};
	}

	export function makeCaller(
		connector: ObjectsConnector, objPath: string[]
	): FileByteSink['splice'] {
		const path = objPath.concat('splice');
		return async (pos, del, bytes) => {
			await connector
			.startPromiseCall(path, requestType.pack({
				pos, del, bytes: toOptVal(bytes as Buffer)
			}));
		}
	}

}
Object.freeze(sinkSplice);


namespace sinkTruncate {

	interface Request {
		size: number;
	}

	const requestType = bytesType<Request>('TruncateRequestBody');

	export function wrapService(fn: FileByteSink['truncate']): ExposedFn {
		return buf => {
			const { size } = requestType.unpack(buf);
			const promise = fn(fixInt(size));
			return { promise };
		};
	}

	export function makeCaller(
		connector: ObjectsConnector, objPath: string[]
	): FileByteSink['truncate'] {
		const path = objPath.concat('truncate');
		return async (size) => {
			await connector
			.startPromiseCall(path, requestType.pack({ size }));
		}
	}

}
Object.freeze(sinkTruncate);


namespace sinkShowLayout {

	interface FileLayoutMsg {
		base?: Value<number>;
		sections: LayoutSection[];
	}

	const replyType = bytesType<FileLayoutMsg>('FileLayoutMsg');

	function packLayout(l: FileLayout): FileLayoutMsg {
		return {
			base: toOptVal(l.base),
			sections: l.sections
		};
	}

	function unpackLayout(msg: FileLayoutMsg): FileLayout {
		return {
			base: valOfOpt(msg.base),
			sections: fixArray(msg.sections).map(({ src, ofs, len }) => ({
				src, ofs: fixInt(ofs), len: fixInt(len) }))
		};
	}

	export function wrapService(fn: FileByteSink['showLayout']): ExposedFn {
		return () => {
			const promise = fn()
			.then(layout => replyType.pack(packLayout(layout)));
			return { promise };
		};
	}

	export function makeCaller(
		connector: ObjectsConnector, objPath: string[]
	): FileByteSink['showLayout'] {
		const path = objPath.concat('showLayout');
		return () => connector
		.startPromiseCall(path, undefined)
		.then(buf => unpackLayout(replyType.unpack(buf)));
	}

}
Object.freeze(sinkShowLayout);


namespace sinkDone {

	interface Request {
		err?: ErrorValue;
	}

	const requestType = bytesType<Request>('DoneRequestBody');

	export function wrapService(fn: FileByteSink['done']): ExposedFn {
		return buf => {
			const { err } = requestType.unpack(buf);
			const promise = (err ? fn(errFromMsg(err)) : fn());
			return { promise };
		};
	}

	export function makeCaller(
		connector: ObjectsConnector, objPath: string[]
	): FileByteSink['done'] {
		const path = objPath.concat('done');
		return async (err) => {
			const req: Request = (err ? { err: errToMsg(err) } : {});
			await connector
			.startPromiseCall(path, requestType.pack(req));
		}
	}

}
Object.freeze(sinkDone);


namespace srcGetSize {

	export function wrapService(fn: FileByteSource['getSize']): ExposedFn {
		return () => {
			const promise = fn()
			.then(packInt);
			return { promise };
		};
	}

	export function makeCaller(
		connector: ObjectsConnector, objPath: string[]
	): FileByteSource['getSize'] {
		const path = objPath.concat('getSize');
		return () => connector
		.startPromiseCall(path, undefined)
		.then(unpackInt);
	}

}
Object.freeze(srcGetSize);


namespace srcGetPosition {

	export function wrapService(fn: FileByteSource['getPosition']): ExposedFn {
		return () => {
			const promise = fn()
			.then(packInt);
			return { promise };
		};
	}

	export function makeCaller(
		connector: ObjectsConnector, objPath: string[]
	): FileByteSource['getPosition'] {
		const path = objPath.concat('getPosition');
		return () => connector
		.startPromiseCall(path, undefined)
		.then(unpackInt);
	}

}
Object.freeze(srcGetPosition);


namespace srcRead {

	interface Request {
		len?: Value<number>;
	}

	interface Reply {
		bytes?: Value<Uint8Array>;
	}

	const requestType = bytesType<Request>('ReadRequestBody');

	const replyType = bytesType<Reply>('ReadReplyBody');

	export function wrapService(fn: FileByteSource['read']): ExposedFn {
		return buf => {
			const { len } = requestType.unpack(buf);
			const promise = fn(valOfOptInt(len))
			.then(bytes => replyType.pack({ bytes: toOptVal(bytes) }));
			return { promise };
		};
	}

	export function makeCaller(
		connector: ObjectsConnector, objPath: string[]
	): FileByteSource['read'] {
		const path = objPath.concat('read');
		return len => connector
		.startPromiseCall(path, requestType.pack({ len: toOptVal(len) }))
		.then(buf => valOfOpt(replyType.unpack(buf).bytes));
	}

}
Object.freeze(srcRead);


namespace srcSeek {

	interface Request {
		offset: number;
	}

	const requestType = bytesType<Request>('SeekRequestBody');

	export function wrapService(fn: FileByteSource['seek']): ExposedFn {
		return buf => {
			const { offset } = requestType.unpack(buf);
			const promise = fn(fixInt(offset));
			return { promise };
		};
	}

	export function makeCaller(
		connector: ObjectsConnector, objPath: string[]
	): FileByteSource['seek'] {
		const path = objPath.concat('seek');
		return async offset => {
			await connector
			.startPromiseCall(path, requestType.pack({ offset }));
		}
	}

}
Object.freeze(srcSeek);


Object.freeze(exports);