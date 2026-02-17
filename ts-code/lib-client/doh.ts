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

import * as https from 'https';
import { formHttpsReqOpts, processRequest, RequestOpts } from "./request-utils";
import { DnsResolver } from "./service-locator";
import { OutgoingHttpHeaders } from 'http';
import { ConnectException } from '../lib-common/exceptions/http';
import { CONNREFUSED, NODATA, NOTFOUND, SERVFAIL } from 'dns';

export function dohAt(dohServerUrl: string): DnsResolver {

  async function resolveTxt(domain: string): Promise<string[][]> {
    const answer = await sendDohQuestion(dohServerUrl, domain, 'TXT');
    let txt: string[][] = [];
    for (const { data: line } of answer) {
      txt.push([line]);
    }
    return txt;
  }

  return { resolveTxt };
}

interface DohReplyJSON {
  /**
   * Status 0 shows up on existing domains, while 3 on unknown ones.
   */
  Status:  0|3;
  Question: QuestionEntry[];
  /**
   * When status is 0, and there are no records, answer is missing.
   */
  Answer?: AnswerEntry[];
}

/**
 * From https://en.wikipedia.org/wiki/List_of_DNS_record_types
 * and we typed here only value for TXT, as we ain't doing other records at the moment.
 */
type DnsRecordId = 16;

interface QuestionEntry {
  name: string;
  type: DnsRecordId;
}

interface AnswerEntry {
  name: string;
  type: DnsRecordId;
  TTL: number;
  data: string;
}

async function sendDohQuestion(serverUrl: string, domain: string, type: 'TXT'): Promise<AnswerEntry[]> {
  const opts: RequestOpts = {
    method: 'GET',
    url: `${serverUrl}?name=${domain}&type=${type}`,
    responseType: 'json'
  };
  const httpsOpts = formHttpsReqOpts(opts);
  (httpsOpts.headers as OutgoingHttpHeaders).accept = 'application/dns-json';
  const reply = await processRequest<DohReplyJSON>(opts => https.request(opts), httpsOpts, opts, undefined)
  .catch((exc: ConnectException) => {
    if (exc.type === 'connect') {
      throw { code: CONNREFUSED, hostname: domain, cause: exc };
    } else {
      throw { code: SERVFAIL, hostname: domain, cause: exc };
    }
  });
  const { status, data } = reply;
  if (status !== 200) {
    throw {
      code: SERVFAIL, hostname: domain,
      message: `status ${reply.status} from DoH server`
    };
  }
  if (data.Status !== 0) {
    throw { code: NOTFOUND, hostname: domain };
  }
  if (data.Answer) {
    return data.Answer;
  } else {
    throw { code: NODATA, hostname: domain };
  }
}


Object.freeze(exports);