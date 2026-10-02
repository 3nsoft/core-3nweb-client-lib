/*
 Copyright (C) 2015 - 2017, 2020 - 2021, 2024 - 2026 3NSoft Inc.
 
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

import { NetClient, RequestFn, makeNetClient, OpenServiceEventsSource } from './request-utils';
import { makeRuntimeException } from '../lib-common/exceptions/runtime';
import { LogError } from './logging/log-to-file';

type NetworkConnectException = web3n.NetworkConnectException;

/**
 * @param address
 * @return domain string, extracted from a given address
 */
function domainOfAddress(address: string): string {
  address = address.trim();
  const indOfAt = address.lastIndexOf('@');
  if (indOfAt < 0) {
    return address;
  } else {
    return address.substring(indOfAt+1);
  }
}

type ServLocException = web3n.ServLocException;
type DNSConnectException = web3n.DNSConnectException;

function domainNotFoundExc(
  address: string,
  cause: { code: string; hostname: string; message: string; }
): ServLocException {
  return makeRuntimeException<ServLocException>(
    'service-locating', { address, cause }, { domainNotFound: true }
  );
}

function noServiceRecordExc(address: string): ServLocException {
  return makeRuntimeException<ServLocException>(
    'service-locating', { address }, { noServiceRecord: true }
  );
}

function noConnectionExc(
  cause: { code: string; hostname: string; message: string; }
): DNSConnectException {
  return makeRuntimeException<DNSConnectException>(
    'connect', {
      connectType: 'dns',
      message: `The most likely cause of this error is device not connected. Next likely cause is DNS not setup, or not connecting properly. Like the saying goes: "It's not DNS. There is no way it's DNS. It was DNS."`,
      cause
    }, {}
  );
}

function noConnectionToWellKnownExc(message: string, cause: any): DNSConnectException {
  return makeRuntimeException<DNSConnectException>(
    'connect', {
      connectType: 'dns',
      message,
      cause
    }, {}
  );
}

/**
 * This implementation extracts exactly one string value for a given service.
 * All other values are ignored, without raising error about misconfiguration.
 * In time we may have several records for the same service type, yet, for now
 * only one TXT per service per domain is considered valid.
 * @param txtRecords are TXT records from dns.
 * @param serviceLabel is a label of service, for which we want to get string
 * value from TXT record.
 * @return string value for a given service among given dns TXT records, or
 * undefined, when service record is not found.
 */
function extractPair(txtRecords: string[][], serviceLabel: DNSLabel): string|undefined {
  for (const txtRecord of txtRecords) {
    let joinedTXTstanzas = txtRecord.join('');
    let record = getRecordAtStartOf(joinedTXTstanzas);
    while (record) {
      if (record.service === serviceLabel) {
        const value = record.value.trim();
        if (value.length > 0) {
          return value;
        }
      }
      if (record.txtTail) {
        record = getRecordAtStartOf(record.txtTail);
      } else {
        break;
      }
    }
  }
  return;
}

const recordsStarts: { [key in DNSLabel]: string; } = {
  "3nstorage": '3nstorage=',
  asmail: 'asmail=',
  mailerid: 'mailerid=',
  report: 'report=',
  w3nApp: 'w3n-app='
}

function getRecordAtStartOf(txt: string): {
  service: ServiceTypeDNSLabel; value: string; txtTail?: string;
}|undefined {
  let service: ServiceTypeDNSLabel|undefined = undefined;
  for (const [ label, startSeq ] of Object.entries(recordsStarts)) {
    if (txt.startsWith(startSeq)) {
      service = label as ServiceTypeDNSLabel;
      txt = txt.substring(startSeq.length);
      break;
    }
  }
  if (!service) { return; }
  for (const delimiter of Object.values(recordsStarts)) {
    const endPos = txt.indexOf(delimiter);
    if (endPos >= 0) {
      return {
        service,
        value: txt.substring(0, endPos),
        txtTail: txt.substring(endPos)
      };
    }
  }
  return {
    service,
    value: txt
  };
}

