/*
 Copyright (C) 2016 - 2018, 2020, 2025 3NSoft Inc.
 
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

import { SpecDescribe } from '../../../libs-for-tests/spec-module';
import { stringOfB64CharsSync } from '../../../../lib-common/random-node';
import { sendTxtMsg, SpecIt, throwDeliveryErrorFrom } from '../test-utils';
import { makeContinuousSink } from '../../../../lib-common/obj-streaming/sink-utils';
import { sleep } from '../../../../lib-common/processes/sleep';
import { User } from '../../../libs-for-tests/core-runner';
import { bytes as randomBytes } from '../../../../lib-common/random-node';

type WritableFS = web3n.files.WritableFS;
type ReadonlyFS = web3n.files.ReadonlyFS;
type File = web3n.files.File;

interface FileParams {
	name: string;
	content: string;
}

interface FolderParams {
	name: string;
	files: FileParams[];
	folders: FolderParams[];
}

const files: FileParams[] = [{
	content: 'This is file content for file #1',
	name: 'file1'
}, {
	content: 'Content for file #2 (longer file)\n'+stringOfB64CharsSync(100000),
	name: 'file2'
}];
const folder: FolderParams = {
	name: 'parent folder',
	files: [ files[0] ],
	folders: [ {
		name: 'child folder 1',
		files: [ files[0] ],
		folders: []
	}, {
		name: 'child folder 2',
		files: [ files[1] ],
		folders: []
	} ]
};

type DeliveryProgress = web3n.asmail.DeliveryProgress;
type OutgoingMessage = web3n.asmail.OutgoingMessage;

export const specs: SpecDescribe = {
	description: '.sendMsg',
	its: []
};

let it: SpecIt = {
	expectation: 'sending and getting message with attachments from synced fs'
};
it.func = async function(s) {
	const u1_w3n = s.testAppCapsByUserIndex(0);
	const u2 = s.users[1];

	const txtBody = 'Some text\nBlah-blah-blah';

	// user 1 sends message to user 2
	const recipient = u2.userId;
	// make fs objects for attachment
	const appFS = await u1_w3n.storage!.getAppSyncedFS('computer.3nweb.test');
	const filesToAttach: File[] = [];
	for (const fp of files) {
		const path = fp.name;
		await appFS.writeTxtFile(path, fp.content);
		const file = await appFS.readonlyFile(path);
		filesToAttach.push(file);
	}
	const makeFolderIn = async (parent: WritableFS,
			folder: FolderParams): Promise<WritableFS> => {
		const fs = await parent.writableSubRoot(folder.name);
		for (const fp of folder.files) {
			await fs.writeTxtFile(fp.name, fp.content);
		}
		for (const fp of folder.folders) {
			await makeFolderIn(fs, fp);
		}
		return fs;
	};
	const folderToAttach = await makeFolderIn(appFS, folder);

	// put together and send message
	const outMsg: OutgoingMessage = {
		msgType: 'mail',
		plainTxtBody: txtBody
	};
	outMsg.attachments = { files: {}, folders: {} };
	for (const file of filesToAttach) {
		outMsg.attachments.files![file.name] = file;
	}
	outMsg.attachments.folders![folderToAttach.name] = folderToAttach;
	const idForSending = 'a1b2';
	await u1_w3n.mail!.delivery.addMsg([ recipient ], outMsg, idForSending);
	expect(await u1_w3n.mail!.delivery.currentState(idForSending)).toBeTruthy();
	const notifs: DeliveryProgress[] = [];
	await new Promise((resolve, reject) => {
		const observer: web3n.Observer<DeliveryProgress> = {
			next: (p: DeliveryProgress) => { notifs.push(p); },
			complete: resolve as () => void, error: reject
		};
		const cbDetach = u1_w3n.mail!.delivery.observeDelivery(
			idForSending, observer);
		expect(typeof cbDetach).toBe('function');
	});
	expect(notifs.length).toBeGreaterThan(0);
	const lastInfo = notifs[notifs.length-1];
	expect(typeof lastInfo).toBe('object');
	expect(lastInfo.allDone).toBe('all-ok');
	throwDeliveryErrorFrom(lastInfo);
	await u1_w3n.mail!.delivery.rmMsg(idForSending);
	expect(await u1_w3n.mail!.delivery.currentState(idForSending)).toBeFalsy();
	const recInfo = lastInfo!.recipients[recipient];
	expect(typeof recInfo.idOnDelivery).toBe('string');
	const msgId = recInfo.idOnDelivery!;

	expect(msgId).toBeTruthy();

	// user 2 gets incoming message after some delay
	await sleep(500);
	const u2_w3n = s.testAppCapsByUser(u2);
	// check message
	const msgs = await u2_w3n.mail!.inbox.listMsgs();
	const msgInfo = msgs.find(m => (m.msgId === msgId));
	expect(msgInfo).withContext(`message ${msgId} should be present in a list of all messages`).toBeTruthy();
	const inMsg = await u2_w3n.mail!.inbox.getMsg(msgId);
	expect(inMsg).toBeTruthy();
	expect(inMsg.plainTxtBody).toBe(txtBody);

	// check attachments presence
	expect(inMsg.attachments).withContext(`attachments should be present in message ${msgId}`).toBeDefined();
	const attachments = inMsg.attachments;
	if (!attachments) { throw new Error(`skipping further checks`); }
	expect(attachments.writable).toBeFalse();

	// check files in attachments
	for (const fp of files) {
		expect(await attachments.readTxtFile(fp.name)).withContext(`file content should be exactly what has been sent`).toBe(fp.content);
		await sleep(10);
		const file = await attachments.readonlyFile(fp.name);
		expect(file.writable).toBeFalse();
		expect(await file.readTxt()).toBe(fp.content);
	}

	// check folder in attachments
	const checkFolderIn = async (parent: ReadonlyFS, params: FolderParams) => {
		expect(await parent.checkFolderPresence(params.name)).withContext(`folder ${params.name} should be present in ${parent.name}`).toBe(true);
		const fs = await parent.readonlySubRoot(params.name);
		expect(fs.writable).toBeFalse();
		for (const fp of params.files) {
			expect(await fs.readTxtFile(fp.name)).withContext(`file content should be exactly what has been sent`).toBe(fp.content);
		}
		for (const fp of params.folders) {
			await checkFolderIn(fs, fp);
		}				
	};
	await checkFolderIn(attachments, folder);

};
specs.its.push(it);

async function doRoundTripSendingToEstablishInvites(
	u1: User, u1_w3n: web3n.caps.common.W3N,
	u2: User, u2_w3n: web3n.caps.common.W3N
): Promise<void> {
	// send message from 1 to 2
	await sendTxtMsg(u1_w3n, u2.userId, 'some text');

	// read message from 1, and send reply, which establishes channel with invite
	await u2_w3n.mail!.inbox.listMsgs();
	const msg: OutgoingMessage = {
		msgType: 'mail',
		plainTxtBody: 'some text'
	};
	const idForSending = 'h3j4k5';
	await u2_w3n.mail!.delivery.addMsg([ u1.userId ], msg, idForSending);
	await new Promise((resolve, reject) => {
		u2_w3n.mail!.delivery.observeDelivery(
			idForSending, { complete: resolve as () => void, error: reject });
	});
	await u2_w3n.mail!.delivery.rmMsg(idForSending);

	// read message from 2, to pick up established channel with invite
	await u1_w3n.mail!.inbox.listMsgs();
}

it = {
	expectation: 'sending and getting message with MBs attachment'
};
it.func = async function(s) {

// XXX While this runs, storage call gets stopFromOtherSide=true ipc exception.
//     And it isn't clear why. It looks like stop comes from an afterAll
//     cleanup.
//     On windows in vm this fail happens consistently.

	const u1 = s.users[0];
	const u1_w3n = s.testAppCapsByUser(u1, false);
	const u2 = s.users[1];
	const u2_w3n = s.testAppCapsByUser(u2, false);

	// send small messages to establish trusted channel, else we hit a limit
	// for a message from an unknown sender
	await doRoundTripSendingToEstablishInvites(u1, u1_w3n, u2, u2_w3n);
	
	// this text body will be used as a known end of long attachment, which
	// recipient will check.
	const txtBody = stringOfB64CharsSync(1000);
	const fileName = 'big file';

	// user 1 sends message to user 2
	const recipient = u2.userId;
	// make big file for attachment
	const appFS = await u1_w3n.storage!.getAppSyncedFS('computer.3nweb.test');
	// fingerprint bytes at the end
	const endBytes = new Uint8Array(txtBody.split('').map(
		char => char.charCodeAt(0)));
	const bytesToFile = new Uint8Array(3000000+endBytes.length);
	const rand = await randomBytes(1000);
	for (let ofs=0; ofs<3000000; ofs+=1000) {
		bytesToFile.set(rand, 1000);
	}
	bytesToFile.set(endBytes, 3000000);
	await appFS.writeBytes(fileName, bytesToFile, {create:true});

	// put together and send message
	const outMsg: OutgoingMessage = {
		msgType: 'mail',
		plainTxtBody: txtBody
	};
	outMsg.attachments = { files: {} };
	outMsg.attachments.files![fileName] = await appFS.readonlyFile(fileName);
	const idForSending = 'q2w3e4';
	await u1_w3n.mail!.delivery.addMsg([ recipient ], outMsg, idForSending);
	expect(await u1_w3n.mail!.delivery.currentState(idForSending)).toBeTruthy();
	const notifs: DeliveryProgress[] = [];
	await new Promise((resolve, reject) => {
		const observer: web3n.Observer<DeliveryProgress> = {
			next: (p: DeliveryProgress) => { notifs.push(p); },
			complete: resolve as () => void, error: reject
		};
		const cbDetach = u1_w3n.mail!.delivery.observeDelivery(
			idForSending, observer);
		expect(typeof cbDetach).toBe('function');
	});
	expect(notifs.length).toBeGreaterThan(0);
	const lastInfo = notifs[notifs.length-1];
	expect(typeof lastInfo).toBe('object');
	expect(lastInfo.allDone).toBe('all-ok');
	throwDeliveryErrorFrom(lastInfo);
	await u1_w3n.mail!.delivery.rmMsg(idForSending);
	expect(await u1_w3n.mail!.delivery.currentState(idForSending)).toBeFalsy();
	const recInfo = lastInfo!.recipients[recipient];
	expect(typeof recInfo.idOnDelivery).toBe('string');
	const msgId = recInfo.idOnDelivery!;

	expect(msgId).toBeTruthy();

	// user 2 gets incoming message, after a little wait
	await sleep(500);
	// check message
	const msgs = await u2_w3n.mail!.inbox.listMsgs();
	const msgInfo = msgs.find(m => (m.msgId === msgId));
	expect(msgInfo).withContext(`message ${msgId} should be present in a list of all messages`).toBeTruthy();
	const inMsg = await u2_w3n.mail!.inbox.getMsg(msgId);
	expect(inMsg).toBeTruthy();
	expect(inMsg.plainTxtBody).toBe(txtBody);

	// check attachments presence
	expect(!!inMsg.attachments).withContext(`attachments should be present in message ${msgId}`).toBe(true);
	const attachments = inMsg.attachments;
	if (!attachments) { throw new Error(`skipping further checks`); }

	// check file attachment
	const fileBytes = await attachments.readBytes(fileName);
	// fingerprint bytes at the end
	const receivedEndBytes = new Uint8Array(txtBody.split('').map(
		char => char.charCodeAt(0)));
	const fileEnd = fileBytes!.subarray(
		fileBytes!.length - receivedEndBytes.length);
	for (let i=0; i<fileEnd.length; i+=1) {
		if (fileEnd[i] !== receivedEndBytes[i]) {
			throw new Error(`Byte at position ${i} in the end part of an attachment is not as expected`);
		}
	}

};
it.timeout = 15*1000;
// XXX skip this, till we capture described above error
// specs.its.push(it);

Object.freeze(exports);