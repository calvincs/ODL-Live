'use strict';
// ODL-Live
// Version 1.0
// Written by: Calvin Schultz

// Imports
require('./libs/banner.js');
const winston = require('./libs/loggerLib.js');
const XRPL = require('./libs/xrpledger.js');
const BITSO = require('./libs/bitso.js');
const BITSMP = require('./libs/bitstamp.js');
const COINS = require('./libs/coinsph.js');
const BTCM = require('./libs/btcmarkets.js');
const MERC = require('./libs/mercado.js');
const BITREX = require('./libs/bittrex.js');
const Fetch = require('node-fetch');
const CLR = require('cli-color');
const fileSys = require('fs');
const Yaml = require('js-yaml');


// Pull in configuration options - setup.yml
let config;
try {
  config = Yaml.safeLoad(fileSys.readFileSync('setup.yml'));
} catch (error) {
  // Dies hard this way.. This is a major issue we just fail outright on
  console.log(`Error in index.js: ${error}`);
  process.exit(-1);
}


// Hold Price Information
let currentXRPPrice = {};
let rolling24Hours = [];
let odlIn24 = 0;
let xrpIn24 = 0.0;
let usdIn24 = 0.0;


// Gather stats on processed transactions
let generateStatistics = async function() {
  return new Promise(function(resolve, reject) {

    // Remove anything over older then 24 Hours
    let dayOld = Math.floor((new Date().getTime() / 1000) - 86400);

    rolling24Hours = rolling24Hours.filter(o => {
      if (o.time <= dayOld) {
        return false;
      } else {
        return true;
      }
    });
    // Set count variable
    odlIn24 = rolling24Hours.length;

    // Set statistics variables
    xrpIn24 = 0.0;
    usdIn24 = 0.0;
    rolling24Hours.forEach(function(item){
      xrpIn24 = Number(parseFloat(xrpIn24 + item.xrp).toFixed(4));
      usdIn24 = Number(parseFloat(usdIn24 + item.usd).toFixed(2));
    });
    winston.info('generateStatistics information: odlIn24 %s, xrpIn24 %s, usdIn24 %s', odlIn24, xrpIn24, usdIn24);

    // Write to file as backup!
    let statsData = JSON.stringify(rolling24Hours, null, 2);
    fileSys.writeFile(config.statsbackup.filePath, statsData, (error) => {
      if (error) {
        winston.error('encountered error in backup of stats data in main.generateStatistics: %s', error);
      } else {
        winston.info('backup of stats data completed to file: %s', config.statsbackup.filePath);
      }

    });
    resolve(true);
  });

};


// Recover stats data if present
let loadStatsDataFromFile = function() {
  return new Promise(function(resolve, reject) {
    try {
      winston.info('attempting recovery of stats data from: %s', config.statsbackup.filePath);
      fileSys.readFile(config.statsbackup.filePath, (err, data) => {
        if (err) {
          reject(false);
        }
        rolling24Hours = JSON.parse(data);
        winston.info('found data in file, loading: %s', JSON.stringify(rolling24Hours, null, 2));
        resolve(true);
      });
    } catch (error) {
      winston.error('encountered error in main.loadStatsDataFromFile: %s', error);
      reject(false);
    }
  });
};


/** ************************************************
 Pull Exchange addresses for Bitso and Bitstamp
***************************************************/

// Filter addresses from Bithomp.com, looking for Bitstamp and Bitso
let exchangeFilter = function(obj) {
  try {
    let objName = obj.name.toLowerCase();
    if (config.exchangeNames.includes(objName) === true){
      return true;
    } else {
      return false;
    }
  } catch (error) {
    winston.error('encountered error in exchangeFilter: %s', error);
  }
};


