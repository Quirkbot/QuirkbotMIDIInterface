import {
	arrayDiff,
	arrayMedian,
	delay,
	pad,
	safeWhile,
	asyncSafeWhile,
	tryToExecute
} from './utils'

import {
	log,
	logOpen,
	logOpenCollapsed,
	logClose
} from './log'

import {
	parseIntelHex
} from './hex'

import {
	fromMIDI,
	getMIDIInputs,
	getMIDIOutputs,
	addMIDIMessageListenerToInput,
	removeMIDIMessageListenerFromInput,
	sendMIDIToOutput,
	scheduledSendMIDIToOutput,
	openMIDIPort,
	closeMIDIPort,
	filterValidConnections
} from './midi'

import {
	MIDI_COMMANDS,
	PAGE_SIZE
} from './constants'

let LINK_RUNTIME_ID_FACTORY = 0

export function createNewLink({ input, output, method }) {
	return {
		runtimeId : `${++LINK_RUNTIME_ID_FACTORY}-${Date.now()}`,
		updated   : Date.now(),
		input,
		output,
		method
	}
}

export async function sendAndReceiveMessageToSingleLink(link, message, onMessage, timeout = 0) {
	addMIDIMessageListenerToInput(link.input, onMessage)
	await sendMIDIToOutput(link.output, message[0], message[1], message[2])
	await delay(timeout)
	removeMIDIMessageListenerFromInput(link.input, onMessage)
}

export async function testSingleLinkConnectionByMessageEcho(link) {
	logOpenCollapsed('Testing single link by "message echo"')
	let connected = false
	const key1 = Math.floor(Math.random() * 256)
	const key2 = Math.floor(Math.random() * 256)
	const fn = e => {
		const message = fromMIDI(e.data)
		if (message[1] === key1 && message[2] === key2) {
			log(`Midi response received (expected ${key1}, ${key2})`, message[1], message[2])
			connected = true
		}
	}
	log(`Sending message: ${key1}, ${key2}`, link)
	try {
		await sendAndReceiveMessageToSingleLink(link, [MIDI_COMMANDS.Sync, key1, key2], fn, 30)
	} catch (e) {
		log('Failed to receive message', e)
	}

	if (!connected) {
		log(`Never received midi response (expected ${key1}, ${key2})`)
	}
	logClose()
	return connected
}

export async function aquireSingleLinkUuid(link) {
	let uuid = ''

	function char(code) {
		return code >= 0x30 ? String.fromCharCode(code) : '*'
	}
	const fn = e => {
		const message = fromMIDI(e.data)
		if (message[0] !== MIDI_COMMANDS.Data) {
			return
		}
		uuid += char(message[1]) + char(message[2])
	}
	await sendAndReceiveMessageToSingleLink(link, [MIDI_COMMANDS.ReadUUID], fn, 5)

	safeWhile(
		() => uuid.length < 16,
		() => uuid += '*',
		() => uuid = '****************'
	)

	safeWhile(
		() => uuid.length > 16,
		() => uuid = uuid.slice(0, -1)
	)

	return uuid
}

export async function aquireSingleLinkUuidWithConfidence(link) {
	const uuids = []
	logOpenCollapsed('Aquiring uuids')
	for (let i = 0; i < 50; i++) {
		uuids.push(await aquireSingleLinkUuid(link))
	}
	log('Raw uuids:', uuids)
	const parts = uuids
		.filter(uuid => uuid.length === 16)
		.reduce((a, uuid) => {
			uuid.split('').forEach((char, index) => a[index].push(char))
			return a
		}, [...Array(16)].map(() => []))
	const medianUuid = parts.map(s => arrayMedian(s)).join('')
	log('Median uuid', medianUuid)
	logClose()
	return medianUuid
}

export async function setSingleLinkUuid(link) {
	link.uuid = await aquireSingleLinkUuidWithConfidence(link)
}

export async function aquireSingleLinkBootloaderStatus(link) {
	let bootloaderStatus = true
	const fn = e => {
		const message = fromMIDI(e.data)
		if (message[0] === MIDI_COMMANDS.Data) {
			log('Data received. Cannot be on bootloader mode.')
			bootloaderStatus = false
		}
	}
	await sendAndReceiveMessageToSingleLink(link, [MIDI_COMMANDS.ReadUUID], fn, 10)
	log('Bootloader status:', bootloaderStatus)
	return bootloaderStatus
}

