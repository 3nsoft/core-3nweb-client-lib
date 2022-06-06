/*
 Copyright (C) 2016 - 2018, 2020 - 2022 3NSoft Inc.
 
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

import { stringifyErr } from "../../lib-common/exceptions/error";
import { callWithTimeout } from "../../lib-common/processes/timeout";

export function itCond(
	expectation: string, assertion?: () => Promise<void>, timeout?: number,
	setup?: { isUp: boolean; }
): void {
	if (assertion) {
		it(expectation, callbackFor(assertion, setup), timeout);
	} else {
		it(expectation);
	}
}

function callbackFor(
	assertion: () => Promise<void>, setup: { isUp: boolean; }|undefined
): () => Promise<void> {
	return async () => {
		if (setup && !setup.isUp) {
			fail(`Test setup is not up`);
		} else {
			try {
				await assertion();
			} catch (err) {
				if (typeof err === 'string') {
					fail(err);
				} else if ((err as web3n.RuntimeException).runtimeException) {
					fail(stringifyErr(err));
				} else {
					throw err;
				}
			}
		}
	}
}

export function xitCond(
	expectation: string, assertion?: () => Promise<void>, timeout?: number,
	setup?: { isUp: boolean; }
): void {
	if (assertion) {
		xit(expectation, callbackFor(assertion, setup), timeout);
	} else {
		xit(expectation);
	}
}

export function fitCond(
	expectation: string, assertion?: () => Promise<void>, timeout?: number,
	setup?: { isUp: boolean; }
): void {
	if (assertion) {
		fit(expectation, callbackFor(assertion, setup), timeout);
	} else {
		fit(expectation);
	}
}

export function beforeAllWithTimeoutLog(
	action: () => Promise<void>, timeout?: number
): void {
	beforeAll(callbackWithTimeout(action, true, timeout, 'beforeAll'), timeout);
}

const DEFAULT_TIMEOUT_INTERVAL = 5000;

function callbackWithTimeout(
	action: () => Promise<void>, throwIfErr: boolean, timeout: number|undefined,
	actionType: string
): () => Promise<void> {
	const millisToSleep = ((timeout === undefined) ?
		DEFAULT_TIMEOUT_INTERVAL : timeout);
	const timeoutErr = {};
	return async () => {
		try {
			await callWithTimeout(action, millisToSleep - 5, () => timeoutErr);
		} catch (err) {
			if (err === timeoutErr) {
				console.log(`\n>>> timeout in ${actionType}: action hasn't completed in ${millisToSleep - 5} milliseconds`);
			} else if (throwIfErr) {
				console.log(`\n>>> ${actionType} threw`, err);
				fail((err as web3n.RuntimeException).runtimeException ?
					stringifyErr(err) : err);
			}
		}
	};
}

export function beforeEachWithTimeoutLog(
	action: () => Promise<void>, timeout?: number
): void {
	beforeEach(callbackWithTimeout(
		action, true, timeout, 'beforeEach'), timeout);
}

// Adjust this static flag to hide/show errors thrown in afterXXX()
const throwErrorInAfter = false;

export function afterAllCond(
	action: () => Promise<void>, timeout?: number
): void {
	afterAll(callbackWithTimeout(
		action, throwErrorInAfter, timeout, 'afterAll'), timeout);
}

export function afterEachCond(
	action: () => Promise<void>, timeout?: number
): void {
	afterEach(callbackWithTimeout(
		action, throwErrorInAfter, timeout, 'afterEach'), timeout);
}

Object.freeze(exports);