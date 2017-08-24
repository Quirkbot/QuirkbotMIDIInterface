export const getMIDIAccess = () => new Promise((resolve, reject) => {
	try {
		window.navigator.requestMIDIAccess({ sysex : false })
		.then(
			access => {
				if (!access) {
					reject('No MIDI access was provided')
					return
				}
				resolve(access)
			},
			reject
		)
	} catch (error) {
		reject(error)
	}
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

export const sendMIDItoOutput = (output, c, b1, b2) => {
	if (output.state !== 'connected') {
		throw new Error('Output is not connected', output)
	}
	output.send(toMIDI([c, b1, b2]))
}

export const filterValidConnections = map => {
	const converted = []
	map.forEach(o => converted.push(o))
	return converted
		.filter(o => o.name === 'Quirkbot')
		.filter(o => o.state === 'connected')
}
