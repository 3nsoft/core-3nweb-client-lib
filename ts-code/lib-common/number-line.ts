/*
 Copyright (C) 2016 - 2017, 2026 3NSoft Inc.
 
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
 * This is a utility function that adds a number into given number line segments.
 * Each segment is represented by an array, in which 0-th element is the smallest number in the segment,
 * while 1-st element is the largest. Segments don't overlap and are ordered as they would on a number line:
 * segment with smaller numbers go first.
 * This returns true when segment line was updated, and false, otherwise (then number was in segments already).
 * @param segments 
 * @param n 
 */
export function addToNumberLineSegments(segments: number[][], n: number): boolean {

	for (let i=(segments.length-1); i>=0; i-=1) {
		const [ low, high ] = segments[i];

		if (high < n) {
			if ((high + 1) >= n) {
				// segment should be grown on a high side.
				// But now bigger segment won't merge with higher segment, cause if
				// it does, it would've merge from lower side of a higher segment.
				segments[i][1] = n;
			} else {
				// new segment should be added higher than this one
				segments.splice(i+1, 0, [ n, n ]);
			}
			return true;
		}

		if ((low <= n) && (n <= high)) {
			// do nothing as number falls into current segment
			return false;
		}

		if (low <= (n + 1)) {
			// segment should be grown on a lower side
			segments[i][0] = n;
			if ((i-1) >= 0) {
				// bigger segment may overlap with a lower one
				const lowerSeg = segments[i-1];
				if ((lowerSeg[1] + 1) >= n) {
					lowerSeg[1] = high;
					segments.splice(i, 1);
				}
			}
			return true;
		}
	}
	segments.unshift([ n, n ]);
	return true;
}

Object.freeze(exports);