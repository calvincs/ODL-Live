'use strict';
// ODL-Live
// Version 0.75
// Written by: Calvin Schultz

// Imports
require('./libs/banner.js');
const winston = require('./libs/loggerLib.js');
const CLR = require('cli-color');
const fileSys = require('fs');
const Yaml = require('js-yaml');
const BITREX = require('./libs/bittrex.js');

// Pull in configuration options - setup.yml
let config;
try {
  config = Yaml.safeLoad(fileSys.readFileSync('setup.yml'));
} catch (error) {
  // Dies hard this way.. This is a major issue we just fail outright on
  console.log(`Error in index.js: ${error}`);
  process.exit(-1);
}

async function main() {
  try {
    let windowWidth = CLR.windowSize.width - 1;
    console.log('Start the Test Harness...\n');

    // The data listeners below
    BITREX.startBITREXListener();

    console.log('listeners have been started...');

    console.log('-'.repeat(windowWidth));



  } catch (error) {
    winston.error('encountered error in main exec function: %s', error);
  }
}

// Launch it
main();

// Gotta catch them all
process.on('uncaughtException', function(error) {
  console.log("encountered an uncaughtException in main: %s", error);
});
