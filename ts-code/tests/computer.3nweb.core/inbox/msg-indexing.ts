/*
 Copyright 2022, 2026 3NSoft Inc.
 
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

import { makeMsgIndex, MsgIndex } from "../../../core/asmail/inbox/msg-indexing";
import { afterEachCond, beforeAllWithTimeoutLog, itCond } from "../../libs-for-tests/jasmine-utils";
import { setupWithUsers } from "../../libs-for-tests/setups";
import { makeSetupWithTwoDevsFSs } from "../test-utils";
import { base64 } from '../../../lib-common/buffer-utils';
import { bytesEqual } from "../../libs-for-tests/bytes-equal";
import { sleep } from "../../../lib-common/processes/sleep";
import { MsgKeyInfo } from "../../../core/keyring";

type MsgInfo = web3n.asmail.MsgInfo;

const msgs: { m: MsgInfo; k: MsgKeyInfo }[] = [
	{
		m:  {
			msgType: 'mail',
			msgId: 'F-vo1A4zInEBGq994-e3KvrE9a8QXLcr',
			deliveryTS: 1664923830399
		},
		k: {
			correspondent: 'johnmorrison@bank.com',
			keyStatus: 'published_intro',
			key: base64.open('0Uz7wGW4P7hdik7fuStC+avi7iXk7AZ5B1KxJCxIOQk='),
			msgKeyPackLen: 72
		}
	},
	{
		m: {
			msgType: 'mail',
			msgId: 'JYXfEEcg3-iX7UDjG3BU0Jha9DYX_Jt-',
			deliveryTS: 1664923830658
		},
		k: {
			correspondent: 'johnmorrison@bank.com',
			keyStatus: 'published_intro',
			key: base64.open('gjArW3Mr3ACnoFds/wKFZJm+pp9De1TlNhWIkpyd4Ow='),
			msgKeyPackLen: 72
		}
	},
	{
		m: {
			msgType: 'mail',
			msgId: 'BQ2HO6hs4-Kov1M4wxL8oeTw_UFlvI3G',
			deliveryTS: 1664923831175
		},
		k: {
			correspondent: 'johnmorrison@bank.com',
			keyStatus: 'published_intro',
			key: base64.open('lGr0hEGHMDrWa+QMEfmcsu/VPZbalN3gF+8LRi8Ai54='),
			msgKeyPackLen: 72
		}
	},
	{
		m: {
			msgType: 'mail',
			msgId: 'g5TWqqY11W32xv_ivoqGRsQmnEG1f3j0',
			deliveryTS: 1664923832168
		},
		k: {
			correspondent: 'johnmorrison@bank.com',
			keyStatus: 'published_intro',
			key: base64.open('8O/Ts2kZ37Y0yaSqGiRscYxPRQJu6cvfNXTgHKSNtyw='),
			msgKeyPackLen: 72
		}
	},
	{
		m: {
			msgId: 'some message id',
			deliveryTS: 1664923760381,
			msgType: 'mail'
		},
		k: {
			correspondent: 'bob@some.domain',
			keyStatus: 'introductory',
			msgKeyPackLen: 50,
			key: base64.open('sdafkjkljasfdsafjksadfkljasdf')
		}
	}
];

describe(`Inbox MsgIndex`, () => {

	const baseSetup = setupWithUsers();

	const testFolder = `inbox-indexing-test`;

	let dev1Index: MsgIndex;

	const {
		fsSetup: setup, setupDevsAndFSs
	} = makeSetupWithTwoDevsFSs(testFolder);

	beforeAllWithTimeoutLog(async () => {
		await setupDevsAndFSs(baseSetup);
	}, 20000);

	beforeEach(async () => {
		dev1Index = await makeMsgIndex(
			setup.dev1FS(), setup.dev1LocalFS(), async (err, msg) => console.error(msg, err)
		);
	});

	afterEachCond(async () => {
		if (!setup.isUp) { return; }
		dev1Index.stopSyncing();
		await setup.resetFS();
	});

	itCond(`is a container for message info`, async () => {
		const m0 = msgs[0];
		const m1 = msgs[1];

		let lst = await dev1Index.listMsgs(undefined);
		expect(Array.isArray(lst)).toBeTrue();
		expect(lst.length).toBe(0);

		await dev1Index.add(m0.m, m0.k);
		await dev1Index.add(m1.m, m1.k);
		const tsOfLast = m1.m.deliveryTS;

		lst = await dev1Index.listMsgs(undefined);
		expect(lst.length).toBe(2);

		lst = await dev1Index.listMsgs(tsOfLast);
		expect(lst.length).toBe(0);

		await dev1Index.remove(m0.m.msgId);

		lst = await dev1Index.listMsgs(undefined);
		expect(lst.length).toBe(1);

		let keyInfo = await dev1Index.getKeyFor(m1.m.msgId, m1.m.deliveryTS);
		expect(bytesEqual(keyInfo!.msgKey, m1.k.key!)).toBeTrue();

		// getting removed / non-existing message
		keyInfo = await dev1Index.getKeyFor(m0.m.msgId, m0.m.deliveryTS);
		expect(keyInfo).toBeUndefined();
	}, undefined, setup);

	itCond(`work with race conditions on different devices`, async () => {
		for (const m of msgs.slice(0, 2)) {
			await dev1Index.add(m.m, m.k);
		}
		// sleep to allow time for propagation to dev2
		await sleep(100);

		const dev2Index = await makeMsgIndex(
			setup.dev2FS(), setup.dev2LocalFS(), async (err, msg) => console.error(msg, err)
		);
		await sleep(100);
		let lst = await dev2Index.listMsgs(undefined);
		expect(lst.length).withContext(`messages at a start of 2nd device`).toBe(2);

		await dev1Index.add(msgs[2].m, msgs[2].k);
		await sleep(100);
		lst = await dev2Index.listMsgs(undefined);
		expect(lst.length).withContext(`added message on the 1st device should show up on the 2nd`).toBe(3);

		dev2Index.stopSyncing();
	}, 10000);

});