// Get latest wallets from Bithomp.com
let getWalletAddresses = async function() {
  try {
    let bitHompUri = config.bithomp.userinfo;
    let resp = await Fetch(bitHompUri, {
      method: 'get',
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/74.0.3729.169 Safari/537.36'},
    });

    // Process the incoming data, clean it up
    let jsonResp = await resp.json();
    let filteredList = jsonResp.usersinfo.filter(exchangeFilter);
    let finalObject = Object.assign({}, ...filteredList.map(s => ({[s.address]: s.name.toLowerCase()})));

    // Returned object is an Dict Object, enjoy
    return finalObject;

  } catch (error){
    winston.warning('Unable to gather addresses from Bithomp.com, try again later: $s', error);
  }

};


/** ************************************************
 Process incoming XRP Ledger messages
***************************************************/
let processIncomingXRPLedgerMessages = async function(message, walletAddresses) {
  try {
    let walletAddressesArray = Object.keys(walletAddresses);
    if (message.transaction.TransactionType === 'Payment' && message.meta.TransactionResult === 'tesSUCCESS') {
      if (walletAddressesArray.includes(message.transaction.Account) && walletAddressesArray.includes(message.transaction.Destination)){

        // Sanity check, is Amount actually XRP payment or other {}
        if (typeof message.transaction.Amount === 'string') {


          ////////////////////////////////////////////////////////////////////////////////////////////////////////////////
          //HUNT for ODL
          // Get the source and dest of the transaction
          // Convert XRP Ledger time to epoch time varX + 946684800 = sec since epoch 624489221
          // let transactionTime = parseInt(message.transaction.date, 10) + 946684800;
          // let source = walletAddresses[message.transaction.Account];
          // let destination = walletAddresses[message.transaction.Destination];


          // // Convert STRING XRP amount to float, fixed to 4 places
          // let transactionAmount = parseFloat((parseFloat(message.transaction.Amount) / 1000000).toFixed(4));

          // // Get Destination Tag
          // let destTag = parseInt(message.transaction.DestinationTag, 10);

          //           //   // Dest Tag information
          // let isODLTag = isODLDestination(destTag, destination);

          // console.log(`${transactionTime},${source},${destination},${destTag},${isODLTag},${transactionAmount}`);
          ////////////////////////////////////////////////////////////////////////////////////////////////////////////////


          // If we seen a transaction, lets put it into the background and let it try and finnish
          // In other words, lets give time for the SELL to happen on the last leg of the ODL transaction

          setTimeout(async() => {
            // Do we believe this is an ODL transaction 0 - 90
            let isODLScore = 0;
            // Are we going to show a final message
            let showMessage = false;

            // Get the source and dest of the transaction
            let source = walletAddresses[message.transaction.Account];
            let dest = walletAddresses[message.transaction.Destination];

            // Convert XRP Ledger time to epoch time varX + 946684800 = sec since epoch 624489221
            let transactionTime = parseInt(message.transaction.date, 10) + 946684800;

            // Convert STRING XRP amount to float, fixed to 4 places
            let transactionAmount = parseFloat((parseFloat(message.transaction.Amount) / 1000000).toFixed(4));

            // Get Destination Tag
            let destTag = parseInt(message.transaction.DestinationTag, 10);

            // Dest Tag information
            let isODLTag = isODLDestination(destTag, dest);
            if (isODLTag === true) {
              isODLScore = isODLScore + 30;
            }

            // Search for BUY order/trades from the source exchange
            let buyOrders = findTransTypes(source, 'b', transactionTime);
            let buyFindData = findClosetValue(buyOrders, transactionAmount);
            // Sanity check -> (BUY >= X && ((X/A*100)>=T)) of {type: buySell, xrp: amount, time: time} where T is 90% or 10% tolerance
            if ((buyFindData.xrp >= transactionAmount) && ((transactionAmount / buyFindData.xrp * 100) >= 90)) {
              isODLScore = isODLScore + 30;
            }

            // Search for SELL orders/trades from the destination exchange
            let sellOrders = findTransTypes(dest, 's', transactionTime);
            let sellFindData = findClosetValue(sellOrders, transactionAmount);
            // Sanity check -> (BUY >= X && ((X/A*100)>=T)) of {type: buySell, xrp: amount, time: time} where T is 90% or 10% tolerance
            if ((sellFindData.xrp <= transactionAmount) && ((sellFindData.xrp / transactionAmount * 100) >= 90)) {
              isODLScore = isODLScore + 30;
            }

            // Give final interpretation of the data based on the score given
            if (isODLScore === 30 || isODLScore === 60 || isODLScore === 90) {
              showMessage = true;
            }
            // After all the calculation, do we show the message?
            if (showMessage === true) {
              // Get width of window
              let windowWidth = CLR.windowSize.width - 1;
              // Msg Variables
              let usdValueTX = Number(parseFloat(parseFloat(parseFloat(currentXRPPrice.last).toFixed(4)) * transactionAmount).toFixed(2));
              let currentEpoch = Math.floor((new Date().getTime() / 1000));
              // Collect data to stats process
              rolling24Hours.push({xrp: transactionAmount, usd: usdValueTX, time: currentEpoch});

              // Run Stats agg process
              await generateStatistics();

              // Print out message
              console.log(`💰 - Transfered ${CLR.bold.whiteBright(Number(transactionAmount).toLocaleString())} XRP, USD Value: ${CLR.bold.whiteBright(Number(usdValueTX).toLocaleString())}`);
              console.log(`📬 - Transfer from ${CLR.whiteBright(source)} to ${CLR.whiteBright(dest)} at ${CLR.whiteBright(new Date().toString())}`);
              console.log(`🚀 - In 24 Hours we've seen ${CLR.whiteBright(odlIn24)} ODL's! Thats ${CLR.whiteBright(Number(xrpIn24).toLocaleString())} XRP and ${CLR.whiteBright(Number(usdIn24).toLocaleString())} USD transferred.`);
              console.log('-'.repeat(windowWidth));
            }

          }, 90000); // Wait 1:30 solid minutes for a final sell transaction 90000
        }
      }
    }

  } catch (error) {
    winston.error('we encountered an error in the message parser %s', error);
  }
};


