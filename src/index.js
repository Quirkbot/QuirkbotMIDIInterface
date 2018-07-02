import {
	inPlaceArrayDiff,
	inPlaceArrayConcat,
	delay,
	asyncSafeWhile,
	generateUniqueId,
} from './utils'

import {
	log,
	logOpen,
	logOpenCollapsed,
	logClose,
	enableLogs,
	disableLogs,
	setCustomLogHandler
} from './log'

import { getMIDIAccess } from './midi'
import {
	guaranteeLockThread,
	unlockThread,
} from './mutex'

import {
	findDeadLinks,
	findPossibleLinks,
	updateLinksInfoIfNeeded,
	syncLinksWithState,
	saveLinksStateToLocalStorage,
} from './links'

import {
	uploadHexToSingleLink,
	guaranteeSingleLinkEnterBootloaderMode,
	guaranteeSingleLinkExitBootloaderMode
} from './singleLink'

/**
* Globals
*/
const mainLinksMap = new Map()
const mainLinks = []
const pendingUploads = []
const pendingEnterBootloaderMode = []
const pendingExitBootloaderMode = []
let mainMidiAccess = null
let monitoring = false

export { enableLogs, disableLogs, setCustomLogHandler }

export async function init() {
	if (monitoring) {
		log('Already init')
		return
	}
	try {
		monitoring = true
		mainMidiAccess = await getMIDIAccess()
		continuouslyMonitor(
			true,
			mainLinksMap,
			mainLinks,
			pendingUploads,
			pendingEnterBootloaderMode,
			pendingExitBootloaderMode,
			mainMidiAccess,
		)
		if (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
			window.addEventListener('storage', handleStateChange)
		}
	} catch (error) {
		monitoring = false
		if (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
			window.removeEventListener('storage', handleStateChange)
		}
		log('Could not init', error)
	}
}

export function destroy() {
	monitoring = false
	if (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
		window.removeEventListener('storage', handleStateChange)
	}
}

export function getLinks() {
	return mainLinks
}

export function getLinksMap() {
	return mainLinksMap
}

export function getLinkByUuid(uuid) {
	return mainLinks.filter(l => l.uuid === uuid).pop()
}

export function getLinkByRuntimeId(runtimeId) {
	return mainLinks.filter(l => l.runtimeId === runtimeId).pop()
}

export async function uploadHexToLink(link, hexString) {
	if (pendingUploads.filter(upload => upload.link === link).length) {
		throw new Error('There is an ongoing upload to this link.')
	}

	if (!link.midi) {
		throw new Error('This link is not midi enabled.')
	}

	const pendingUpload = {
		link,
		hexString
	}
	pendingUploads.push(pendingUpload)

	await asyncSafeWhile(
		async () => pendingUploads.includes(pendingUpload),
		async () => delay(100),
		() => log('Pending uploads took too long to clear, exiting'),
		600
	)

	if (pendingUpload.error) {
		throw pendingUpload.error
	}
	return pendingUpload.link
}

export async function enterBootloaderMode(link) {
	if (pendingEnterBootloaderMode.filter(request => request.link === link).length) {
		throw new Error('There is an ongoing request to enter bootloader mode on this link.')
	}

	if (!link.midi) {
		throw new Error('This link is not midi enabled.')
	}

	const request = {
		link
	}
	pendingEnterBootloaderMode.push(request)
	await asyncSafeWhile(
		async () => pendingEnterBootloaderMode.includes(request),
		async () => delay(100),
		() => log('Pending enter bootloader took too long to clear, exiting'),
		600
	)

	if (request.error) {
		throw request.error
	}
	return request.link
}

export async function exitBootloaderMode(link) {
	if (pendingExitBootloaderMode.filter(request => request.link === link).length) {
		throw new Error('There is an ongoing request to exit bootloader mode on this link.')
	}

	if (!link.midi) {
		throw new Error('This link is not midi enabled.')
	}

	const request = {
		link
	}
	pendingExitBootloaderMode.push(request)
	await asyncSafeWhile(
		async () => pendingExitBootloaderMode.includes(request),
		async () => delay(100),
		() => log('Pending exit bootloader took too long to clear, exiting'),
		600
	)

	if (request.error) {
		throw request.error
	}
	return request.link
}

