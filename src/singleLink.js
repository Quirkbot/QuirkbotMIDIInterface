import {
	arrayDiff,
	arrayMedian,
	delay,
	pad,
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
	sendMIDItoOutput,
	filterValidConnections
} from './midi'

import {
	MIDI_COMMANDS,
	PAGE_SIZE
} from './constants'

export async function testSingleLinkConnection(link) {
	let connected = false
	const key1 = Math.floor(Math.random() * 256)
	const key2 = Math.floor(Math.random() * 256)
	const fn = e => {
		const message = fromMIDI(e.data)
		if (message[1] === key1 && message[2] === key2) {
			connected = true
		}
	}
	link.input.addEventListener('midimessage', fn)
	sendMIDItoOutput(link.output, MIDI_COMMANDS.Sync, key1, key2)
	await delay(30)
	link.input.removeEventListener('midimessage', fn)
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
	link.input.addEventListener('midimessage', fn)
	sendMIDItoOutput(link.output, MIDI_COMMANDS.ReadUUID)
	await delay(10)
	link.input.removeEventListener('midimessage', fn)
	while (uuid.length > 16) {
		uuid = uuid.slice(0, -1)
	}
	return uuid
}

export async function aquireSingleLinkUuidWithConfidence(link) {
	const uuids = []
	logOpenCollapsed('Aquiring uuids')
	for (let i = 0; i < 100; i++) {
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
	link.input.addEventListener('midimessage', fn)
	sendMIDItoOutput(link.output, MIDI_COMMANDS.ReadUUID)
	await delay(3)
	link.input.removeEventListener('midimessage', fn)
	log('Bootloader status:', bootloaderStatus)
	return bootloaderStatus
}

export async function aquireSingleLinkBootloaderStatusWithConfidence(link) {
	const bootloaderStatuses = []
	logOpenCollapsed('Aquiring bootloader status')
	for (let i = 0; i < 20; i++) {
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

export async function uploadHexToSingleLink(link, hexString, midiAccess) {
	logOpen('Guarantee bootloader')
	await guaranteeSingleLinkBootloaderMode(link, midiAccess)
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

	await setSingleLinkUuid(link)
	await setSingleLinkBootloaderStatus(link)
	await setSingleLinkMidiEnabledStatus(link)
}

export async function guaranteeSingleLinkBootloaderMode(link, midiAccess) {
	if (!await aquireSingleLinkBootloaderStatusWithConfidence(link)) {
		logOpen('Enter bootloader mode')
		await enterSingleLinkBootloaderMode(link, midiAccess)
		logClose()
		logOpen('Confirm bootloader mode')
		await setSingleLinkBootloaderStatus(link)
		if (!link.bootloader) {
			throw new Error('Could not confirm that board is on bootloader mode.')
		}
		logClose()
	} else {
		log('Already on bootloader mode')
	}
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
	sendMIDItoOutput(link.output, bootloader ? MIDI_COMMANDS.EnterBootloader : MIDI_COMMANDS.ExitBootloader)

	// Wait for the connection disapear, and a new one to appear
	logOpenCollapsed('Wait connections to appear/disapear')
	const connectionHistory = await Promise.all([
		waitForSingleLinkConnectionToDisapear(link, midiAccess),
		waitForSingleLinkConnectionToAppear(link, midiAccess)
	])
	log('Removed connections', connectionHistory[0])
	log('Added connections', connectionHistory[1])
	logClose()

	// Update the link connections
	link.input = connectionHistory[1].input
	link.output = connectionHistory[1].output
}

export async function waitForSingleLinkConnectionToDisapear(link, midiAccess) {
	const originalInputs = [link.input]
	const originalOutputs = [link.output]
	let tries = 0
	let input = null
	let output = null
	while (tries < 100 && !input && !output) {
		logOpen('Disapear try', tries)
		log('Original inputs', originalInputs)
		log('Original outputs', originalOutputs)

		const currentInputs = filterValidConnections(midiAccess.inputs)
		input = input || arrayDiff(
			originalInputs,
			currentInputs
		).shift()
		log('Current inputs', currentInputs)

		const currentOutputs = filterValidConnections(midiAccess.outputs)
		output = output || arrayDiff(
			originalOutputs,
			currentOutputs
		).shift()
		log('Current outputs', currentOutputs)

		logClose()

		tries++
		await delay(100)
	}

	if (!output) {
		throw new Error('Output never disapeared.')
	}
	if (!input) {
		throw new Error('Input never disapeared.')
	}
	return {
		input  : link.input,
		output : link.output
	}
}

export async function waitForSingleLinkConnectionToAppear(link, midiAccess) {
	const originalInputs = filterValidConnections(midiAccess.inputs)
	const originalOutputs = filterValidConnections(midiAccess.outputs)

	let tries = 0
	let input = null
	let output = null
	while (tries < 100 && !input && !output) {
		logOpen('Appear try', tries)
		log('Original inputs', originalInputs)
		log('Original outputs', originalOutputs)

		const currentInputs = filterValidConnections(midiAccess.inputs)
		input = input || arrayDiff(
			currentInputs,
			originalInputs
		).shift()
		log('Current inputs', currentInputs)

		const currentOutputs = filterValidConnections(midiAccess.outputs)
		output = output || arrayDiff(
			currentOutputs,
			originalOutputs
		).shift()
		log('Current outputs', currentOutputs)

		logClose()

		tries++
		await delay(100)
	}

	if (!output) {
		throw new Error('Output never appeared.')
	}
	link.output = output

	if (!input) {
		throw new Error('Input never appeared.')
	}
	link.input = input
	return {
		input,
		output
	}
}

export async function sendFirmwareToSingleLinkWithConfidence(link, data) {
	// Test if link is connected
	let connected = await testSingleLinkConnection(link)
	log('Test link connection, before', connected)
	if (!connected) {
		throw new Error('Link is not connected')
	}

	// Send the data
	await sendFirmwareToSingleLink(link, data)

	// Test if the link is still connected
	await delay(30)
	connected = await testSingleLinkConnection(link)
	log('Test link connection, after', connected)
	if (!connected) {
		throw new Error('Link is not connected')
	}
}

export async function sendFirmwareToSingleLink(link, data) {
	log('Send StartFirmware command', 'Total bytes', data.length)
	sendMIDItoOutput(link.output, MIDI_COMMANDS.StartFirmware)
	logOpenCollapsed('Data')
	for (let i = 0; i < data.length; i += 2) {
		log('Send Data command', data[i], data[i + 1])
		sendMIDItoOutput(link.output, MIDI_COMMANDS.Data, data[i], data[i + 1])
		if ((i % 1000) === 0) {
			log('Delay')
			await delay(10)
		}
	}
	logClose()
}
