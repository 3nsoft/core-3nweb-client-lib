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
import * as http from 'http';
import { formHttpsReqOpts, processRequest, RequestFn } from '../lib-client/request-utils';

export function makeRequestFromNode(getAgent?: () => https.Agent|undefined): RequestFn<unknown> {
	const nodeHttpsRequest = (opts: https.RequestOptions) => https.request(opts);
	const nodeHttpRequest = (opts: http.RequestOptions) => http.request(opts);
	return (opts, reqContentType, reqBody) => {
		const reqOpts = formHttpsReqOpts(opts, reqContentType, reqBody);
		const agent = getAgent?.();
		if (agent) {
				reqOpts.agent = agent;
		}
		const requestFn = ((reqOpts.protocol === 'http:') ? nodeHttpRequest : nodeHttpsRequest);
		return processRequest<unknown>(requestFn, reqOpts, opts, reqBody);
	}
}