async function continuouslyMonitor(firstRun, linksMap, links, uploads, enterBootloaderModes, exitBootloaderModes, midiAccess) {
	if (!monitoring) {
		log('Monitoring disabled. Call init() to start')
		return
	}
	const runtimeId = generateUniqueId()
	logOpenCollapsed(`Monitor - Runtime ID: ${runtimeId}`)

	if (typeof document !== 'undefined' && document.hidden) {
		log('Tab is not visible. Stopping task.')
		logClose(true)
		await delay(200 + (Math.random() * 100))
		continuouslyMonitor(false, linksMap, links, uploads, enterBootloaderModes, exitBootloaderModes, midiAccess)
		return
	}

	logOpenCollapsed('Lock Thread')
	try {
		await guaranteeLockThread(runtimeId)
		log('Thread locked', runtimeId)
	} catch (error) {
		log(`Error trying to lock thread ${runtimeId}`, error)
		logClose(true)
		await delay(200 + (Math.random() * 100))
		continuouslyMonitor(false, linksMap, links, uploads, enterBootloaderModes, exitBootloaderModes, midiAccess)
		return
	}
	logClose()

	if (firstRun) {
		logOpenCollapsed('Sync with initial state')
		try {
			syncWithRawState(localStorage.getItem('_qbmidi_links_'), linksMap, links, midiAccess)
		} catch (error) {
			log(error)
		}
		logClose()
	}

	logOpen('Find dead links')
	let removedLinks
	try {
		removedLinks = await findDeadLinks(links, midiAccess)
	} catch (error) {
		log(error)
		removedLinks = []
	}
	inPlaceArrayDiff(links, removedLinks)
	removedLinks.forEach(link => linksMap.delete(link))
	log('Removed links', removedLinks)
	saveLinksStateToLocalStorage(links)
	logClose()

	logOpen('Find new links')
	let foundLinks
	try {
		foundLinks = await findPossibleLinks(links, midiAccess)
	} catch (error) {
		log(error)
		foundLinks = []
	}
	inPlaceArrayConcat(links, foundLinks)
	foundLinks.forEach(link => linksMap.set(link, link))
	log('Found links', foundLinks)
	saveLinksStateToLocalStorage(links)
	logClose()

	log('Current links', links)

	logOpen('Update links info (if needed)')
	try {
		await updateLinksInfoIfNeeded(links)
	} catch (error) {
		log(error)
	}
	saveLinksStateToLocalStorage(links)
	logClose()

	logOpen('Handle pending enter bootloader mode')
	try {
		await handlePendingEnterBootloaderModes(links, enterBootloaderModes, midiAccess)
	} catch (error) {
		log(error)
	}
	logClose()

	logOpen('Handle pending exit bootloader mode')
	try {
		await handlePendingExitBootloaderModes(links, exitBootloaderModes, midiAccess)
	} catch (error) {
		log(error)
	}
	logClose()

	logOpen('Handle pending uploads')
	try {
		await handlePendingUploads(links, uploads, midiAccess)
	} catch (error) {
		log(error)
	}
	logClose()

	logOpenCollapsed('Save state to localStorage')
	const state = links.map(link => ({
		...link,
		input  : link.input.id,
		output : link.output.id,
	}))
	localStorage.setItem('_qbmidi_links_', JSON.stringify(state))
	log('State', state)
	logClose()

	logOpenCollapsed('Unlock Thread')
	try {
		await unlockThread(runtimeId)
		log('Thread unlocked', runtimeId)
	} catch (error) {
		logClose(true)
		log('Error trying to unlock thread', error)
		await delay(200 + (Math.random() * 100))
		continuouslyMonitor(false, linksMap, links, uploads, enterBootloaderModes, exitBootloaderModes, midiAccess)
		return
	}
	logClose()

	logClose(true)
	await delay(1000)

	if (removedLinks.length) {
		log('%cQuirkbots removed', 'color:orange', removedLinks)
	}
	if (foundLinks.length) {
		log('%cQuirkbots found', 'color:green', foundLinks)
	}
	continuouslyMonitor(false, linksMap, links, uploads, enterBootloaderModes, exitBootloaderModes, midiAccess)
}

