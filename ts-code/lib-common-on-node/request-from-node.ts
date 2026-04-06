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
import { formHttpsReqOpts, processRequest, RequestFn } from '../lib-client/request-utils';

export function makeRequestFromNode(): RequestFn<unknown> {
	const nodeRequest = (opts: https.RequestOptions) => https.request(opts);
	return (opts, contentType, reqBody) => {
		const httpsOpts = formHttpsReqOpts(opts, contentType, reqBody);
		return processRequest<unknown>(nodeRequest, httpsOpts, opts, reqBody);
	}
}
