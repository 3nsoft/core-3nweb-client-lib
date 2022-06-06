/*
 Copyright (C) 2015 - 2020, 2022 3NSoft Inc.
 
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

/**
 * Everything in this module is assumed to be inside of a file system
 * reliance set.
 */

import { AsyncSBoxCryptor, SegmentsWriter, makeSegmentsWriter, makeSegmentsReader, compareVectors, calculateNonce, makeDecryptedByteSource, Subscribe, ObjSource, makeEncryptingByteSink, ByteSink, ByteSource } from 'xsp-files';
import { base64 } from '../../../lib-common/buffer-utils';
import { defer } from '../../../lib-common/processes/deferred';
import * as random from '../../../lib-common/random-node';
import { CommonAttrs, XAttrs } from './attrs';
import * as pv1 from './xsp-payload-v1';
import * as pv2 from './xsp-payload-v2';

const SEG_SIZE = 16;	// in 256-byte blocks = 4K in bytes

const EMPTY_BYTE_ARR = new Uint8Array(0);

/**
 * This does reading and writing, keeping keys. This and extending objects are
 * used in file system nodes as thematic place with persistence functionality.
 */
export abstract class NodePersistance {

	protected constructor(
		private zerothHeaderNonce: Uint8Array,
		private key: Uint8Array,
		private cryptor: AsyncSBoxCryptor
	) {}
	
	wipe(): void {
		if (this.key) {
			this.key.fill(0);
			this.key = (undefined as any);
			this.zerothHeaderNonce.fill(0);
			this.zerothHeaderNonce = (undefined as any);
		}
	}

	compareKey(keyB64: string): boolean {
		const k = base64.open(keyB64);
		return compareVectors(k, this.key);
	}

	fileKeyInBase64(): string {
		if (!this.key) { throw new Error("Cannot use wiped object."); }
		return base64.pack(this.key);
	}

	private segWriter(version: number): Promise<SegmentsWriter> {
		if (!this.key) { throw new Error("Cannot use wiped object."); }
		return makeSegmentsWriter(
			this.key, this.zerothHeaderNonce, version,
			{ type: 'new', segSize: SEG_SIZE, payloadFormat: 2 },
			random.bytes, this.cryptor);
	}

	private async segWriterWithBase(
		newVersion: number, base: ObjSource
	): Promise<SegmentsWriter> {
		if (!this.key) { throw new Error("Cannot use wiped object."); }
		return makeSegmentsWriter(
			this.key, this.zerothHeaderNonce, newVersion,
			{ type: 'update', base, payloadFormat: 2 },
			random.bytes, this.cryptor);
	}

	private async decryptedByteSrc(src: ObjSource): Promise<{
		version: number; byteSrc: ByteSource; payloadFormat: number;
	}> {
		if (!this.key) { throw new Error("Cannot use wiped object."); }
		const version = src.version;
		const header = await src.readHeader();
		const segReader = await makeSegmentsReader(
			this.key, this.zerothHeaderNonce, version, header, this.cryptor)
		return {
			version,
			byteSrc: makeDecryptedByteSource(src.segSrc, segReader),
			payloadFormat: segReader.payloadFormat
		};
	}

	async readonlyPayload(src: ObjSource): Promise<ReadonlyPayload> {
		const { payloadFormat, byteSrc } = await this.decryptedByteSrc(src);
		if (payloadFormat === 2) {
			const payload = await pv2.makeReadonlyPayload(byteSrc);
			return payload;
		} else if (payloadFormat === 1) {
			return await pv1.makeReadonlyPayload(byteSrc);
		} else {
			throw new Error(`XSP segments payload format ${payloadFormat} is unknown`);
		}
	}

	protected async readAll(src: ObjSource): Promise<{
		content: Uint8Array|undefined; attrs: Attrs; xattrs?: XAttrs;
	}> {
		const payload = await this.readonlyPayload(src);
		return {
			content: await payload.readAllContent(),
			attrs: payload.getAttrs(),
			xattrs: await payload.getXAttrs(),
		};
	}

