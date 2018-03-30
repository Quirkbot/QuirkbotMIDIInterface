const path = require('path')

const NAMESPACE = 'qbmidi'

module.exports = () => ({
	entry  : path.join(__dirname, 'src', 'index.js'),
	output : {
		path          : path.join(__dirname, 'build'),
		filename      : `${NAMESPACE}.js`,
		publicPath    : 'build/',
		library       : NAMESPACE,
		libraryTarget : 'umd',
		// need 'globalObject' until webpack issue is solved
		// https://github.com/webpack/webpack/issues/6522
		globalObject  : 'typeof self !== \'undefined\' ? self : this'
	},
	node : {
		fs : 'empty'
	},
	module : {
		rules : [
			{
				test    : /\.js$/,
				loader  : 'babel-loader',
				exclude : /node_modules/
			}
		]
	}
})
