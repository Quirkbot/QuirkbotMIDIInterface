let count = 0
let enabled = true

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
	console.log.apply(null, args)
}

export function logError(...args) {
	if (!enabled) {
		return
	}
	console.error.apply(null, args)
}

export function logOpen(...args) {
	if (!enabled) {
		return
	}
	count++
	console.group.apply(null, args)
}

export function logOpenCollapsed(...args) {
	if (!enabled) {
		return
	}
	count++
	console.groupCollapsed.apply(null, args)
}

export function logClose(all) {
	const end = () => {
		count--
		console.groupEnd()
	}
	end()
	if (all) {
		const cachedCount = count
		for (let i = 0; i < cachedCount; i++) {
			end()
		}
	}
}
