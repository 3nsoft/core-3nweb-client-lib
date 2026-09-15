/*
 Copyright (C) 2026 3NSoft Inc.
 
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

import { LogError } from "../../lib-client/logging/log-to-file";
import { checkAndTransformAddress, toCanonicalAddress } from "../../lib-common/canonical-address";
import { initSyncedFile, watchAndApplyChangesFromOtherDevices } from "../../lib-common/dataset-sync/single-file";
import { deepEqual } from "../../lib-common/json-utils";

type WritableFS = web3n.files.WritableFS;
type ASMailFilter = web3n.asmail.ASMailFilter;
type FilteringRule = web3n.asmail.FilteringRule;

const RULES_FNAME = 'rules.json';

export async function makeAddressFilter(
	fs: WritableFS, logError: LogError,
	onRuleAddition: (r: FilteringRule) => Promise<void>
) {

	const {
		file: rulesFile, changeProc
	} = await initSyncedFile(
		fs, RULES_FNAME,
		newFile => newFile.writeJSON([] as FilteringRule[])
	);

	let rules = await prepareRulesReadFromFile(await rulesFile.readJSON<FilteringRule[]>());

	async function saveRulesAndTriggerSync(): Promise<void> {
		await changeProc.startOrChain(() => rulesFile.writeJSON(rules));
		triggerUpload();
	}

	const {
		stopFileWatching, triggerUpload
	} = watchAndApplyChangesFromOtherDevices(
		rulesFile, changeProc, onChangeFromOtherDevices, doOnConflict
	);

	async function onChangeFromOtherDevices(newVersion: number) {
		changeProc.startOrChain(async () => {
			const { version, json } = await rulesFile.v!.readJSON<FilteringRule[]>();
			if (version === newVersion) {
				rules = await prepareRulesReadFromFile(json);
			}
		});
	}

	function doOnConflict() {
		return changeProc.startOrChain(async () => {
			const { remote, synced } = await rulesFile.v!.sync!.status(true);
			const syncedRules = await prepareRulesReadFromFile(
				(await rulesFile.v!.readJSON<FilteringRule[]>({ remoteVersion: synced?.latest })).json
			);
			const remoteRules = await prepareRulesReadFromFile(
				(await rulesFile.v!.readJSON<FilteringRule[]>({ remoteVersion: remote?.latest })).json
			);
			const localRules = rules.concat();
			const mergedRules: FilteringRule[] = [];
			while (remoteRules.length > 0) {
				const r = remoteRules.shift()!;
				const si = syncedRules.findIndex(sr => deepEqual(sr, r));
				const li = localRules.findIndex(lr => deepEqual(lr, r));
				if (si >= 0) {
					if (li >= 0) {
						// rule stays as is
						mergedRules.push(r);
					} else {
						// rule removed in local
					}
				} else {
					if (li >= 0) {
						// rule added in local and remote
						mergedRules.push(r);
					} else {
						// rule added in remote
						mergedRules.push(r);
					}
				}
				if (si > 0) {
					syncedRules.splice(si, 1);
				}
				if (li > 0) {
					localRules.splice(li, 1);
				}
			}
			while (localRules.length > 0) {
				const l = localRules.shift()!;
				const si = syncedRules.findIndex(sr => deepEqual(sr, l));
				if (si >= 0) {
					// rule was removed in remote
				} else {
					// rule was added in local
					mergedRules.push(l);
				}
				if (si > 0) {
					syncedRules.splice(si, 1);
				}
			}
			rules = mergedRules;
			await rulesFile.writeJSON(rules);
			await rulesFile.v!.sync!.upload({ uploadVersion: remote!.latest! + 1 });
		});
	}

	async function prepareRulesReadFromFile(rulesFromFile: FilteringRule[]): Promise<FilteringRule[]> {
		if (!Array.isArray(rulesFromFile)) {
			await logError(`Expected array with rules`, `Reading of ASMail filter rules produced unexpected data`);
			return [];
		}
		const rules: FilteringRule[] = [];
		const errors: any[] = [];
		for (const r of rulesFromFile) {
			try {
				rules.push(prepareRuleFrom(r));
			} catch (err) {
				errors.push(err);
			}
		}
		if (errors.length > 0) {
			await logError(
				errors[0],
				`Reading of ASMail filter rules produced produced ${errors.length} errors, the first one is here`
			);
		}
		return rules;
	}

	function groupRulesByDomains(rules: FilteringRule[]): Map<string, FilteringRule[]> {
		const m = new  Map<string, FilteringRule[]>();
		for (const rule of rules) {
			const domain = rule.domain;
			let domainRules = m.get(domain);
			if (!domainRules) {
				domainRules = [];
				m.set(domain, domainRules);
			}
			domainRules.push(rule);
		}
		return m;
	}
	let rulesByDomain = groupRulesByDomains(rules);

	async function addRule(ruleToAdd: FilteringRule): Promise<{ ruleIndex: number; rule: FilteringRule; }> {
		const rule = prepareRuleFrom(ruleToAdd);
		const ruleIndex = rules.push(rule) - 1;
		rulesByDomain = groupRulesByDomains(rules);
		await saveRulesAndTriggerSync();
		await onRuleAddition(rule);
		return { rule, ruleIndex };
	}

	async function removeRule(ruleIndex: number, rule: FilteringRule): Promise<boolean> {
		if ((ruleIndex < 0) || (ruleIndex >= rules.length) || !deepEqual(rules[ruleIndex], rule)) {
			return false;
		}
		rules.splice(ruleIndex, 1);
		await saveRulesAndTriggerSync();
		return true;
	}

	async function listRules(): Promise<FilteringRule[]> {
		return rules;
	}

	function isAddressBlocked(address: string): boolean {
		const cAddr = checkAndTransformAddress(address);
		if (!cAddr) {
			return true;
		}
		const { uName, dName } = cAddrIntoParts(cAddr);
		const domainRules = rulesByDomain.get(dName);
		if (!domainRules) {
			return false;
		}
		for (const rule of domainRules) {
			if (rule.ruleType === 'block-domain') {
				return true;
			} else if (rule.ruleType === 'block-address') {
				if (uName == rule.username) {
					return true;
				}
			}
		}
		return false;
	}

	function makeCAP(): ASMailFilter {
		return {
			addRule,
			removeRule,
			listRules
		};
	}

	function close() {
		stopFileWatching();
	}

	return {
		makeCAP,
		isAddressBlocked,
		close
	};
}

export type AddressFilter = Awaited<ReturnType<typeof makeAddressFilter>>;

function cAddrIntoParts(cAddr: string): { dName: string; uName: string; } {
	const atInd = cAddr.lastIndexOf('@');
	if (atInd < 0) {
		throw TypeError(`No @ in given canonical address: ${cAddr}`);
	}
	return {
		uName: cAddr.substring(0, atInd),
		dName: cAddr.substring(atInd+1)
	};
}

function prepareRuleFrom(r: FilteringRule): FilteringRule {
	switch (r.ruleType) {
		case 'block-address': {
			const cAddr = toCanonicalAddress(`${r.username}@${r.domain}`);
			const { uName, dName } = cAddrIntoParts(cAddr);
			return {
				ruleType: 'block-address',
				domain: dName, username: uName
			};
		}
		case 'block-domain': {
			const cAddr = toCanonicalAddress(`@${r.domain}`);
			const { dName } = cAddrIntoParts(cAddr);
			return {
				ruleType: 'block-domain',
				domain: dName
			};
		}
		default:
			throw TypeError(`Unknown rule type: ${(r as any).ruleType}`);
	}

}


Object.freeze(exports);