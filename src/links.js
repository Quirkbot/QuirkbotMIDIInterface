import {
	testSingleLinkConnectionByMessageEcho,
	setSingleLinkUuid,
	setSingleLinkBootloaderStatus,
	setSingleLinkMidiEnabledStatus,
	createNewLink
} from './singleLink'

import {
	log,
	logOpen,
	logClose,
} from './log'

import {
	filterValidConnections,
	openMIDIPort,
	closeMIDIPort
} from './midi'

import {
	arrayDiff
} from './utils'

export async function findDeadLinks(links, midiAccess) {
	const inputs = filterValidConnections(midiAccess.inputs)
	log('Current inputs', inputs)
	return links.filter(link => !inputs.filter(input => link.input === input).length)
}

export async function findPossibleLinks(links, midiAccess) {
	// First try to find the links by the "message echo" technique
	logOpen('Finding links by "message echo"')
	const messageEchoLinks = await findPossibleLinksByMessageEcho(
		links, midiAccess
	)
	log('Found links', messageEchoLinks)
	logClose()

	// It was observed that sometimes (Mac) the input.onimidimessage was not
	// being fired when the board is on bootloader mode, so the "message echo"
	// is not fully realible. We procceed to try to find links with a more
	// insecure approach, but that at least give us something on these cases.
	logOpen('Finding links by "naive pairing"')
	const naivePairingLinks = await findPossibleLinksByNaivePairing(
		links.concat(messageEchoLinks), midiAccess
	)
	log('Found links', naivePairingLinks)
	logClose()

	// Merge the new links
	const newLinks = messageEchoLinks.concat(naivePairingLinks)

	// Discover if they are on bootloader mode, uuid, etc
	await setLinksUuid(newLinks)
	await setLinksBootloaderStatus(newLinks)
	await setLinksMidiEnabledStatus(newLinks)

	return newLinks
}

export async function findPossibleLinksByMessageEcho(links, midiAccess) {
	// Get the valid connections that currently do not belong to any link
	const inputs = arrayDiff(
		filterValidConnections(midiAccess.inputs),
		links.map(link => link.input)
	)
	inputs.forEach(openMIDIPort)
	log('Valid inputs', inputs)

	const outputs = arrayDiff(
		filterValidConnections(midiAccess.outputs),
		links.map(link => link.output)
	)
	outputs.forEach(openMIDIPort)
	log('Valid outputs', outputs)

	// Pair all inputs with all outputs, in order to figure out which ones
	// match each other
	const possibleLinks = outputs.reduce((acc, output) =>
		acc.concat(inputs.map(input => (
			createNewLink({
				input,
				output,
				method : 'message echo'
			})
		))), []
	)
	// Find the links by sending a message to the output and checking if the
	// input responds with the same message
	const newLinks = []
	for (let i = 0; i < possibleLinks.length; i++) {
		const link = possibleLinks[i]
		const connected = await testSingleLinkConnectionByMessageEcho(link)
		if (connected) {
			newLinks.push(link)
		}
	}

	// Close the invalid connections
	const invalidInputs = arrayDiff(
		inputs,
		newLinks.map(link => link.input)
	)
	invalidInputs.forEach(closeMIDIPort)

	const invalidOutputs = arrayDiff(
		outputs,
		newLinks.map(link => link.output)
	)
	invalidOutputs.forEach(closeMIDIPort)

	// Finally, return the new links
	return newLinks
}

export async function findPossibleLinksByNaivePairing(links, midiAccess) {
	// Get the valid connections that currently do not belong to any link
	const inputs = arrayDiff(
		filterValidConnections(midiAccess.inputs),
		links.map(link => link.input)
	)
	inputs.forEach(openMIDIPort)
	log('Valid inputs', inputs)

	const outputs = arrayDiff(
		filterValidConnections(midiAccess.outputs),
		links.map(link => link.output)
	)
	outputs.forEach(openMIDIPort)
	log('Valid outputs', outputs)

	// The only way we can assume with some confidence there is a link, is if
	// there is a single input and a single output
	const newLinks = []
	if (inputs.length === 1 && outputs.length === 1) {
		newLinks.push(createNewLink({
			input  : inputs[0],
			output : outputs[0],
			method : 'naive pairing - single device'
		}))
	} else {
		// If there are more than one link, we need to get creative on how to
		// pair them...

		// It seems that on mac, an input/output from the same device will have
		// the same "version". So check if we can pair them by version
		const reducePort = (acc, port) => {
			if (!port) {
				return acc
			}
			const version = port.version || '_'
			if (typeof acc[version] === 'undefined') {
				acc[version] = []
			}
			acc[version].push(port)
			return acc
		}
		const inputsByVersion = inputs.reduce(reducePort, {})
		const outputsByVersion = outputs.reduce(reducePort, {})

		// If there is only one input and one output in the same version, we
		// pair them together
		Object.keys(inputsByVersion).forEach(version => {
			if (inputsByVersion[version].length !== 1 || outputsByVersion[version].length !== 1) {
				return
			}
			const input = inputsByVersion[version][0]
			const output = outputsByVersion[version][0]
			newLinks.push(createNewLink({
				input,
				output,
				method : 'naive pairing - version'
			}))
		})
	}

	// Close the invalid connections
	const invalidInputs = arrayDiff(
		inputs,
		newLinks.map(link => link.input)
	)
	invalidInputs.forEach(closeMIDIPort)

	const invalidOutputs = arrayDiff(
		outputs,
		newLinks.map(link => link.output)
	)
	invalidOutputs.forEach(closeMIDIPort)

	// Finally return the new links
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
