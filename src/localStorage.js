const map = {}

export default (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') ?
	window.localStorage :
	{
		setItem    : (key, value) => map[key] = value,
		getItem    : key => map[key] || null,
		removeItem : key => delete map[key]
	}
