let globalAccess

export const getMIDIAccess = () => new Promise((resolve, reject) => {
	if (globalAccess) {
		resolve(globalAccess)
		return
	}
	const timeout = setTimeout(
		() => {
			reject(new Error('Timeout requesting MIDI access'))
		},
		3000
	)
	navigator.requestMIDIAccess({ sysex : false })
		.then(access => {
			clearTimeout(timeout)
			if (!access) {
				reject(new Error('No MIDI access was provided'))
				return null
			}
			globalAccess = access
			return access
		})
		.then(resolve)
		.catch(reject)
})

export const toMIDI = payload => {
	if (payload.length < 3) {
		throw new Error('Payload needs to have 3 items')
	}
	const command = payload[0] || 0
	const byte1 = payload[1] || 0
	const byte2 = payload[2] || 0
	if (command > 16) {
		throw new Error('command is grather then 16')
	}
	if (byte1 > 255) {
		throw new Error('byte1 is grather then 255')
	}
	if (byte2 > 255) {
		throw new Error('byte2 is grather then 255')
	}

	/* eslint-disable no-bitwise */
	// Concatenate all numbers together (4 bits) + (8 bits) + (8 bits)
	const bits = (command << 16) + (byte1 << 8) + byte2

	// Break them into 3 midi bytes (7 bits) + (7 bits) + (7 bits);
	const a = (bits >> 14) + 0x80
	const b = (bits >> 7) & 0x7F
	const c = bits & 0x7F
	/* eslint-enable no-bitwise */

	return [a, b, c]
}

export const fromMIDI = payload => {
	const a = payload[0] || 0
	const b = payload[1] || 0
	const c = payload[2] || 0

	/* eslint-disable no-bitwise */
	let command = a
	command = (command - 0x80) >> 2

	let byte1 = (a & 0x3) << 6
	byte1 += (b >> 1)

	let byte2 = (b & 0x1) << 7
	byte2 += c
	/* eslint-disable no-bitwise */

	return [command, byte1, byte2]
}

export const getMIDIInputs = midiAccess => midiAccess.inputs

export const getMIDIOutputs = midiAccess => midiAccess.outputs

export const getMIDIInputById = (id, midiAccess) => {
	const converted = []
	midiAccess.inputs.forEach(o => converted.push(o))
	return converted.filter(i => i.id === id).pop()
}

export const getMIDIOutputById = (id, midiAccess) => {
	const converted = []
	midiAccess.outputs.forEach(o => converted.push(o))
	return converted.filter(i => i.id === id).pop()
}

const MIDIMessageListenerMap = new Map()
export const addMIDIMessageListenerToInput = (input, fn) => {
	let handle = MIDIMessageListenerMap.get(input)
	if (!handle) {
		const listeners = new Map()
		const process = evt => {
			listeners.forEach(listener => listener(evt))
		}
		input.onmidimessage = process
		handle = { listeners, process }
		MIDIMessageListenerMap.set(input, handle)
	}

	if (!handle.listeners.has(fn)) {
		handle.listeners.set(fn, fn)
	}
}

export const removeMIDIMessageListenerFromInput = (input, fn) => {
	const handle = MIDIMessageListenerMap.get(input)
	if (!handle) {
		return
	}

	if (handle.listeners.has(fn)) {
		handle.listeners.delete(fn)
	}
	if (!handle.listeners.size) {
		MIDIMessageListenerMap.delete(input)
		input.onmidimessage = null
	}
}

export const openMIDIPort = port => {
	port.open()
}

export const closeMIDIPort = port => {
	port.close()
}

export async function sendMIDIToOutput(output, c, b1, b2, timestamp = 0) {
	if (output.state !== 'connected') {
		throw new Error('Output is not connected', output)
	}
	output.send(toMIDI([c, b1, b2]), timestamp)
}

export const filterValidConnections = map => {
	const converted = []
	map.forEach(o => converted.push(o))
	return converted
		.filter(o =>
			o.manufacturer.indexOf('Quirkbot') !== -1 ||
			o.name.indexOf('Quirkbot') !== -1
		)
		.filter(o => o.state === 'connected')
}
