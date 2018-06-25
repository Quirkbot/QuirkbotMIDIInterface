import {
	testSingleLinkConnectionByMessageEcho,
	setSingleLinkUuid,
	setSingleLinkBootloaderStatus,
	setSingleLinkMidiEnabledStatus,
	updateSingleLinkInfo,
	updateSingleLinkInfoIfNeeded,
	createNewLink
} from './singleLink'

import {
	log,
	logOpen,
	logClose,
} from './log'

import {
	filterValidConnections,
	getMIDIInputs,
	getMIDIOutputs,
	openMIDIPort,
	closeMIDIPort
} from './midi'

import {
	arrayDiff,
	inPlaceArrayDiff,
	asyncSafeWhile
} from './utils'

export async function findDeadLinks(links, midiAccess) {
	const inputs = filterValidConnections(getMIDIInputs(midiAccess))
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
		filterValidConnections(getMIDIInputs(midiAccess)),
		links.map(link => link.input)
	)
	inputs.forEach(openMIDIPort)
	log('Valid inputs', inputs)

	const outputs = arrayDiff(
		filterValidConnections(getMIDIOutputs(midiAccess)),
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
	await asyncSafeWhile(
		async () => possibleLinks.length,
		async () => {
			const link = possibleLinks.pop()
			const connected = await testSingleLinkConnectionByMessageEcho(link)
			if (connected) {
				// add the newly found link
				newLinks.push(link)
				// and remove the possible links that contain either the current
				// input or output
				for (let i = possibleLinks.length - 1; i >= 0; i--) {
					const possibleLink = possibleLinks[i]
					if (possibleLink.input === link.input || possibleLink.output === link.output) {
						possibleLinks.splice(i, 1)
					}
				}
			}
		}
	)

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
		filterValidConnections(getMIDIInputs(midiAccess)),
		links.map(link => link.input)
	)
	inputs.forEach(openMIDIPort)
	log('Valid inputs', inputs)

	const outputs = arrayDiff(
		filterValidConnections(getMIDIOutputs(midiAccess)),
		links.map(link => link.output)
	)
	outputs.forEach(openMIDIPort)
	log('Valid outputs', outputs)

	const newLinks = []
	const refInputs = inputs
	const refOutputs = outputs

	await asyncSafeWhile(
		async () => refInputs.length && refOutputs.length,
		async () => {
			// If there are only one link and only one output, we can pair them
			// with confidence and exit
			if (refInputs.length === 1 && refOutputs.length === 1) {
				const input = refInputs[0]
				const output = refOutputs[0]
				inPlaceArrayDiff(refInputs, [input])
				inPlaceArrayDiff(refOutputs, [output])
				newLinks.push(createNewLink({
					input,
					output,
					method : 'naive pairing - single device'
				}))
				return
			}

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
			const inputsByVersion = refInputs.reduce(reducePort, {})
			const outputsByVersion = refOutputs.reduce(reducePort, {})

			// If there is only one input and one output in the same version, we
			// pair them together
			Object.keys(inputsByVersion).forEach(version => {
				if (inputsByVersion[version].length !== 1 || outputsByVersion[version].length !== 1) {
					return
				}
				const input = inputsByVersion[version][0]
				const output = outputsByVersion[version][0]
				inPlaceArrayDiff(refInputs, [input])
				inPlaceArrayDiff(refOutputs, [output])
				newLinks.push(createNewLink({
					input,
					output,
					method : 'naive pairing - version'
				}))
			})

			// Check if we were able to pair all the inputs. In case all are
			// paired, exit. In case there is only one from each, also exit and
			// they will be taken care of by the next while iteration.
			// But in case there are still more than one from each, we need to
			// try to pair them some other way...
			if (refInputs.length < 2 || refOutputs.length < 2) {
				return
			}

			// If we got this far an still cant pair them, give up
			inPlaceArrayDiff(refInputs, refInputs)
			inPlaceArrayDiff(refOutputs, refOutputs)
		},
		() => log('findPossibleLinksByNaivePairing got stuck'),
		600
	)


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

export async function updateLinksInfo(links) {
	await Promise.all(links.map(updateSingleLinkInfo))
}

export async function updateLinksInfoIfNeeded(links) {
	await Promise.all(links.map(updateSingleLinkInfoIfNeeded))
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

// export async function filterLinksRunningProgram(links) {
// 	return links.filter(link => link.uuid.indexOf('QB0') === 0)
// }

// export async function filterLinksOnBootloaderMode(links) {
// 	return links.filter(link => link.bootloader)
// }