export async function aquireSingleLinkBootloaderStatusWithConfidence(link) {
	const bootloaderStatuses = []
	logOpenCollapsed('Aquiring bootloader status')
	for (let i = 0; i < 10; i++) {
		bootloaderStatuses.push(await aquireSingleLinkBootloaderStatus(link))
	}
	const medianBootloaderStatus = arrayMedian(bootloaderStatuses)
	log('Bootloader statuses:', bootloaderStatuses)
	log('Median Bootloader status:', medianBootloaderStatus)
	logClose()
	return medianBootloaderStatus
}

export async function setSingleLinkBootloaderStatus(link) {
	link.bootloader = await aquireSingleLinkBootloaderStatusWithConfidence(link)
}

export async function setSingleLinkMidiEnabledStatus(link) {
	// if we were able to detect bootloader, midi must be enabled
	if (link.bootloader) {
		link.midi = true
	} else {
		link.midi = link.uuid.indexOf('QB0') === 0
	}
}

export async function updateSingleLinkInfoIfNeeded(link) {
	// Dont update too frequently
	if (Date.now() - link.updated < 5000) {
		return
	}
	await updateSingleLinkInfo(link)
}

export async function updateSingleLinkInfo(link) {
	// If the current uuid is undefined, don't overwrite it, in case we have
	// one.
	const currentUuid = await aquireSingleLinkUuidWithConfidence(link)
	if (currentUuid !== '****************') {
		link.uuid = currentUuid
	}
	await setSingleLinkBootloaderStatus(link)
	await setSingleLinkMidiEnabledStatus(link)
	link.updated = Date.now()
}

export async function uploadHexToSingleLink(link, hexString, midiAccess) {
	logOpen('Guarantee bootloader')
	await guaranteeSingleLinkEnterBootloaderMode(link, midiAccess)
	logClose()

	logOpen('Send firmware')
	let data = []
	parseIntelHex(hexString).data.forEach(o => data.push(o))
	data = pad(data, PAGE_SIZE)
	await tryToExecute(() => sendFirmwareToSingleLinkWithConfidence(link, data), 10, 1000)
	logClose()

	logOpen('Exit bootloader')
	await exitSingleLinkBootloaderMode(link, midiAccess)
	logClose()

	await updateSingleLinkInfo(link)
}

export async function guaranteeSingleLinkExitBootloaderMode(link, midiAccess) {
	if (await aquireSingleLinkBootloaderStatusWithConfidence(link)) {
		logOpen('Exit bootloader mode')
		await exitSingleLinkBootloaderMode(link, midiAccess)
		logClose()
		logOpen('Confirm not on bootloader mode')
		// Add a delay before trying to confirm bootloader status, as Quirkbot
		// takes a few seconds to initialize (initial led blink animation), so
		// we dont get a false positive
		await delay(3000)
		await updateSingleLinkInfo(link)
		if (link.bootloader) {
			throw new Error('Could not confirm that board is not on bootloader mode.')
		}
		logClose()
	} else {
		log('Already not on bootloader mode')
	}
}

export async function guaranteeSingleLinkEnterBootloaderMode(link, midiAccess) {
	// Avoiding to check if the board is already on bootloader mode (what
	// enables us to quick exit this function) because its so much harder to
	// realibly detect if the board is on bootloader mode (the opposite is much
	// more realiable). So we will go ahead and force the board to go on
	// booloader mode anyway - if it already was, the process will work
	// regardless and will just be a little slower. OK compromise.
	logOpen('Enter bootloader mode')
	await enterSingleLinkBootloaderMode(link, midiAccess)
	logClose()
	logOpen('Confirm bootloader mode')
	await updateSingleLinkInfo(link)
	if (!link.bootloader) {
		throw new Error('Could not confirm that board is on bootloader mode.')
	}
	logClose()
}

export async function enterSingleLinkBootloaderMode(link, midiAccess) {
	await controlSingleLinkBootloaderMode(true, link, midiAccess)
}

export async function exitSingleLinkBootloaderMode(link, midiAccess) {
	await controlSingleLinkBootloaderMode(false, link, midiAccess)
}