async function handlePendingUploads(links, uploads, midiAccess) {
	// Handle only one upload at the time
	const upload = uploads[0]
	if (upload) {
		await handleSinglePendingUpload(links, upload, uploads, midiAccess)
	}
}

async function handleSinglePendingUpload(links, upload, uploads, midiAccess) {
	logOpen('Upload')
	upload.link.uploading = true
	saveLinksStateToLocalStorage(links)
	try {
		await uploadHexToSingleLink(
			upload.link,
			upload.hexString,
			midiAccess,
			() => saveLinksStateToLocalStorage(links)
		)
		log('%cSuccess', 'color:green')
	} catch (error) {
		log('%cUpload error', 'color:red', error)
		upload.error = error
	}
	upload.link.uploading = false
	uploads.splice(uploads.indexOf(upload), 1)
	saveLinksStateToLocalStorage(links)
	logClose()
}

async function handlePendingEnterBootloaderModes(links, requests, midiAccess) {
	// Handle only one request at the time
	const request = requests[0]
	if (request) {
		await handleSinglePendingEnterBootloaderMode(links, request, requests, midiAccess)
	}
}

async function handleSinglePendingEnterBootloaderMode(links, request, requests, midiAccess) {
	logOpen('Enter Bootloader Mode')
	request.link.enteringBootloaderMode = true
	saveLinksStateToLocalStorage(links)
	try {
		await guaranteeSingleLinkEnterBootloaderMode(request.link, midiAccess)
		log('%cSuccess', 'color:green')
	} catch (error) {
		log('%cEnter Bootloader error', 'color:red', error)
		request.error = error
	}
	request.link.enteringBootloaderMode = false
	requests.splice(requests.indexOf(request), 1)
	saveLinksStateToLocalStorage(links)
	logClose()
}

async function handlePendingExitBootloaderModes(links, requests, midiAccess) {
	// Handle only one request at the time
	const request = requests[0]
	if (request) {
		await handleSinglePendingExitBootloaderMode(links, request, requests, midiAccess)
	}
}

async function handleSinglePendingExitBootloaderMode(links, request, requests, midiAccess) {
	logOpen('Exit Bootloader Mode')
	request.link.exitingBootloaderMode = true
	saveLinksStateToLocalStorage(links)
	try {
		await guaranteeSingleLinkExitBootloaderMode(request.link, midiAccess)
		log('%cSuccess', 'color:green')
	} catch (error) {
		log('%Exit Bootloader error', 'color:red', error)
		request.error = error
	}
	request.link.exitingBootloaderMode = false
	requests.splice(requests.indexOf(request), 1)
	saveLinksStateToLocalStorage(links)
	logClose()
}

// Syncronize with other tabs
function handleStateChange({ key, newValue }) {
	if (key !== '_qbmidi_links_') {
		return
	}
	syncWithRawState(newValue, mainLinksMap, mainLinks, mainMidiAccess)
}

function syncWithRawState(rawState, linksMap, links, midiAccess) {
	logOpenCollapsed('Sync with state')
	let state
	try {
		state = JSON.parse(rawState)
	} catch (error) {
		log('Error trying parse raw state', error)
		logClose()
		return
	}
	if (!state) {
		log('State is empty')
		logClose()
		return
	}
	log('State', state)
	const {
		updatedLinks,
		foundLinks,
		removedLinks,
	} = syncLinksWithState(links, state, midiAccess)

	// update the maps
	foundLinks.forEach(link => linksMap.set(link, link))
	removedLinks.forEach(link => linksMap.delete(link))

	if (updatedLinks.length) {
		log('%cQuirkbots updated', 'color:blue', updatedLinks)
	}
	if (removedLinks.length) {
		log('%cQuirkbots removed', 'color:orange', removedLinks)
	}
	if (foundLinks.length) {
		log('%cQuirkbots found', 'color:green', foundLinks)
	}
	logClose()
}