/** ************************************************
 ODL helper functions
***************************************************/

/*
 * Search a given transaction to see if destination has a known ODL tag, if so return true
 *
 * destTag:        integer value
 * destExchange:   name of destination exchange
 *
*/
const isODLDestination = function(destTag, destExchange) {
  try {
    let odlTags = config.exchangeODLTags;
    let output = odlTags.filter(function(obj){
      if (obj.tag === destTag && obj.exchange === destExchange) {
        return true;
      }
      return false;
    });
    if (output.length === 1) {
      return true;
    } else {
      return false;
    }
  } catch (error) {
    winston.error('encountered error in isODLDestination: %s', error);
  }
};


/*
 * In array of exchange queue values, which xrp values are closest to the given value
 *
 * data:    [{<exchange queue values>},{<exchange queue values>},...]
 * value:   xrp value to search for, not in drops, see code in exchange mods
 *
 * we could simplify this.. but for now its ok..
*/
const findClosetValue = function(oArray, sValue) {
  try {
    // Sanity Checking
    if (!Array.isArray(oArray) || !oArray.length) { return []; }
    let tmp = 0; let indX = 0;
    oArray.forEach(function(item, index){
      let mValue = Math.abs(item.xrp - sValue);
      if (index > 0) {
        if (mValue <= tmp){
          tmp = mValue;
          indX = index;
        };
      } else {
        tmp = mValue;
        indX = index;
      }
    });
    return oArray[indX];
  } catch (error) {
    winston.error('encountered error in findClosetValue: %s', error);
  }

};


