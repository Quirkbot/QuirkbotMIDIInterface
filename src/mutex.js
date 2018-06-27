import {
	log
} from './log'

import {
	delay,
	tryToExecute
} from './utils'

const localStorageHash = {}
let localStorage
if (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
	// eslint-disable-next-line prefer-destructuring
	localStorage = window.localStorage
} else {
	localStorage = {
		setItem    : (key, value) => localStorageHash[key] = value,
		getItem    : key => localStorageHash[key] || null,
		removeItem : key => delete localStorageHash[key]
	}
}

const setLock = lock => localStorage.setItem('_qbmidi_lock_', JSON.stringify(lock))
const getLock = () => JSON.parse(localStorage.getItem('_qbmidi_lock_'))
const clearLock = () => localStorage.removeItem('_qbmidi_lock_')

export async function guaranteeLockThread(runtimeId) {
	await tryToExecute(() => lockThread(runtimeId), 225, 200)
}
export async function lockThread(runtimeId) {
	let lock = getLock()
	log('Initial lock value', lock)
	if (lock && lock.ts) {
		const age = Date.now() - lock.ts
		if (age < 20000) {
			throw new Error(`Thread already locked, age ${age}.`)
		}
	}

	lock = {
		runtimeId,
		ts : Date.now()
	}
	log('Set lock value', lock)
	setLock(lock)

	await delay(10)

	lock = getLock()
	log('Verification lock value', lock)
	if (!lock) {
		throw new Error('Lock did not persist.')
	}
	if (lock.runtimeId !== runtimeId) {
		throw new Error(`Runtime ID missmatch. ${lock.runtimeId} != ${runtimeId}`)
	}
	// in case the window is unloaded while the thread is locked, clear it
	if (typeof window !== 'undefined') {
		window.addEventListener('beforeunload', clearLock)
	}
}

export async function unlockThread(runtimeId) {
	const lock = getLock()
	if (!lock) {
		throw new Error('There is no lock to be unlocked.')
	}
	if (lock.runtimeId !== runtimeId) {
		throw new Error(`This runtime has not locked this thread. Current id is ${lock.runtimeId}`)
	}
	clearLock()
	// remove the listerner that monitors if the window is unloaded
	if (typeof window !== 'undefined') {
		window.removeEventListener('beforeunload', clearLock)
	}
}
