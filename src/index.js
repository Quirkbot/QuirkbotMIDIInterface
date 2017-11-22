import {
	inPlaceArrayDiff,
	inPlaceArrayConcat,
	delay,
	asyncSafeWhile
} from './utils'

import {
	log,
	logOpen,
	logOpenCollapsed,
	logClose,
	enableLogs,
	disableLogs
} from './log'

import {
	getMIDIAccess
} from './midi'
import {
	guaranteeLockThread,
	unlockThread,
} from './mutex'

import {
	findDeadLinks,
	findPossibleLinks,
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

export async function init() {
	try {
		continuouslyMonitor(
			mainLinksMap,
			mainLinks,
			pendingUploads,
			pendingEnterBootloaderMode,
			pendingExitBootloaderMode,
			await getMIDIAccess()
		)
	} catch (error) {
		log(error)
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

export function verbose(value) {
	if (value) {
		return enableLogs()
	}
	return disableLogs()
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

async function continuouslyMonitor(linksMap, links, uploads, enterBootloaderModes, exitBootloaderModes, midiAccess) {
	const runtimeId = (Math.random() * 100000000000).toFixed(0)
	logOpenCollapsed(`Monitor - Runtime ID: ${runtimeId}`)

	if (typeof document !== 'undefined' && document.hidden) {
		log('Tab is not visible. Stopping task.')
		logClose(true)
		await delay(200 + (Math.random() * 100))
		continuouslyMonitor(linksMap, links, uploads, enterBootloaderModes, exitBootloaderModes, midiAccess)
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
		continuouslyMonitor(linksMap, links, uploads, enterBootloaderModes, exitBootloaderModes, midiAccess)
		return
	}
	logClose()

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
	logClose()

	log('Links', links)

	logOpen('Handle pending enter bootloader mode')
	try {
		await handlePendingEnterBootloaderModes(enterBootloaderModes, midiAccess)
	} catch (error) {
		log(error)
	}
	logClose()

	logOpen('Handle pending exit bootloader mode')
	try {
		await handlePendingExitBootloaderModes(exitBootloaderModes, midiAccess)
	} catch (error) {
		log(error)
	}
	logClose()

	logOpen('Handle pending uploads')
	try {
		await handlePendingUploads(uploads, midiAccess)
	} catch (error) {
		log(error)
	}
	logClose()

	logOpenCollapsed('Unlock Thread')
	try {
		await unlockThread(runtimeId)
		log('Thread unlocked', runtimeId)
	} catch (error) {
		logClose(true)
		log('Error trying to unlock thread', error)
		await delay(200 + (Math.random() * 100))
		continuouslyMonitor(linksMap, links, uploads, enterBootloaderModes, exitBootloaderModes, midiAccess)
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
	continuouslyMonitor(linksMap, links, uploads, enterBootloaderModes, exitBootloaderModes, midiAccess)
}

async function handlePendingUploads(uploads, midiAccess) {
	// Handle only one upload at the time
	const upload = uploads[0]
	if (upload) {
		await handleSinglePendingUpload(upload, uploads, midiAccess)
	}
}

async function handleSinglePendingUpload(upload, uploads, midiAccess) {
	logOpen('Upload')
	upload.link.uploading = true
	try {
		await uploadHexToSingleLink(upload.link, upload.hexString, midiAccess)
		log('%cSuccess', 'color:green')
	} catch (error) {
		log('%cUpload error', 'color:red', error)
		upload.error = error
	}
	upload.link.uploading = false
	logClose()
	uploads.splice(uploads.indexOf(upload), 1)
}

async function handlePendingEnterBootloaderModes(requests, midiAccess) {
	// Handle only one request at the time
	const request = requests[0]
	if (request) {
		await handleSinglePendingEnterBootloaderMode(request, requests, midiAccess)
	}
}

async function handleSinglePendingEnterBootloaderMode(request, requests, midiAccess) {
	logOpen('Enter Bootloader Mode')
	request.link.enteringBootloaderMode = true
	try {
		await guaranteeSingleLinkEnterBootloaderMode(request.link, midiAccess)
		log('%cSuccess', 'color:green')
	} catch (error) {
		log('%cEnter Bootloader error', 'color:red', error)
		request.error = error
	}
	request.link.enteringBootloaderMode = false
	logClose()
	requests.splice(requests.indexOf(request), 1)
}

async function handlePendingExitBootloaderModes(requests, midiAccess) {
	// Handle only one request at the time
	const request = requests[0]
	if (request) {
		await handleSinglePendingExitBootloaderMode(request, requests, midiAccess)
	}
}

async function handleSinglePendingExitBootloaderMode(request, requests, midiAccess) {
	logOpen('Exit Bootloader Mode')
	request.link.exitingBootloaderMode = true
	try {
		await guaranteeSingleLinkExitBootloaderMode(request.link, midiAccess)
		log('%cSuccess', 'color:green')
	} catch (error) {
		log('%Exit Bootloader error', 'color:red', error)
		request.error = error
	}
	request.link.exitingBootloaderMode = false
	logClose()
	requests.splice(requests.indexOf(request), 1)
}
