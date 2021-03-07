/*
 Copyright (C) 2018 3NSoft Inc.
 
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

// XXX direct usage of weak should probably be replaced by wrapping
// WeakReference that may use inbuilt instead of napi implmentation.
import * as weak from 'weak-napi';
import { stringOfB64CharsSync } from '../random-node';

export interface AppSide {
	handleMsg(msg: any[]): void;
	handleObjRemovalOnOtherSide(id: number): void;
	close(): void;
}

export interface RPCLink {
	setApp(app: AppSide): { appId: string; bufMsgs?: any[][]; };
	sendMsg(reqAppId: string, msgArr: any[]): void;
	setToWMap(reqAppId: string, id: number, obj?: any): void;
	getFromWMap(reqAppId: string, id: number): any|undefined;
	close(): void;
}

export function makeRPCLink(): RPCLink {
	return (new Link()).wrap();
}

interface App {
	id: string;
	side: AppSide;
	wRefs: Map<number, any>;
}

class Link {

	private app1: App = undefined as any;
	private app2: App = undefined as any;
	private startupMsgBuffer: any[][]|undefined = [];

	private wereAppsSet(): boolean {
		return !this.startupMsgBuffer;
	}
	
	private isConnected(): boolean {
		return !!(this.app1 && this.app2);
	}

	setApp(app: AppSide): { appId: string; bufMsgs?: any[][]; } {
		if (this.wereAppsSet()) { throw new Error(`Apps have already been set`); }
		if (!this.app1) {
			this.app1 = Object.freeze({
				id: stringOfB64CharsSync(30),
				side: app,
				wRefs: new Map<number, any>(),
			});
			return { appId: this.app1.id };
		} else {
			this.app2 = Object.freeze({
				id: stringOfB64CharsSync(30),
				side: app,
				wRefs: new Map<number, any>(),
			});
			const msgs = this.startupMsgBuffer!;
			this.startupMsgBuffer = undefined;
			return {
				appId: this.app2.id,
				bufMsgs: ((msgs.length > 0) ? msgs : undefined)
			};
		}
	}

	sendMsg(reqAppId: string, msg: any[]): void {
		if (!this.wereAppsSet()) {
			if (!this.isApp1(reqAppId)) { throw new Error(`Unknown request app`); }
			this.startupMsgBuffer!.push(msg);
			return;
		}
		if (!this.isConnected()) { return; }
		if (this.isApp1(reqAppId)) {
			this.app2.side.handleMsg(msg);
		} else {
			this.app1.side.handleMsg(msg);
		}
	}

	private isApp1(reqAppId: string): boolean {
		if (this.app1 && (this.app1.id === reqAppId)) { return true; }
		if (this.app2 && (this.app2.id === reqAppId)) { return false; }
		throw new Error(`Unknown request app`);
	}

	addToWMap(reqAppId: string, id: number, obj?: any): void {
		if (obj === undefined) {
			if (this.isApp1(reqAppId)) {
				this.app1.wRefs.delete(id);
			} else {
				this.app2.wRefs.delete(id);
			}
		} else {
			if (this.isApp1(reqAppId)) {
				const gcCallback = makeCallbackForObjectRemoval(
					this.app2.side, id, this.app1.wRefs);
				this.app1.wRefs.set(id, weak(obj, gcCallback));
			} else {
				const gcCallback = makeCallbackForObjectRemoval(
					this.app1.side, id, this.app2.wRefs);
				this.app2.wRefs.set(id, weak(obj, gcCallback));
			}
		}
	}

	getFromWMap(reqAppId: string, id: number): any|undefined {
		const isApp1 = this.isApp1(reqAppId);
		const wRef = (isApp1 ? this.app1.wRefs.get(id) : this.app2.wRefs.get(id));
		if (!wRef) { return; }
		return weak.get(wRef);
	}

	close(): void {
		if (!this.isConnected()) { return; }
		if (this.app1) {
			try {
				this.app1.side.close();
			} catch (err) {}
			this.app1.wRefs.clear();
			this.app1 = undefined as any;
		}
		if (this.app2) {
			try {
				this.app2.side.close();
			} catch (err) {}
			this.app2.wRefs.clear();
			this.app2 = undefined as any;
		}
	}

	wrap(): RPCLink {
		const w: RPCLink = {
			setApp: this.setApp.bind(this),
			sendMsg: this.sendMsg.bind(this),
			setToWMap: this.addToWMap.bind(this),
			getFromWMap: this.getFromWMap.bind(this),
			close: this.close.bind(this),
		};
		return Object.freeze(w);
	}

}

function makeCallbackForObjectRemoval(objOrigin: AppSide, id: number,
		weakRefs: Map<number, any>): Function {
	return function() {
		weakRefs.delete(id);
		objOrigin.handleObjRemovalOnOtherSide(id);
	};
}