/*
 * Get all transactions of a type from a selected exchange
 *
 * exchange:    "bitso" || "bitstamp" || "coins.ph"
 * type:        b (buy) || s -> (sell)
 * time:        epoch value in seconds
 * - NOTE if buy, T+2, else sell T-2, this is to protect against skew or drift
 *
*/
let findTransTypes = function(exchange, type, fTime) {
  try {
    let exchangeData;
    switch (exchange) {
      case 'bitstamp':
        exchangeData = BITSMP.getQueue().filter(function(obj){
          if (obj.type === type) {
            return true;
          }
          return false;
        });
        break;
      case 'bitso':
        exchangeData = BITSO.getQueue().filter(function(obj){
          if (obj.type === type) {
            return true;
          }
          return false;
        });
        break;
      case 'coins.ph':
        exchangeData = COINS.getQueue().filter(function(obj){
          if (obj.type === type) {
            return true;
          }
          return false;
        });
        break;
      case 'btc markets':
        exchangeData = BTCM.getQueue().filter(function(obj){
          if (obj.type === type) {
            return true;
          }
          return false;
        });
        break;
      case 'mercado bitcoin':
        exchangeData = MERC.getQueue().filter(function(obj){
          if (obj.type === type) {
            return true;
          }
          return false;
        });
        break;
      case 'bittrex':
        exchangeData = BITREX.getQueue().filter(function(obj){
          if (obj.type === type) {
            return true;
          }
          return false;
        });
        break;

    }
    // Take results, and filter out times we dont need as well.
    let drift = 2;
    if (exchange === 'bitso') {
      drift = 10;
    }
    if (exchange === 'mercado bitcoin' || exchange === 'bittrex'){
      drift = 35;
    }
    if (type === 'b') {
      fTime = fTime + drift;
    }
    if (type === 's') {
      fTime = fTime - drift;
    }

    // If we have nothing, bail
    if (exchangeData == null){
      return [];
    }

    let finalData = exchangeData.filter(function(obj){
      if ((obj.time <= fTime && type === 'b') || (obj.time >= fTime && type === 's')) {
        return true;
      } else {
        return false;
      }
    });
    return finalData;

  } catch (error) {
    winston.error('encountered error in findTransTypes: %s', error);
  }
};


async function main() {
  try {
    let windowWidth = CLR.windowSize.width - 1;
    winston.info('setting current window width to %s', windowWidth);

    // Fetch the wallet addresses
    let exchangeWallets = await getWalletAddresses();

    console.log('Loading exchange wallet data...\n');
    //console.log('loading wallet data: %s', JSON.stringify(exchangeWallets, null, 2));
    winston.info('loading wallet data: %s', JSON.stringify(exchangeWallets, null, 2));

    try {
      let loadResult = await loadStatsDataFromFile();
      console.log('Attempting to load saved stats data: %s', loadResult);
    } catch (error) {
      console.log('Unable to load any stats file, no problem, moving onward...');
    }

    // The data listeners below
    XRPL.startXRPListener(exchangeWallets, processIncomingXRPLedgerMessages);
    BITSO.startBitsoListener();
    BITSMP.startBitstampListener();
    BTCM.startBTCMarketsListener();
    await BITSMP.watchCurrentPriceUSD();
    COINS.startCoinsListener();
    MERC.startMERCADOListener();
    BITREX.startBITREXListener();
    winston.info('listeners have been started...');

    console.log('\n🤖 - Watching transactions for signs of On Demand Liquidity...\n');
    console.log('🤖 - This may take time, please be patient... 💤💤💤');
    console.log('-'.repeat(windowWidth));

    //Set price variable
    currentXRPPrice = await BITSMP.getCurrentPriceInformation();
    winston.info('setting inital price of XRP in usd to: %s', JSON.stringify(currentXRPPrice, null, 2));
    setInterval(async function(){
      try {
        // Price Information, fetch every 120 seconds
        currentXRPPrice = await BITSMP.getCurrentPriceInformation();
        winston.debug('fetched current price of XRP from bitstamp: %s', JSON.stringify(currentXRPPrice, null, 2));
        winston.info(`fetched current price of XRP from Bitstamp: ${currentXRPPrice.last}`)
      } catch (error) {
        winston.error('encountered error in interval check of price via bitstamp: %s', error);
      }
    }, 120000);

    // Gather and clean stats every 300 seconds
    setInterval(function(){
      winston.info('running stats cleanup/generator...');
      generateStatistics();
    }, 300000);


  } catch (error) {
    winston.error('encountered error in main exec function: %s', error);
  }
}

// Launch it
main();

// Gotta catch them all
process.on('uncaughtException', function(error) {
  winston.error("encountered an uncaughtException in main: %s", error);
});
