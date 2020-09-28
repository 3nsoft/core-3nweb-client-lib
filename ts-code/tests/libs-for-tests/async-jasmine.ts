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
 this program. If not, see <http://www.gnu.org/licenses/>. */

import { callWithTimeout } from "../../lib-common/processes";

export function itAsync(
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
): (done: DoneFn) => void {
	return done => {
		if (setup && !setup.isUp) {
			done.fail(`Test setup is not up`);
		} else {
			assertion().then(() => done(), err => done.fail(err));
		}
	}
}

export function xitAsync(
	expectation: string, assertion?: () => Promise<void>, timeout?: number,
	setup?: { isUp: boolean; }
): void {
	if (assertion) {
		xit(expectation, callbackFor(assertion, setup), timeout);
	} else {
		xit(expectation);
	}
}

export function fitAsync(
	expectation: string, assertion?: () => Promise<void>, timeout?: number,
	setup?: { isUp: boolean; }
): void {
	if (assertion) {
		fit(expectation, callbackFor(assertion, setup), timeout);
	} else {
		fit(expectation);
	}
}

export function beforeAllAsync(
	action: () => Promise<void>, timeout?: number
): void {
	beforeAll(callbackWithTimeout(action, true, timeout, 'beforeAll'), timeout);
}

const DEFAULT_TIMEOUT_INTERVAL = 5000;

function callbackWithTimeout(
	action: () => Promise<void>, throwIfErr: boolean, timeout: number|undefined,
	actionType: string
): ImplementationCallback {
	const millisToSleep = ((timeout === undefined) ?
		DEFAULT_TIMEOUT_INTERVAL : timeout);
	const timeoutErr = {};
	return async done => {
		try {
			await callWithTimeout(action, millisToSleep - 5, () => timeoutErr);
			done();
		} catch (err) {
			if (err === timeoutErr) {
				console.log(`\n>>> timeout in ${actionType}: action hasn't completed in ${millisToSleep - 5} milliseconds`);
				done();
			} else if (throwIfErr) {
				done.fail(err);
			} else {
				done();
			}
		}
	};
}

export function beforeEachAsync(
	action: () => Promise<void>, timeout?: number
): void {
	beforeEach(callbackWithTimeout(
		action, true, timeout, 'beforeEach'), timeout);
}

// Adjust this static flag to hide/show errors thrown in afterXXX()
const throwErrorInAfter = false;

export function afterAllAsync(
	action: () => Promise<void>, timeout?: number
): void {
	afterAll(callbackWithTimeout(
		action, throwErrorInAfter, timeout, 'afterAll'), timeout);
}

export function afterEachAsync(
	action: () => Promise<void>, timeout?: number
): void {
	afterEach(callbackWithTimeout(
		action, throwErrorInAfter, timeout, 'afterEach'), timeout);
}

Object.freeze(exports);