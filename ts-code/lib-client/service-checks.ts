/*
 Copyright (C) 2025 3NSoft Inc.

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

import { checkAvailableDomains } from "./3nweb-signup";
import { NetClient } from "./request-utils";
import { asmailInfoAt, mailerIdInfoAt, makeServiceLocator, ServiceTypeDNSLabel, storageInfoAt } from "./service-locator";
import { resolveTxt as resolveDnsTxt } from 'dns';

export interface Check {
	service: 'signup'|'asmail'|'3nstorage'|'mailerid';
}

export interface CheckStart extends Check {
	start: true;
	userDomain?: string;
	serviceUrl?: string;
}

export interface CheckResult extends Check {
	isOk: boolean;
	userDomains?: string[];
	userDomain?: string;
	serviceUrl?: string;
	message: string;
	err?: any;
}

export async function checkServicesStartingFromSignup(
	client: NetClient, signupUrl: string, signupToken: string|undefined,
	progress?: (result: CheckResult|CheckStart) => void
): Promise<CheckResult[]> {
	const results: CheckResult[] = [];
	function recordResult(r: CheckResult): void {
		progress?.(r);
		results.push(r);
	}

	progress?.({ start: true, service: 'signup', serviceUrl: signupUrl });
	const signupCheck = await checkSignup(client, signupUrl, signupToken);
	recordResult(signupCheck);
	if (!signupCheck.isOk) {
		return results;
	}

	async function checkService(service: ServiceTypeDNSLabel, userDomain: string): Promise<void> {
		progress?.({ start: true, service, userDomain });
		const check = await checkUserDomainDNS(service, userDomain);
		recordResult(check);
		if (check.isOk) {
			await checkFstServiceEndpoint(service, check.serviceUrl!);
		}
	}

	async function checkFstServiceEndpoint(service: ServiceTypeDNSLabel, serviceUrl: string): Promise<void> {
		progress?.({ start: true, service: 'mailerid', serviceUrl });
		try{
			if (service === 'mailerid') {
				await mailerIdInfoAt(client, serviceUrl);
			} else if (service === 'asmail') {
				await asmailInfoAt(client, serviceUrl);
			} else if (service === '3nstorage') {
				await storageInfoAt(client, serviceUrl);
			} else {
					throw new Error(`Unknown service ${service}`);
			}
			recordResult({
				isOk: true, service, serviceUrl,
				message: `Main ${service} entrypoint at ${serviceUrl} works.`
			});
		} catch (err) {
			let message = '';
			if ((err as web3n.ConnectException).type === 'connect') {
				message = `Fail to connect to ${service} service as ${serviceUrl}:
- there may be no connection,
- service might be not up or misconfigured.`;
			}
			recordResult({ service, isOk: false, serviceUrl, err, message });
		}
	}

	for (const domain of signupCheck.userDomains!) {
		await checkService('mailerid', domain);
		await checkService('asmail', domain);
		await checkService('3nstorage', domain);
	}

	return results;
}

async function checkSignup(
	client: NetClient, signupURL: string, signupToken: string|undefined
): Promise<CheckResult> {
	try {
		const domains = await checkAvailableDomains(client, signupURL, signupToken);
		if (domains.length === 0) {
			return {
				service: 'signup',
				isOk: false,
				message: `Signup service responds but gives no domains:
- token can be incorrect/missing,
- service might have no user domains set up for signup.`
			};
		} else {
			return {
				service: 'signup',
				isOk: true,
				userDomains: domains,
				message: `Signup service returns domain(s) for users: ${domains.join(', ')}.`
			};
		}
	} catch (err) {
		let message = '';
		if ((err as web3n.HTTPException).type === 'http-request') {
			if ((err as web3n.HTTPException).status === 404) {
				message = `Server doesn't recognize path in url:
- service url might be incorrect,
- signup service might be not set up on given url.`;
			} else {
				message = `Server produces non-ok response, ${(err as web3n.HTTPException).status}:
- service url might be incorrect,
- signup service might be not set up on given url.`;
			}
		} else if ((err as web3n.ConnectException).type === 'connect') {
			message = `Fail to connect to signup service:
- there may be no connection,
- service url might be incorrect,
- server might be not set up, or not connected.`
		}
		return {
			service: 'signup',
			isOk: false,
			err,
			message
		};
	}
}

const srvLocator = makeServiceLocator({
	resolveTxt: domain => new Promise(
		(resolve, reject) => resolveDnsTxt(domain, (err, texts) => {
			if (err) { reject(err); }
			else { resolve(texts as any); }
		}))
});

async function checkUserDomainDNS(service: ServiceTypeDNSLabel, domain: string): Promise<CheckResult> {
	try {
		const serviceUrl = await (srvLocator(service))(`u@${domain}`);
		return {
			service,
			isOk: true,
			serviceUrl,
			message: `DNS record for domain ${domain} says that ${service} service is expected to be at ${serviceUrl}`
		};
	} catch (err) {
		let message = '';
		if ((err as web3n.ConnectException).type === 'connect') {
			message = `Fail to connect to get DNS record:
- there may be no connection,
- there may be DNS misconfiguration.`;
		} else if ((err as web3n.ServLocException).type === 'service-locating') {
			if ((err as web3n.ServLocException).domainNotFound) {
				message = `User domain ${domain} not found:
- domain might be incorrect
- there may be DNS misconfiguration.`;
			} else if ((err as web3n.ServLocException).noServiceRecord) {
				message = `User domain ${domain} doesn't have record for ${service} service:
- domain might be incorrect
- there may be DNS misconfiguration.`;
			}
		}
		return {
			service,
			isOk: false,
			userDomain: domain,
			err,
			message
		};
	}
}


Object.freeze(exports);