export async function controlSingleLinkBootloaderMode(bootloader, link, midiAccess) {
	// Send the command for the board to enter/exit booloader mode
	log('Send midi command')
	await sendMIDIToOutput(link.output, bootloader ? MIDI_COMMANDS.EnterBootloader : MIDI_COMMANDS.ExitBootloader)
	closeMIDIPort(link.input)
	closeMIDIPort(link.output)

	// Wait for the connection disapear, and a new one to appear
	logOpenCollapsed('Wait connections to appear/disapear')
	let addedConections
	try {
		const connectionHistory = await Promise.all([
			waitForSingleLinkConnectionToAppear(link, midiAccess)
		])
		addedConections = connectionHistory.pop()
	} catch (e) {
		log('New connection never appeared, continuing with current', e)
		addedConections = {
			input  : link.input,
			output : link.output
		}
	}

	openMIDIPort(addedConections.input)
	openMIDIPort(addedConections.output)
	log('Added connections', addedConections)

	logClose()

	// Update the link connections
	link.input = addedConections.input
	link.output = addedConections.output
}

export async function waitForSingleLinkConnectionToAppear(link, midiAccess) {
	let lastInputs = filterValidConnections(getMIDIInputs(midiAccess))
	let lastOutputs = filterValidConnections(getMIDIOutputs(midiAccess))
	log('Original inputs', lastInputs)
	log('Original outputs', lastOutputs)

	let tries = 0
	let input = null
	let output = null

	await asyncSafeWhile(
		async () => tries < 40 && !input && !output,
		async () => {
			logOpen('Appear try', tries)

			const currentInputs = filterValidConnections(getMIDIInputs(midiAccess))
			input = input || arrayDiff(
				currentInputs,
				lastInputs
			).shift()
			lastInputs = currentInputs
			log('Current inputs', currentInputs)

			const currentOutputs = filterValidConnections(getMIDIOutputs(midiAccess))
			output = output || arrayDiff(
				currentOutputs,
				lastOutputs
			).shift()
			lastOutputs = currentOutputs
			log('Current outputs', currentOutputs)

			logClose()

			tries++
			await delay(100)
		}
	)

	if (!output) {
		log('NEVER appeared')
		throw new Error('Output never appeared.')
	}

	if (!input) {
		log('NEVER appeared')
		throw new Error('Input never appeared.')
	}
	// We got new inputs and outputs!
	log('appeared')
	return {
		input,
		output
	}
}

export async function sendFirmwareToSingleLinkWithConfidence(link, data) {
	// TODO: find a way to send data with confidence. As there is a problem
	// with Quirkbots on bootloader mode on Mac not firing onmidimessage, we
	// cannot rely the testSingleLinkConnectionByMessageEcho to determine if
	// the transmission is successfull

	// Test if link is connected
	let connected = await testSingleLinkConnectionByMessageEcho(link)
	log('Test link connection before upload', connected)
	if (!connected) {
		// throw new Error('Link is not connected')
		log('Link not connected before upload. Doing nothing...', connected)
	}

	// Send the data
	await sendFirmwareToSingleLink(link, data)

	// Test if the link is still connected
	await delay(30)
	connected = await testSingleLinkConnectionByMessageEcho(link)
	log('Test link connection, after upload', connected)
	if (!connected) {
		// throw new Error('Link is not connected')
		log('Link not connected after upload. Doing nothing...', connected)
	}
}

export async function sendFirmwareToSingleLink(link, data) {
	const totalBytes = data.length
	const speedRate = 8 // 4 empirically found best value
	const estimatedDuration = (totalBytes / speedRate) + 1000
	log('Send StartFirmware command', 'Total bytes', totalBytes)
	log('Transfer estimated duration', estimatedDuration)
	await sendMIDIToOutput(
		link.output,
		MIDI_COMMANDS.StartFirmware, 0, 0
	)
	const transferStartRef = window.performance.now() + 100
	//logOpenCollapsed('Data')
	try {
		for (let i = 0; i < data.length; i += 2) {
			//log('Send Data command', data[i], data[i + 1])
			sendMIDIToOutput(
				link.output,
				MIDI_COMMANDS.Data, data[i], data[i + 1],
				//transferStartRef + (i / speedRate)
			)
		}
	} catch (e) {
		// Catching this error here just to close the log, throw the error again
		// so the parent process can catch it.
		//logClose()
		throw e
	}
	//logClose()
	const remainingTime = estimatedDuration - (window.performance.now() - transferStartRef)
	log('Waiting remaining estimated time...', remainingTime)
	await delay(remainingTime)
	log('Transfer complete!')
}