interface DnsError extends Error {
  code: string;
  hostname: string;
}

export type ServiceTypeDNSLabel = 'mailerid' | 'asmail' | '3nstorage';
export type DNSLabel = ServiceTypeDNSLabel | 'report' | 'w3nApp'

export type ServiceLocatorMaker = (
  serviceLabel: DNSLabel,
  logError: LogError
) => ServiceLocator;

export type ServiceLocator = (address: string) => Promise<string>;

export interface DnsResolver {
  resolveTxt: (hostname: string) => Promise<string[][]>;
}
export const NODATA = "ENODATA";
// export const FORMERR = "EFORMERR";
export const SERVFAIL = "ESERVFAIL";
export const NOTFOUND = "ENOTFOUND";
// export const NOTIMP = "ENOTIMP";
// export const REFUSED = "EREFUSED";
// export const BADQUERY = "EBADQUERY";
// export const BADNAME = "EBADNAME";
// export const BADFAMILY = "EBADFAMILY";
// export const BADRESP = "EBADRESP";
export const CONNREFUSED = "ECONNREFUSED";
export const TIMEOUT = "ETIMEOUT";
// export const EOF = "EOF";
// export const FILE = "EFILE";
// export const NOMEM = "ENOMEM";
// export const DESTRUCTION = "EDESTRUCTION";
// export const BADSTR = "EBADSTR";
// export const BADFLAGS = "EBADFLAGS";
// export const NONAME = "ENONAME";
// export const BADHINTS = "EBADHINTS";
// export const NOTINITIALIZED = "ENOTINITIALIZED";
// export const LOADIPHLPAPI = "ELOADIPHLPAPI";
// export const ADDRGETNETWORKPARAMS = "EADDRGETNETWORKPARAMS";
// export const CANCELLED = "ECANCELLED";

const onionTLD = '.onion';
const i2pTLD = '.i2p';

export interface NetworkFns {
  requests: RequestFn<unknown>;
  openServiceEventsSource: OpenServiceEventsSource;
}

export interface RegularNetworkFns extends NetworkFns {
  naming: DnsResolver[];
}

function makeMissingImplementationException(
  networkType: NetworkConnectException['networkType'],
  location: string
) {
  return makeRuntimeException<NetworkConnectException>(
    'connect', { networkType, location }, { noImplementationSet: true }
  );
}

export function wrapNetworkFns(impls: {
  regular: RegularNetworkFns;
  onion?: NetworkFns;
  i2p?: NetworkFns;
  resetConnectivity?: () => void;
}): {
  makeLocator: ServiceLocatorMaker;
  makeNet: () => NetClient;
} {
  const { regular, i2p, onion, resetConnectivity } = impls;
  const locateInDNS = makeServiceLocatorInDNS(...regular.naming);
  const locationRequesterInOnion = (onion ?
    makeNetClient(onion.requests, undefined as any).doBodylessRequest : undefined
  );
  const locationRequesterInI2P = (i2p ?
    makeNetClient(i2p.requests, undefined as any).doBodylessRequest : undefined
  );

  const makeLocator: ServiceLocatorMaker = function(serviceLabel, logError) {
    return async address => {
      if (address.endsWith(onionTLD)) {
        if (locationRequesterInOnion) {
          return locateInWellKnown(locationRequesterInOnion, address, serviceLabel);
        } else {
          throw makeMissingImplementationException('onion', address);
        }
      } else if (address.endsWith(i2pTLD)) {
        if (locationRequesterInI2P) {
          return locateInWellKnown(locationRequesterInI2P, address, serviceLabel);
        } else {
          throw makeMissingImplementationException('i2p', address);
        }
      } else {
        return locateInDNS(address, serviceLabel, logError);
      }
    };
  }

  function fnsForUrl(url: string) {
    const u = new URL(url);
    if (u.hostname.endsWith(onionTLD)) {
      if (onion) {
        return onion;
      } else {
        throw makeMissingImplementationException('onion', url);
      }
    } else if (u.hostname.endsWith(i2pTLD)) {
      if (i2p) {
        return i2p;
      } else {
        throw makeMissingImplementationException('i2p', url);
      }
    } else {
      return regular;
    }
  }
  const requestFn: RequestFn<unknown> = async function(opts, reqContentType, reqBody) {
    const { requests } = fnsForUrl(opts.url!);
    return requests(opts, reqContentType, reqBody);
  };
  const openEventSourceFn: OpenServiceEventsSource = async function(req) {
    const { openServiceEventsSource } = fnsForUrl(req.url!);
    return openServiceEventsSource(req);
  };

  function makeNet(): NetClient {
    return makeNetClient(requestFn, openEventSourceFn, resetConnectivity);
  }

  return { makeLocator, makeNet };
}

