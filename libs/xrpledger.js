/*
  Connect to the XRPL and listen to events from wallets in array
*/

// Imports
const fileSys = require('fs');
const CLR = require('cli-color');
const Yaml = require('js-yaml');
const winston = require('./loggerLib.js');

// This was very helpful, thank you :-)
const RippledWsClient = require('rippled-ws-client');


// Pull in configuration options - setup.yml
let config;
try {
  config = Yaml.safeLoad(fileSys.readFileSync('setup.yml'));
} catch (error) {
  console.log(`Error in xrpledger.js: ${error}`);
}

/**
 *  Connect to the Ledger with walletAccounts to listen to
 *  @params walletAccounts, type Array of Strings -> ['walletAddr', 'walletAddr']
*/
exports.startXRPListener = function(walletAccounts, eventProcessor) {
  // Setting XRL Server wss endpoint
  console.log(`XRP Ledger client connecting to: ${CLR.whiteBright(config.xrpledger.server)}`);
  new RippledWsClient(config.xrpledger.server).then(function(connection) {
    let walletAddressesArray = Object.keys(walletAccounts);
    connection.send({
      command: 'subscribe',
      accounts: walletAddressesArray,
    }).then(function(response) {
      if (response === null) {
        winston.info("connected to xrp ledger: %s", response);
      }

    }).catch(function(error) {
      winston.error("ecountered error in xrpledger.startXRPListener: %s", error);
    });

    connection.on('transaction', function(ledger) {
      eventProcessor(ledger, walletAccounts);
    });

  }).catch(function(error) {
    winston.error("ecountered error in xrpledger.startXRPListener catch: %s", error);
  });

};