	private async writablePayload(
		sink: ByteSink, attrs?: CommonAttrs, base?: ObjSource
	): Promise<WritablePayload> {
		if (base) {
			const { byteSrc, version } = await this.decryptedByteSrc(base);
			return await pv2.makeWritablePayloadFromBase(sink, version, byteSrc);
		} else {
			return await pv2.makeWritablePayload(sink, attrs);
		}
	}

	protected async writeWhole(
		content: Uint8Array|Uint8Array[], newVersion: number,
		attrs?: CommonAttrs, xattrs?: XAttrs
	): Promise<Subscribe> {
		const bytes = (Array.isArray(content) ? content : [ content ]);
		const segWriter = await this.segWriter(newVersion);
		const { sink, sub } = makeEncryptingByteSink(segWriter);
		return (obs, backpressure) => {
			// sub must be called before payload creation that uses sink
			const unsub = sub(obs, backpressure);
			this.writablePayload(sink, attrs)
			.then(
				payload => payload.writeAllContent(bytes, xattrs),
				err => obs.error?.(err)
			);
			return unsub;
		};
	}

	async writeXAttrs(
		xattrs: XAttrs, newVersion: number, base: ObjSource
	): Promise<Subscribe> {
		const segWriter = await this.segWriterWithBase(newVersion, base);
		const { sink, sub } = makeEncryptingByteSink(segWriter);
		return (obs, backpressure) => {
			// sub must be called before payload creation that uses sink
			const unsub = sub(obs, backpressure);
			this.writablePayload(sink, undefined, base)
			.then(
				payload => payload.setXAttrs(xattrs),
				err => obs.error?.(err)
			);
			return unsub;
		};
	}

	protected async writableSink(
		newVersion: number, attrs?: CommonAttrs, xattrs?: XAttrs, base?: ObjSource
	): Promise<{ sinkPromise: Promise<FileByteSink>; sub: Subscribe; }> {
		const segWriter = await (base ?
			this.segWriterWithBase(newVersion, base) :
			this.segWriter(newVersion));
		const { sink, sub } = makeEncryptingByteSink(segWriter);
		const defSink = defer<FileByteSink>();
		return {
			sinkPromise: defSink.promise,
			sub: (obs, backpressure) => {
				try {
					// sub must be called before payload creation that uses sink
					const unsub = sub(obs, backpressure);
					this.writablePayload(sink, attrs, base)
					.then(payload => payload.makeFileByteSink(xattrs))
					.then(
						sink => defSink.resolve(sink),
						err => {
							if (obs.error) {
								obs.error(err);
							}
							defSink.reject(err);
						}
					);
					return unsub;
				} catch (err) {
					defSink.reject(err);
					obs.error?.(err);
					throw err;
				}
			}
		};
	}

	reencryptHeader = async (
		initHeader: Uint8Array, newVersion: number
	): Promise<Uint8Array> => {
		if (!this.key) { throw new Error("Cannot use wiped object."); }
		const headerContent = await this.cryptor.formatWN.open(
			initHeader, this.key);
		const n = calculateNonce(this.zerothHeaderNonce, newVersion);
		return this.cryptor.formatWN.pack(headerContent, n, this.key);
	};

}
Object.freeze(NodePersistance.prototype);
Object.freeze(NodePersistance);


type FileByteSource = web3n.files.FileByteSource;
type FileByteSink = web3n.files.FileByteSink;

export interface ReadonlyPayload {
	getAttrs(): Attrs;
	getXAttrs(): Promise<XAttrs>;
	readAllContent(): Promise<Uint8Array|undefined>;
	readSomeContentBytes(
		start: number, end: number
	): Promise<Uint8Array|undefined>;
	makeFileByteSource(): FileByteSource;
}

export interface Attrs {
	ctime: number;
	mtime: number;
	size: number;
	isEndless?: boolean;
}

export interface WritablePayload {
	setXAttrs(xattrs: XAttrs): Promise<void>;
	writeAllContent(bytes: Uint8Array[], xattrs?: XAttrs): Promise<void>;
	makeFileByteSink(xattrs?: XAttrs): Promise<FileByteSink>;
}

function noop() {}


Object.freeze(exports);