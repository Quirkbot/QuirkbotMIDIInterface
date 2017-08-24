import {
	inPlaceArrayDiff,
	inPlaceArrayConcat,
	delay
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
	lockThread,
	unlockThread,
} from './mutex'

import {
	findDeadLinks,
	findPossibleLinks,
} from './links'

import {
	uploadHexToSingleLink
} from './singleLink'

/**
 * Globals
 **/
const mainLinks = []
const pendingUploads = []

export async function init() {
	disableLogs()
	try {
		continuouslyMonitor(
			mainLinks,
			pendingUploads,
			await getMIDIAccess()
		)
	} catch (error) {
		log(error)
	}
}

export const getLinks = () => mainLinks

export const getLinkByUuid = uuid => mainLinks.filter(l => l.uuid === uuid).pop()

export const verbose = value => {
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
	while (pendingUploads.includes(pendingUpload)) {
		await delay(100)
	}
	if (pendingUpload.error) {
		throw pendingUpload.error
	}
	return pendingUpload.link
}

async function continuouslyMonitor(links, uploads, midiAccess) {
	const runtimeId = (Math.random() * 100000000000).toFixed(0)
	logOpenCollapsed(`Monitor - Runtime ID: ${runtimeId}`)

	if (document.hidden) {
		log('Tab is not visible. Stopping task.')
		logClose(true)
		await delay(200 + (Math.random() * 100))
		continuouslyMonitor(links, uploads, midiAccess)
		return
	}

	logOpen('Lock Thread')
	try {
		await guaranteeLockThread(runtimeId)
		log('Thread locked', runtimeId)
	} catch (error) {
		log(`Error trying to lock thread ${runtimeId}`, error)
		logClose(true)
		await delay(200 + (Math.random() * 100))
		continuouslyMonitor(links, uploads, midiAccess)
		return
	}
	logClose()

	logOpen('Find dead links')
	let removedLinks
	try {
		removedLinks = await findDeadLinks(links, midiAccess)
	} catch (error) {
		console.log(error)
		removedLinks = []
	}
	inPlaceArrayDiff(links, removedLinks)
	logClose()

	logOpen('Find new links')
	let foundLinks
	try {
		foundLinks = await findPossibleLinks(links, midiAccess)
	} catch (error) {
		console.log(error)
		foundLinks = []
	}
	logClose()

	inPlaceArrayConcat(links, foundLinks)

	logOpen('Handle pending uploads')
	try {
		await handlePendingUploads(uploads, midiAccess)
	} catch (error) {
		console.log(error)
	}
	logClose()

	log('Links', links)

	logOpen('Unlock Thread')
	try {
		await unlockThread(runtimeId)
		log('Thread unlocked', runtimeId)
	} catch (error) {
		logClose(true)
		log('Error trying to unlock thread', error)
		await delay(200 + (Math.random() * 100))
		continuouslyMonitor(links, uploads, midiAccess)
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
	continuouslyMonitor(links, uploads, midiAccess)
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
