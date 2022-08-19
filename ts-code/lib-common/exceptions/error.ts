/*
 Copyright (C) 2016 - 2017, 2020, 2022 3NSoft Inc.
 
 This program is free software: you can redistribute it and/or modify it under
 the terms of the GNU General Public License as published by the Free Software
 Foundation, either version 3 of the License, or (at your option) any later
 version.
 
 This program is distributed in the hope that it will be useful, but
 WITHOUT ANY WARRANTY; without even the implied warranty of
 MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 See the GNU General Public License for more details.
 
 You should have received a copy of the GNU General Public License along with
 this program. If not, see <http://www.gnu.org/licenses/>. */

export interface ErrorWithCause extends Error {
	cause: any;
}

type EncryptionException = web3n.EncryptionException;

export function errWithCause(cause: any, message: string): ErrorWithCause {
	const err = <ErrorWithCause> new Error(message);
	err.cause = cause;
	if ((cause as EncryptionException).failedCipherVerification) {
		(err as any as EncryptionException).failedCipherVerification = true;
	}
	return err;
}

export function recursiveErrJSONify(err: web3n.RuntimeException): any {
	if (!err || (typeof err !== 'object') || Array.isArray(err)) {
		return err;
	} else if (err.runtimeException) {
		if (err.cause) {
			err.cause = recursiveErrJSONify(err.cause);
		}
		return err;
	} else {
		const jsonErr: any = {
			message: err.message,
			stack: (err as any).stack
		};
		if (err.cause) {
			jsonErr.cause = recursiveErrJSONify(err.cause);
		}
		return jsonErr;
	}
}

export function stringifyErr(err: any): string {
	if (!err) { return ''; }

	let json = recursiveErrJSONify(err) as web3n.RuntimeException;
	let errStr: string;
	if (!json || (typeof json !== 'object') || err.runtimeException) {
		try {
			errStr = ((typeof json === 'string') ?
				json : `${JSON.stringify(json, null, '  ')}\n`);
		} catch (jsonErr) {
			errStr = `<report-error>${jsonErr.message}</report-error>\n`;
		}
	} else {
		errStr = `\nError message: ${json.message}\n`;
		if ((json as any).stack) {
			errStr +=  `Error stack: ${(json as any).stack}\n`;
		}
		if (json.cause) {
			try {
				let causeStr = ((typeof json.cause === 'string') ?
					json.cause : JSON.stringify(json.cause, null, '  '));
				errStr +=  `Caused by: ${causeStr}\n`;
			} catch (jsonErr) {
				errStr +=  `Caused by:\n<report-error>${jsonErr.message}</report-error>\n`;
			}
		}
	}
	return errStr.split('\\n').join('\n').split('\\\\').join('\\');
}

Object.freeze(exports);