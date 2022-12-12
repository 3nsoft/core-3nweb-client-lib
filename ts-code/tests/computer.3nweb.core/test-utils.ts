/*
 Copyright 2022 3NSoft Inc.
 
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

import { MultiUserSetup } from "../libs-for-tests/setups";
import { SpecIt as GenericSpecIt } from "../libs-for-tests/spec-module";

type WritableFS = web3n.files.WritableFS;

export interface SetupWithTwoDevsFSs {
	isUp: boolean;
	dev1FS: () => WritableFS;
	dev1LocalFS: () => WritableFS;
	dev2: {
		stop(): Promise<void>;
		start(): Promise<void>;
	};
	dev2FS: () => WritableFS;
	dev2LocalFS: () => WritableFS;
	resetFS: () => Promise<void>;
}

export type SpecItWithTwoDevsFSs = GenericSpecIt<SetupWithTwoDevsFSs>;

export function makeSetupWithTwoDevsFSs(testFolder: string): {
	fsSetup: SetupWithTwoDevsFSs;
	setupDevsAndFSs: (baseSetup: MultiUserSetup) => Promise<void>;
} {

	const fsSetup = {} as SetupWithTwoDevsFSs;

	const setupDevsAndFSs = async (baseSetup: MultiUserSetup) => {
		if (!baseSetup.isUp) { return; }
		const w3n1 = baseSetup.testAppCapsByUserIndex(0);
		const dev2 = await baseSetup.sndDevByUserIndex(0);

		const dev1AppFS = await w3n1.storage!.getAppSyncedFS();
		const dev2AppFS = () => dev2.w3n.storage!.getAppSyncedFS();

		const dev1LocalAppFS = await w3n1.storage!.getAppLocalFS();
		const dev2LocalAppFS = () => dev2.w3n.storage!.getAppLocalFS();

		let dev1FS: WritableFS;
		let dev2FS: WritableFS;
		fsSetup.dev1FS = () => dev1FS;
		fsSetup.dev2FS = () => dev2FS;

		let dev1LocalFS: WritableFS;
		let dev2LocalFS: WritableFS;
		fsSetup.dev1LocalFS = () => dev1LocalFS;
		fsSetup.dev2LocalFS = () => dev2LocalFS;

		fsSetup.dev2 = {
			start: async () => {
				await dev2.start();
				dev2FS = await (await dev2AppFS()).writableSubRoot(testFolder);
			},
			stop: async () => {
				dev2FS = undefined as any;
				await dev2.stop();
			}
		};

		fsSetup.resetFS = async () => {
			await clearFS(dev1AppFS);
			dev1FS = await dev1AppFS.writableSubRoot(
				testFolder, { create: true, exclusive: true }
			);
			await dev1AppFS.v!.sync!.upload(testFolder);
			await dev1AppFS.v!.sync!.upload('');
			const d2AppFS = await dev2AppFS();
			const status =  await d2AppFS.v!.sync!.updateStatusInfo('');
			if (status.state === 'behind') {
				await d2AppFS.v!.sync!.adoptRemote('');
			} else if (status.state === 'conflicting') {
				throw new Error(`Test file system on a second device has inconvenient conflicting sync state`);
			}
			dev2FS = await d2AppFS.writableSubRoot(
				testFolder, { create: false }
			);
			await clearFS(dev1LocalAppFS);
			dev1LocalFS = await dev1LocalAppFS.writableSubRoot(
				testFolder, { create: true, exclusive: true }
			);
			const d2LocalAppFS = await dev2LocalAppFS();
			dev2LocalFS = await d2LocalAppFS.writableSubRoot(
				testFolder, { create: true, exclusive: true }
			);
		};

		await fsSetup.resetFS();

		fsSetup.isUp = true;
	};

	return { fsSetup, setupDevsAndFSs };
}

async function clearFS(fs: WritableFS): Promise<void> {
	let items = await fs.listFolder('');
	let delTasks: Promise<void>[] = [];
	for (let f of items) {
		if (f.isFile) {
			delTasks.push(fs.deleteFile(f.name));
		} else if (f.isFolder) {
			delTasks.push(fs.deleteFolder(f.name, true));
		} else if (f.isLink) {
			delTasks.push(fs.deleteLink(f.name));
		} else {
			throw new Error(`File system item is neither file, nor folder, nor link`);
		}
	}
	await Promise.all(delTasks);
}
