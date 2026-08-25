/* eslint-disable no-undef */
const path = require('path');
const webpack = require('webpack');
/** @import { Configuration } from "webpack" */

/**
 * @param {any} env
 * @param {{ mode?: string, watch?: boolean }} argv
 * @returns {Configuration}
 */
module.exports = (env, argv) => {
	const mode = argv.mode || 'development';
	const isProduction = mode === 'production';

	return {
		mode,
		entry: path.join(__dirname, 'src', 'index'),
		watch: !!argv.watch,
		devtool: isProduction ? false : 'eval-source-map',
		output: {
			path: path.join(__dirname, 'dist', 'steam', 'js'),
			// Relative to dist/index.html, since the bundled CSS is injected
			// inline via <style> tags and resolves asset urls against the page.
			publicPath: './steam/js/',
			filename: 'bundle.js',
			chunkFilename: '[name].js'
		},
		module: {
			rules: [
				{
					test: /\.css$/,
					loaders: ['style-loader', 'css-loader']
				},
				{
					test: /\.(jpe?g|png|gif)$/i,
					loader: 'file-loader',
					options: {
						name: '[name].[ext]',
						outputPath: 'assets/images/'
						//the images will be emited to dist/steam/js/assets/images/ folder
					}
				}
			]
		},
		plugins: [
			/* Use the ProvidePlugin constructor to inject jquery implicit globals */
			new webpack.ProvidePlugin({
				$: 'jquery',
				jQuery: 'jquery',
				'window.jQuery': "jquery'",
				'window.$': 'jquery',
				'global.jQuery': 'jquery'
			})
		],
		resolve: {
			alias: {
				jquery: 'jquery'
			}
		}
	};
};
