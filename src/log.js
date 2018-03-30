let count = 0
let enabled = false
let customHandler = null

export function setCustomLogHandler(handler) {
	customHandler = handler
}

export function enableLogs() {
	enabled = true
}

export function disableLogs() {
	enabled = false
}

export function log(...args) {
	if (!enabled) {
		return
	}
	if (customHandler) {
		customHandler({ type : 'log', args })
	} else {
		// eslint-disable-next-line no-console
		console.log.apply(null, args)
	}
}

export function logError(...args) {
	if (!enabled) {
		return
	}
	if (customHandler) {
		customHandler({ type : 'error', args })
	} else {
		// eslint-disable-next-line no-console
		console.error.apply(null, args)
	}
}

export function logOpen(...args) {
	if (!enabled) {
		return
	}
	count++
	if (customHandler) {
		customHandler({ type : 'group', args })
	} else {
		// eslint-disable-next-line no-console
		console.group.apply(null, args)
	}
}

export function logOpenCollapsed(...args) {
	if (!enabled) {
		return
	}
	count++
	if (customHandler) {
		customHandler({ type : 'groupCollapsed', args })
	} else {
		// eslint-disable-next-line no-console
		console.groupCollapsed.apply(null, args)
	}
}

export function logClose(all) {
	const end = () => {
		count--
		if (customHandler) {
			customHandler({ type : 'groupEnd' })
		} else {
			// eslint-disable-next-line no-console
			console.groupEnd()
		}
	}
	end()
	if (all) {
		const cachedCount = count
		for (let i = 0; i < cachedCount; i++) {
			end()
		}
	}
}
