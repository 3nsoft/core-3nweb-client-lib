/*
 Copyright (C) 2020 - 2021 3NSoft Inc.

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

import { StorageOwner as StorageOwnerClient } from './lib-client/3nstorage/service';
import { MailRecipient as MailRecipientClient } from './lib-client/asmail/recipient';
import { MailSender as MailSenderClient } from './lib-client/asmail/sender';
import { MailerIdProvisioner as MailerIdProvisionerClient } from './lib-client/mailer-id/provisioner';
import * as signupClientFuncs from './lib-client/3nweb-signup';
import * as signupApi from './lib-common/user-admin-api/signup';
import { user as midUser } from './lib-common/mid-sigs-NaCl-Ed';
import * as srvLocFuncs from './lib-client/service-locator';


export type StorageOwner = StorageOwnerClient;
export const StorageOwner = StorageOwnerClient;

export type MailRecipient = MailRecipientClient;
export const MailRecipient = MailRecipientClient;

export type MailSender = MailSenderClient;
export const MailSender = MailSenderClient;

export const signupFuncs = signupClientFuncs;

export type MailerIdProvisioner = MailerIdProvisionerClient;
export const MailerIdProvisioner = MailerIdProvisionerClient;

export type UserMidParams = signupApi.UserMidParams;
export type UserStorageParams = signupApi.UserStorageParams;
export type MailerIdSigner = midUser.MailerIdSigner;

export const serviceLocationFuncs = srvLocFuncs;

export function getLibVersion(): string {
	return require(`../package.json`).version;
}


Object.freeze(exports);