/*
 Copyright (C) 2016 - 2018, 2020 3NSoft Inc.

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

/// <reference path="./asmail.d.ts" />
/// <reference path="./common-caps.d.ts" />
/// <reference path="./files.d.ts" />
/// <reference path="./mailerid.d.ts" />
/// <reference path="./startup.d.ts" />
/// <reference path="./storage.d.ts" />


declare namespace web3n {
	
	interface RuntimeException {
		runtimeException: true;
		type?: string;
		cause?: any;
		message?: string;
	}

	interface EncryptionException {
		failedCipherVerification?: true;
		failedSignatureVerification?: true;
	}

	interface AsyncIterator<T> {
		next(): Promise<IteratorResult<T>>;
	}

	interface Observer<T> {
		next?: (value: T) => void;
		error?: (err: any) => void;
		complete?: () => void;
	}

}
