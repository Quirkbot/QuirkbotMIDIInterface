const path = require('path')
const webpack = require('webpack')

const NAMESPACE = 'qbmidi'

module.exports = env => ({
	entry  : path.join(__dirname, 'src', 'index.js'),
	output : {
		path           : path.join(__dirname, 'build'),
		filename       : (env !== 'prod') ? `${NAMESPACE}.js` : `${NAMESPACE}.min.js`,
		publicPath     : 'build/',
		library        : NAMESPACE,
		libraryTarget  : 'umd',
		umdNamedDefine : true
	},
	module : {
		rules : [
			{
				test    : /\.js$/,
				loader  : 'babel-loader',
				exclude : /node_modules/
			}
		]
	},
	plugins : (env !== 'prod' && []) || [
		new webpack.optimize.UglifyJsPlugin()
	]
})
