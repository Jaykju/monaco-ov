/* --------------------------------------------------------------------------------------------
 * Copyright (c) 2018 TypeFox GmbH (http://www.typefox.io). All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
const path = require('path');
const lib = path.resolve(__dirname, "lib");

const webpack = require('webpack');
const merge = require('webpack-merge');
const UglifyJSPlugin = require('uglifyjs-webpack-plugin');

const common = {
    entry: {
        "main": path.resolve(lib, "main.js"),
        "editor.worker": 'monaco-editor/esm/vs/editor/editor.worker.js',
        "json.worker": 'monaco-editor/esm/vs/language/json/json.worker',
        "ts.worker": 'monaco-editor/esm/vs/language/typescript/ts.worker',
    },
    output: {
        filename: '[name].bundle.js',
        path: lib
    },
    module: {
        rules: [
            {
                test: /\.css$/,
                use: ['style-loader', 'css-loader']
            },
            {
                test: /\.(png|jpg|gif)$/i,
                use: [
                  {
                    loader: 'url-loader',
                    options: {
                      fallback: 'responsive-loader',
                    },
                  },
                ],
              },
              {
                test: /\.wasm$/,
                loader: "file-loader",
                type: "javascript/auto",
              }
        ]
    },
    target: 'web',
    node: {
        fs: 'empty',
        child_process: 'empty',
        net: 'empty',
        crypto: 'empty'
    },
    resolve: {
        alias: {
            'vscode': require.resolve('monaco-languageclient/lib/vscode-compatibility')
        }
    }
};

if (process.env['NODE_ENV'] === 'production') {
    module.exports = merge(common, {
        plugins: [
            new UglifyJSPlugin(),
            new webpack.DefinePlugin({
                'process.env.NODE_ENV': JSON.stringify('production')
            })
        ]
    });
} else {
    module.exports = merge(common, {
        devtool: 'source-map',
        module: {
            rules: [{
                test: /\.js$/,
                enforce: 'pre',
                loader: 'source-map-loader'
            }]
        }
    })
} 
