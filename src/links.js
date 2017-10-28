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
	logOpenCollapsed,
	logClose,
} from './log'

import {
	filterValidConnections
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
	inputs.forEach(input => input.open())
	log('Valid inputs', inputs)

	const outputs = arrayDiff(
		filterValidConnections(midiAccess.outputs),
		links.map(link => link.output)
	)
	outputs.forEach(output => output.open())
	log('Valid outputs', outputs)

	// Pair all inputs with all outputs, in order to figure out which ones
	// match each other
	const possibleLinks = outputs.reduce((stash, output) =>
		stash.concat(inputs.map(input => (
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
	invalidInputs.forEach(input => input.close())

	const invalidOutputs = arrayDiff(
		outputs,
		newLinks.map(link => link.output)
	)
	invalidOutputs.forEach(output => output.close())

	// Finally, return the new links
	return newLinks
}

export async function findPossibleLinksByNaivePairing(links, midiAccess) {
	// Get the valid connections that currently do not belong to any link
	const inputs = arrayDiff(
		filterValidConnections(midiAccess.inputs),
		links.map(link => link.input)
	)
	inputs.forEach(input => input.open())
	log('Valid inputs', inputs)

	const outputs = arrayDiff(
		filterValidConnections(midiAccess.outputs),
		links.map(link => link.output)
	)
	outputs.forEach(output => output.open())
	log('Valid outputs', outputs)

	// The only way we can assume with some confidence there is a link, is if
	// there is a single input and a single output
	const newLinks = []
	if (inputs.length === 1 && outputs.length === 1) {
		newLinks.push(createNewLink({
			input  : inputs[0],
			output : outputs[0],
			method : 'naive pairing'
		}))
	}

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
