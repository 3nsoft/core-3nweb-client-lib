/*
 Copyright (C) 2018 3NSoft Inc.
 
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

import { addToNumberLineSegments } from "../../core/asmail/delivery/common";
import { deepEqual } from "../../lib-common/json-utils";

describe(`Function addToNumberLineSegments`, () => {

	it(`inserts number to empty segments array`, () => {
		const segments = [];
		const n = 1;
		addToNumberLineSegments(segments, n);
		expect(deepEqual(segments, [ [n,n] ])).toBeTruthy();
	});

	it(`expands existing segment on lower side`, () => {
		let segments = [ [1,1], [4,4] ];
		addToNumberLineSegments(segments, 3);
		expect(deepEqual(segments, [ [1,1], [3,4] ])).toBeTruthy();
	});

	it(`expands existing segment on higher side`, () => {
		const segments = [ [1,1], [4,4] ];
		addToNumberLineSegments(segments, 2);
		expect(deepEqual(segments, [ [1,2], [4,4] ])).toBeTruthy();
	});

	it(`expands existing segment and merges it with an overlapping one`, () => {
		const segments = [ [1,2], [4,4] ];
		addToNumberLineSegments(segments, 3);
		expect(deepEqual(segments, [ [1,4] ])).toBeTruthy();
	});

	it(`changes nothing when number is already in an existing segment`, () => {
		const segments = [ [1,2], [4,4] ];
		addToNumberLineSegments(segments, 2);
		expect(deepEqual(segments, [ [1,2], [4,4] ])).toBeTruthy();
	});

	it(`adds new segment on a lower side`, () => {
		const segments = [ [4,6], [10,12] ];
		addToNumberLineSegments(segments, 2);
		expect(deepEqual(segments, [ [2,2], [4,6], [10,12] ])).toBeTruthy();
	});

	it(`adds new segment in the middle`, () => {
		const segments = [ [4,6], [10,12] ];
		addToNumberLineSegments(segments, 8);
		expect(deepEqual(segments, [ [4,6], [8,8], [10,12] ])).toBeTruthy();
	});

	it(`adds new segment on a higher side`, () => {
		const segments = [ [4,6], [10,12] ];
		addToNumberLineSegments(segments, 15);
		expect(deepEqual(segments, [ [4,6], [10,12], [15,15] ])).toBeTruthy();
	});

});