function makeServiceLocatorInDNS(...resolvers: DnsResolver[]) {
  if (resolvers.length === 0) {
    throw Error(`no DNS resolvers given`);
  }
  async function locateInDNS(
    address: string, serviceLabel: DNSLabel, logError: LogError
  ): ReturnType<ServiceLocator> {
    const domain = domainOfAddress(address);
    let exc: any = undefined;
    let connectionExc: DNSConnectException|undefined = undefined;
    for (let i=0; i<resolvers.length; i+=1) {
      const resolver = resolvers[i];
      let txtRecords: string[][];
      try {
        txtRecords = await resolver.resolveTxt(domain);
      } catch (err) {
        await logError(err, `Resolver ${i+1} fails to get TXT records of ${domain}`);
        const { code, hostname, message } = (err as DnsError);
        if (code === NODATA) {
          exc = noServiceRecordExc(address);
        } else if ((code === SERVFAIL)
        || (code === CONNREFUSED)
        || (code === TIMEOUT)) {
          connectionExc ??= noConnectionExc({ code, hostname, message });
        } else if ((code === NOTFOUND) || hostname) {
          exc ??= domainNotFoundExc(address, { code, hostname, message });
        } else {
          exc ??= err;
        }
        continue;
      }
      const recValue = extractPair(txtRecords, serviceLabel);
      if (recValue) {
        return postProcessValue(serviceLabel, recValue);
      } else {
        exc ??= noServiceRecordExc(address);
      }
    }
    throw exc ?? connectionExc;
  }
  return locateInDNS;
}

function postProcessValue(serviceLabel: DNSLabel, recordValue: string): string {
  switch (serviceLabel) {
    case 'report':
      return recordValue;
    default:
      return checkAndPrepareURL(recordValue);
  }
}

function checkAndPrepareURL(value: string): string {
  // XXX insert some value sanity check
  
  return 'https://'+value;
}

const wellKnownPath = '/.well-known/3nweb.json';

interface WellKnown3NWeb {
  mailerid?: string;
  asmail?: string;
  '3nstorage'?: string;
  report?: string;
  'w3n-app'?: string;
}

async function locateInWellKnown(
  request: NetClient['doBodylessRequest'], address: string, serviceLabel: DNSLabel
): ReturnType<ServiceLocator> {
  const host = domainOfAddress(address);
  try {
    const reply = await request<WellKnown3NWeb>({
      method: 'GET',
      url: `https://${host}${wellKnownPath}`
    });
    if (reply.status === 200) {
      const recValue = reply.data[serviceLabel];
      if (recValue) {
        return postProcessValue(serviceLabel, recValue);
      } else {
        throw noServiceRecordExc(address);
      }
    } else if (reply.status === 404) {
      throw noServiceRecordExc(address);
    } else {
      throw noConnectionToWellKnownExc(
        `Fail to read ${wellKnownPath} for ${address}`,
        { httpStatus: reply.status }
      );
    }
  } catch (exc) {
    throw noConnectionToWellKnownExc(`Fail to read ${wellKnownPath} for ${address}`, exc);
  }
}


Object.freeze(exports);