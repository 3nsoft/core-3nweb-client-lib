/*
 Copyright (C) 2017 - 2021 3NSoft Inc.

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

import { stringifyErr } from '../../lib-common/exceptions/error';
import { SingleProc } from '../../lib-common/processes';
import { appendFile, ensureFolderExists, FileException } from '../../lib-common/async-fs-node';
import { join, dirname } from 'path';

export const LOGS_FOLDER = 'logs';

function logFileName(now: Date, appDomain?: string): string {
	const dateStr = now.toISOString().slice(0, 10);
	return (appDomain ?
		`${dateStr}.${appDomain}.log.txt` :
		`${dateStr}.log.txt`);
}

let version: string;
function getCurrentCoreVersion(): string {
	if (typeof version !== 'string') {
		try {
			const packInfo = require('../../../package.json');
			if ( typeof packInfo.version === 'string') {
				version = packInfo.version;
			} else {
				version = 'unspecified';
			}
		} catch (err) {
			version = 'unspecified';
		}
	}
	return version;
}

export function makeLogger(utilDir: string) {

	async function logError(err: any, msg?: string): Promise<void> {
		try {
			const now = new Date();
			const entry = `
${now} ==================================
Core version ${getCurrentCoreVersion()}
Log level: error.${msg ? `
${msg}` : ''}
${stringifyErr(err)}`;
			await appendLog(entry, now);
		} catch (err2) {
			console.error(err);
			console.error(err2);
		}
	}
	
	const loggingProc = new SingleProc();
	
	function appendLog(s: string, now: Date, appDomain?: string): Promise<void> {
		return loggingProc.startOrChain(async () => {
			const logFile = join(
				utilDir, LOGS_FOLDER, logFileName(now, appDomain));
			try {
				await appendFile(logFile, s, { encoding: 'utf8' });
			} catch (exc) {
				if (!(exc as FileException).notFound) { throw exc; }
				await ensureFolderExists(dirname(logFile));
				await appendFile(logFile, s, { encoding: 'utf8' });
			}
		});
	}
	
	async function logWarning(msg: string, err?: any): Promise<void> {
		try {
			const now = new Date();
			const entry = `
${now} ==================================
Core version ${getCurrentCoreVersion()}
Log level: warning.
${msg}
${err ? stringifyErr(err) : ''}`;
			await appendLog(entry, now);
		} catch (err2) {
			console.warn(msg);
			if (err) {
				console.warn(err);
			}
			console.error(err2);
		}
	}
	
	async function appLog(
		type: 'error'|'info'|'warning', appDomain: string, msg: string, err?: any
	): Promise<void> {
		try {
			const now = new Date();
			const entry = `
${now} ==================================
App ${appDomain}, running on core version ${getCurrentCoreVersion()}
Log level: ${type}.${msg ? `
${msg}` : ''}
${stringifyErr(err)}`;
			await appendLog(entry, now, appDomain);
		} catch (err2) {
			console.error(err2);
		}
	
	}
	
	function recordUnhandledRejectionsInProcess(): void {
		const unhandlePromiseRejectionLogWait = 200;
		const unhandledRejections = new Map<Promise<any>, any>();
		process.on('unhandledRejection', (reason, p) => {
			unhandledRejections.set(p, reason);
			setTimeout(() => {
				if (!unhandledRejections.has(p)) { return; }
				unhandledRejections.delete(p);
				logError(reason, `Unhandled exception in promise (logged after ${unhandlePromiseRejectionLogWait} milliseconds wait)`).catch(noop);
			}, unhandlePromiseRejectionLogWait).unref();
		});
		process.on('rejectionHandled', p => unhandledRejections.delete(p));
		process.on('uncaughtException', err => {
			logError(err, 'Unhandled exception');
		});
	}
	
	return Object.freeze({
		logError, logWarning, appLog, recordUnhandledRejectionsInProcess
	});
}

export type Logger = ReturnType<typeof makeLogger>;

export type LogError = Logger['logError'];

export type LogWarning = Logger['logWarning'];

export type AppLog = Logger['appLog'];

function noop () {}


Object.freeze(exports);