const path = require('path')
// const MinifyPlugin = require('babel-minify-webpack-plugin')

const NAMESPACE = 'qbmidi'

module.exports = () => ({
	entry  : path.join(__dirname, 'src', 'index.js'),
	output : {
		path           : path.join(__dirname, 'build'),
		filename       : `${NAMESPACE}.js`,
		publicPath     : 'build/',
		library        : NAMESPACE,
		libraryTarget  : 'umd',
		umdNamedDefine : true
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
	},
	/* plugins : (env !== 'prod' && []) || [
		new MinifyPlugin()
	] */
})
