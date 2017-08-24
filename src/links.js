import {
	setSingleLinkUuid,
	setSingleLinkBootloaderStatus,
	setSingleLinkMidiEnabledStatus
} from './singleLink'

import {
	log
} from './log'

import {
	fromMIDI,
	sendMIDItoOutput,
	filterValidConnections
} from './midi'

import {
	arrayDiff,
	delay
} from './utils'

import {
	MIDI_COMMANDS
} from './constants'

export async function findDeadLinks(links, midiAccess) {
	const inputs = filterValidConnections(midiAccess.inputs)
	log('Current inputs', inputs)
	return links.filter(link => !inputs.filter(input => link.input === input).length)
}

export async function findPossibleLinks(links, midiAccess) {
	// Get the valid connections that currently do not belong to any link
	const inputs = arrayDiff(
		filterValidConnections(midiAccess.inputs),
		links.map(link => link.input)
	)
	const outputs = arrayDiff(
		filterValidConnections(midiAccess.outputs),
		links.map(link => link.output)
	)
	log('Valid inputs', inputs)
	log('Valid outputs', outputs)
	// Find the links
	const newLinks = []
	const fns = outputs.map(() => [])
	outputs.forEach((output, oi) => {
		const key1 = Math.floor(Math.random() * 256)
		const key2 = Math.floor(Math.random() * 256)
		fns[oi] = inputs.map(input => e => {
			const message = fromMIDI(e.data)
			log('Midi response received', input, message)
			if (message[1] === key1 && message[2] === key2) {
				newLinks.push({
					input,
					output
				})
			}
		})
		inputs.forEach((input, ii) => input.addEventListener('midimessage', fns[oi][ii]))
		log('Sending midi', output, MIDI_COMMANDS.Sync, key1, key2)
		sendMIDItoOutput(output, MIDI_COMMANDS.Sync, key1, key2)
	})
	await delay(30)
	outputs.forEach((output, oi) => {
		inputs.forEach((input, ii) => input.removeEventListener('midimessage', fns[oi][ii]))
	})

	// Discover if they are on bootloader mode, uuid, etc
	await setLinksUuid(newLinks)
	await setLinksBootloaderStatus(newLinks)
	await setLinksMidiEnabledStatus(newLinks)

	return newLinks
}

export async function setLinksUuid(links) {
	await Promise.all(links.map(setSingleLinkUuid))
}

export async function setLinksBootloaderStatus(links) {
	await Promise.all(links.map(setSingleLinkBootloaderStatus))
}

export async function setLinksMidiEnabledStatus(links) {
	await Promise.all(links.map(setSingleLinkMidiEnabledStatus))
}

export async function filterLinksRunningProgram(links) {
	return links.filter(link => link.uuid.indexOf('QB0') === 0)
}

export async function filterLinksOnBootloaderMode(links) {
	return links.filter(link => link.bootloader)
}
