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

import { RequestFn, RequestOpts } from "./request-utils";
import { DnsResolver, CONNREFUSED, NODATA, NOTFOUND, SERVFAIL } from "./networks";
import { ConnectException } from '../lib-common/exceptions/http';
import * as Packet from 'native-node-dns-packet';
import { base64urlSafe, toBuffer } from "../lib-common/buffer-utils";

export function dohAt(request: RequestFn<unknown>, dohServerUrl: string, type: 'legacy'|'json'): DnsResolver {
  return {
    resolveTxt: ((type === 'legacy') ?
      domain => sendLegacyDohTxtQuestion(request as RequestFn<Uint8Array>, dohServerUrl, domain) :
      domain => sendJsonDohTxtQuestion(request as RequestFn<DohReplyJSON>, dohServerUrl, domain)
    )
  };
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

async function sendJsonDohTxtQuestion(
  request: RequestFn<DohReplyJSON>, serverUrl: string, domain: string
): Promise<string[][]> {
  const opts: RequestOpts = {
    method: 'GET',
    url: `${serverUrl}?name=${domain}&type=TXT`,
    requestHeaders: {
      accept: 'application/dns-json'
    },
    responseType: 'json'
  };
  const reply = await request(opts)
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
    let txt: string[][] = [];
    for (const { data: line } of data.Answer) {
      txt.push([line]);
    }
    return txt;
  } else {
    throw { code: NODATA, hostname: domain };
  }
}

interface DnsPacket {
  header: { rcode: 0|3; }
  question: { name: string; type: 16; class: 1 }[];
  answer: { name: string; data: string[]; ttl: number; type: number; }[];
}

function packB64TxtDnsQuestionPacket(domain: string): string {
  const questionPack: DnsPacket = new Packet();
  questionPack.question.push({ name: domain, type: 16, class: 1 });
  const buf = Buffer.alloc(500);
  const len = Packet.write(buf, questionPack);
  return base64urlSafe.pack(buf.subarray(0, len));
}

function unpackDnsAnswerPacket(data: Uint8Array): DnsPacket {
  return Packet.parse(toBuffer(data));
}

export async function sendLegacyDohTxtQuestion(
  request: RequestFn<Uint8Array>, serverUrl: string, domain: string
): Promise<string[][]> {
  const dnsPacketInB64 = packB64TxtDnsQuestionPacket(domain);
  const opts: RequestOpts = {
    method: 'GET',
    url: `${serverUrl}?dns=${dnsPacketInB64}`,
    requestHeaders: {
      accept: 'application/dns-message'
    },
    responseType: 'arraybuffer'
  };
  const reply = await request(opts)
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
  const answerPacket = unpackDnsAnswerPacket(data);
  if (answerPacket.header.rcode !== 0) {
    throw { code: NOTFOUND, hostname: domain };
  }
  if (answerPacket.answer.length > 0) {
    return answerPacket.answer.map(({ data }) => data);
  } else {
    throw { code: NODATA, hostname: domain };
  }
}


Object.freeze(exports);