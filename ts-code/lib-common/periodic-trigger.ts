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


export function startPeriodicConditionalTriggerProc(
	shouldTrigger: () => boolean,
	trigger: () => void,
	timeoutSecond: number
): (() => void) {
	let checkActive = true;
	function checkAndTrigger() {
		if (!checkActive) {
			return;
		}
		if (shouldTrigger()) {
			trigger();
		}
		setNext();
	}

	let triggerTime: ReturnType<typeof setTimeout>|undefined = undefined;
	function setNext() {
		triggerTime = setTimeout(checkAndTrigger, timeoutSecond*1000);
		if (typeof triggerTime === 'object') {
			triggerTime.unref?.();
		}
	}

	return () => {
		checkActive = false;
		clearTimeout(triggerTime);
	};
}


Object.freeze(exports);