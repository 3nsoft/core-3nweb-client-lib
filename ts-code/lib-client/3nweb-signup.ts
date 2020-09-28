/*
 Copyright (C) 2015, 2017, 2020 3NSoft Inc.

 This program is free software: you can redistribute it and/or modify it under
 the terms of the GNU General Public License as published by the Free Software
 Foundation, either version 3 of the License, or (at your option) any later
 version.

 This program is distributed in the hope that it will be useful, but
 WITHOUT ANY WARRANTY; without even the implied warranty of
 MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 See the GNU General Public License for more details.

 You should have received a copy of the GNU General Public License along with
 this program. If not, see <http://www.gnu.org/licenses/>. */

import { NetClient, makeException } from './request-utils';
import * as api from '../lib-common/user-admin-api/signup';

export async function sendAvailabilityRequest(
	client: NetClient, serviceUrl: string, userId: string
): Promise<boolean> {
	const reqData: api.isAvailable.Request = {
		userId: userId
	};
	const rep = await client.doJsonRequest<void>({
		method: 'POST',
		url: serviceUrl + api.isAvailable.URL_END
	}, reqData);
	if (rep.status === api.isAvailable.SC.ok) {
		return true;
	} else if (rep.status === api.isAvailable.SC.userAlreadyExists) {
		return false;
	} else {
		throw makeException(rep, 'Unexpected status');
	}
}

export async function checkAvailableAddressesForName(
	client: NetClient, serviceUrl: string, name: string
): Promise<string[]> {
	const reqData: api.availableAddressesForName.Request = {
		name: name
	};
	const rep = await client.doJsonRequest<string[]>({
		method: 'POST',
		url: serviceUrl + api.availableAddressesForName.URL_END,
		responseType: 'json'
	}, reqData);
	if (rep.status === api.availableAddressesForName.SC.ok) {
		if (Array.isArray(rep.data)) {
			return rep.data;
		} else {
			throw makeException(rep, 'Reply is malformed');
		}
	} else {
		throw makeException(rep, 'Unexpected status');
	}
}

export async function addUser(
	client: NetClient, serviceUrl: string, userParams: api.addUser.Request
): Promise<boolean> {
	const rep = await client.doJsonRequest<string[]>({
		method: 'POST',
		url: serviceUrl + api.addUser.URL_END,
		responseType: 'json'
	}, userParams);
	if (rep.status === api.addUser.SC.ok) {
		return true;
	} else if (rep.status === api.addUser.SC.userAlreadyExists) {
		return false;
	} else {
		throw makeException(rep, 'Unexpected status');
	}
}

export async function sendActivationCheckRequest(
	client: NetClient, serviceUrl: string, userId: string
): Promise<boolean> {
	const reqData: api.isActivated.Request = {
		userId: userId
	};
	const rep = await client.doJsonRequest<string[]>({
		method: 'POST',
		url: serviceUrl + api.isActivated.URL_END,
		responseType: 'json'
	}, reqData);
	if (rep.status === api.isActivated.SC.ok) {
		return true;
	} else if (rep.status === api.isActivated.SC.notActive) {
		return false;
	} else {
		throw makeException(rep, 'Unexpected status');
	}
}

Object.freeze(exports);