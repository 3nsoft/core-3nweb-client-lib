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

import { ROFileLayout, RWFileLayout } from "../../lib-client/files/file-layout";

describe(`File layouts`, () => {

	it(`can be created readonly for trivial layout`, () => {
		// empty file
		let layout = ROFileLayout.orderedWithSize(0);
		expect(layout.contentSize).toBe(0);
		let sections = layout.getSectionsIn(0, undefined);
		expect(Array.isArray(sections)).toBeTruthy();
		expect(sections.length).toBe(0);
		// longer file
		const len = 1234;
		layout = ROFileLayout.orderedWithSize(len);
		expect(layout.contentSize).toBe(len);
		sections = layout.getSectionsIn(0, undefined);
		expect(Array.isArray(sections)).toBeTruthy();
		expect(sections.length).toBe(1);
		const s = sections[0];
		expect(s.ofsInSrc).toBe(0);
		expect(s.ofs).toBe(0);
		expect(s.len).toBe(len);
	});

	it(`can be created writable for trivial`, () => {
		// empty file
		let layout = RWFileLayout.orderedWithBaseSize(0);
		expect(layout.contentSize).toBe(0);
		let sections = layout.getSectionsIn(0, undefined);
		expect(Array.isArray(sections)).toBeTruthy();
		expect(sections.length).toBe(0);
		// longer file
		const len = 1234;
		layout = RWFileLayout.orderedWithBaseSize(len);
		expect(layout.contentSize).toBe(len);
		sections = layout.getSectionsIn(0, undefined);
		expect(Array.isArray(sections)).toBeTruthy();
		expect(sections.length).toBe(1);
		const s = sections[0];
		expect(s.ofsInSrc).toBe(0);
		expect(s.ofs).toBe(0);
		expect(s.len).toBe(len);
	});

	it(`can be changed`, () => {
		const layout = RWFileLayout.orderedWithBaseSize(100);

		// insert section
		const srcOfs1 = layout.insertSection(10, 10);
		expect(srcOfs1).toBe(100);
		expect(layout.contentSize).toBe(110);
		let sections = layout.getSectionsIn(0, undefined);
		expect(sections.length).toBe(3);
		expect(sections[0].ofs).toBe(0);
		expect(sections[0].len).toBe(10);
		expect(sections[0].ofsInSrc).toBe(0);
		expect(sections[1].ofs).toBe(10);
		expect(sections[1].len).toBe(10);
		expect(sections[1].ofsInSrc).toBe(srcOfs1);
		expect(sections[2].ofs).toBe(20);
		expect(sections[2].len).toBe(90);
		expect(sections[2].ofsInSrc).toBe(10);

		// insert section at the end with gaps
		const srcOfs2 = layout.insertSection(140, 10);
		expect(srcOfs2).toBe(110);
		expect(layout.contentSize).toBe(150);
		// insert into empty section
		const srcOfs3 = layout.insertSection(130, 10);
		expect(srcOfs3).toBe(120);
		expect(layout.contentSize).toBe(160);
		sections = layout.getSectionsIn(0, undefined);
		expect(sections.length).toBe(7);
		expect(sections[0].ofs).toBe(0);
		expect(sections[0].len).toBe(10);
		expect(sections[0].ofsInSrc).toBe(0);
		expect(sections[1].ofs).toBe(10);
		expect(sections[1].len).toBe(10);
		expect(sections[1].ofsInSrc).toBe(srcOfs1);
		expect(sections[2].ofs).toBe(20);
		expect(sections[2].len).toBe(90);
		expect(sections[2].ofsInSrc).toBe(10);
		expect(sections[3].ofs).toBe(110);
		expect(sections[3].len).toBe(20);
		expect(sections[3].ofsInSrc).toBeUndefined();
		expect(sections[4].ofs).toBe(130);
		expect(sections[4].len).toBe(10);
		expect(sections[4].ofsInSrc).toBe(srcOfs3);
		expect(sections[5].ofs).toBe(140);
		expect(sections[5].len).toBe(10);
		expect(sections[5].ofsInSrc).toBeUndefined();
		expect(sections[6].ofs).toBe(150);
		expect(sections[6].len).toBe(10);
		expect(sections[6].ofsInSrc).toBe(srcOfs2);

		// cut new sections with merge of uninitialized sections
		let cuts = layout.cutSection(114, 30);
		// note that new segments are not indicated to be cut from sink
		expect(cuts.length).toBe(0);
		expect(layout.contentSize).toBe(130);
		sections = layout.getSectionsIn(0, undefined);
		expect(sections.length).toBe(5);
		expect(sections[0].ofs).toBe(0);
		expect(sections[0].len).toBe(10);
		expect(sections[0].ofsInSrc).toBe(0);
		expect(sections[1].ofs).toBe(10);
		expect(sections[1].len).toBe(10);
		expect(sections[1].ofsInSrc).toBe(srcOfs1);
		expect(sections[2].ofs).toBe(20);
		expect(sections[2].len).toBe(90);
		expect(sections[2].ofsInSrc).toBe(10);
		expect(sections[3].ofs).toBe(110);
		expect(sections[3].len).toBe(10);
		expect(sections[3].ofsInSrc).toBeUndefined();
		expect(sections[4].ofs).toBe(120);
		expect(sections[4].len).toBe(10);
		expect(sections[4].ofsInSrc).toBe(srcOfs2);

		// cut base sections with merge of initialized sections
		cuts = layout.cutSection(20, 100);
		// note that base segments are indicated for removal from sink
		expect(cuts.length).toBe(1);
		expect(cuts[0].ofs).toBe(10);
		expect(cuts[0].len).toBe(90);
		expect(layout.contentSize).toBe(30);
		sections = layout.getSectionsIn(0, undefined);
		expect(sections.length).toBe(2);
		expect(sections[0].ofs).toBe(0);
		expect(sections[0].len).toBe(10);
		expect(sections[0].ofsInSrc).toBe(0);
		expect(sections[1].ofs).toBe(10);
		expect(sections[1].len).toBe(20);
		expect(sections[1].ofsInSrc).toBe(srcOfs1 - cuts[0].len);

		// cut tail
		cuts = layout.cutSection(6, 1000);
		// note again that only base sections are indicated for removal from sink
		expect(cuts.length).toBe(1);
		expect(cuts[0].ofs).toBe(6);
		expect(cuts[0].len).toBe(4);
		expect(layout.contentSize).toBe(6);
		sections = layout.getSectionsIn(0, undefined);
		expect(sections.length).toBe(1);
		expect(sections[0].ofs).toBe(0);
		expect(sections[0].len).toBe(6);
		expect(sections[0].ofsInSrc).toBe(0);

	});

	it(`packing`, () => {
		for (const len of [0, 1234]) {
			const layout = RWFileLayout.orderedWithBaseSize(len);
			// trivial layout is simple and completely occupies bytes in sink
			let bytes = layout.packIfNotTrivial(
				{ size: len, isEndless: false });
			expect(bytes).toBeUndefined();
			// layout is non-trivial if it not covers all bytes in sink
			bytes = layout.packIfNotTrivial({ size: len+1, isEndless: false });
			expect(bytes).not.toBeUndefined();
			bytes = layout.packIfNotTrivial({ size: len, isEndless: true });
			expect(bytes).not.toBeUndefined();
		}
	});

});