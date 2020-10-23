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

import { toCanonicalAddress, UserIdParseException } from "../../lib-common/canonical-address";

describe(`Function toCanonicalAddress`, () => {

	it(`creates canonical form of addresses`, () => {
		const asciiAddr = "a B c @xyz.com";
		expect(toCanonicalAddress(asciiAddr)).toBe("abc@xyz.com");
		const idnaAddr = "Никита Рязанский @мотыжено.рф";
		expect(toCanonicalAddress(idnaAddr)).toBe("никитарязанский@мотыжено.рф");
	});

	it(`throws on invalid domains`, () => {
		const badDomains = [
			"xy z .com", "xy#z.com", "x_yz.com", ""
		];
		for (const d of badDomains) {
			try {
				toCanonicalAddress(d);
				fail(`Above call should throw for domain ${d}`);
			} catch (exc) {
				expect((exc as UserIdParseException).address).toBe(d);
			}
		}
	});

});