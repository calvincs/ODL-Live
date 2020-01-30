/*
  Connect and periodically pull Bittrex APIs for Trades and Order book entries
*/

// Imports
const winston = require('./loggerLib.js');
const fileSys = require('fs');
const CLR = require('cli-color');
const Yaml = require('js-yaml');
const Fetch = require('node-fetch');

// Pull in configuration options - setup.yml
let config;
try {
  config = Yaml.safeLoad(fileSys.readFileSync('setup.yml'));
} catch (error) {
  console.log(`Error in BITREX.js: ${error}`);
}

/** ************************************************
 Simple Array Bucket, holder of simple objects
 w/ TTL of 120 seconds, then delete
***************************************************/
let BITREXTXQueue = [];
let isInit = true;

exports.getQueue = function() {
  return BITREXTXQueue;
};

let queueTTLProcessor = function() {
  try {
    // Remove anything over older then 2 minutes (order book is stupid, reduce mem footprint)
    let minuteOld = Math.floor((new Date().getTime() / 1000) - 120);

    BITREXTXQueue = BITREXTXQueue.filter(o => {
      if (o.time <= minuteOld) {
        return false;
      } else {
        return true;
      }
    });
  } catch (error) {
    winston.error('encountered error in BITREX.getQueue: %s', error);
  }
};

let queueQueueSize = function(){
  return BITREXTXQueue.length;
};

//Fetch Trade data from BITREX
let getTrades = async function() {
  try {
    let bittrexTrades = config.bittrex.trades;

    let resp = await Fetch(bittrexTrades, {
      method: 'get',
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/74.0.3729.169 Safari/537.36'},
    });

    // Process the incoming data, clean it up
    let jsonResp = await resp.json();

    // Returned object is an Dict Object, enjoy
    return jsonResp;

  } catch (error){
    winston.warning(`Unable to gather addresses from ${config.bittrex.server}, try again later: ${error}`);
  }
}


//Fetch Orderbook data from BITREX
let getOrders = async function() {
  try {
    let bittrexOrders = config.bittrex.orderbook;
    let resp = await Fetch(bittrexOrders, {
      method: 'get',
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/74.0.3729.169 Safari/537.36'},
    });

    // Process the incoming data, clean it up
    let jsonResp = await resp.json();

    // Returned object is an Dict Object, enjoy
    return jsonResp;

  } catch (error){
    winston.warning(`Unable to gather addresses from ${config.bittrex.server}, try again later: ${error}`);
  }
}

exports.startBITREXListener = startBITREXListener = async function() {
  try {

    // Setting BITREX Server wss endpoint
    let msg = `BITREX client connecting to: ${CLR.whiteBright(config.bittrex.server)}`;
    if (isInit === true) {
      console.log(msg);
    }
    isInit = false;
    winston.info(msg);

    //Periodically get new trade data
    setInterval(async function(){
      let trades = await getTrades();

      trades = trades['result'];
      for (var i=0; i < trades.length; i++) {
        let obj = trades[i];

        // Transform into a standard object for processing
        let buySell = ((obj.OrderType === "BUY") ? 'b' : 's');
        let amount = parseFloat(parseFloat(obj.Quantity).toFixed(4)); // XRP
        // Time is PST
        let tZone  = new Date(obj.TimeStamp).toLocaleString("en-US", {timeZone: "America/Los_Angeles"});
        let time = Math.floor(new Date(tZone).getTime() / 1000);
        //Due to the nature of this object, filter out ids that already exist
        let id = obj.Uuid;

        if (BITREXTXQueue.find(o => o.id === obj.id) === undefined) {
          BITREXTXQueue.push({type: buySell, xrp: amount, time: time, id: id});
          winston.debug(`${CLR.green('BITREX ')} ${buySell}, ${amount}, ${time}, Array Size: ${queueQueueSize()}`);
        }
      }

    }, 30000); //30 Seconds


    //Periodically get new orderbook data
    setInterval(async function(){
      let orders = await getOrders();

      orders = orders["result"];

      //Process Bids
      let bids = orders.buy;
      for (var i=0; i < bids.length; i++) {
        let obj = bids[i];

        // Transform into a standard object for processing
        let buySell = 'b';
        let amount = parseFloat(parseFloat(obj['Quantity']).toFixed(4)); // XRP
        let time =  Math.floor(Date.now() / 1000); // User current local, as not provided from stream

        BITREXTXQueue.push({type: buySell, xrp: amount, time: time});
        winston.debug(`${CLR.blue('BITREX ')} ${buySell}, ${amount}, ${time}, Array Size: ${queueQueueSize()}`);
      }

      //Process Asks
      let asks = orders.sell;
      for (var i=0; i < asks.length; i++) {
        let obj = asks[i];

        // Transform into a standard object for processing
        let buySell = 's';
        let amount = parseFloat(parseFloat(obj['Quantity']).toFixed(4)); // XRP
        let time =  Math.floor(Date.now() / 1000); // User current local, as not provided from stream

        BITREXTXQueue.push({type: buySell, xrp: amount, time: time});
        if (i%100===0) {
          winston.debug(`${CLR.red('BITREX ')} ${buySell}, ${amount}, ${time}, Array Size: ${queueQueueSize()}`);
        }
      }

    }, 35000); //35 Seconds

    //Periodically process the TTL queue
    setInterval(function(){
        //Run queue TTL job
        queueTTLProcessor();
        winston.debug(`❤️❤️❤️\t BITREX TTL run, Queue depth of ${queueQueueSize()}`);
    }, 30000); //60 Seconds

  } catch (error) {
    winston.error('encountered error in BITREX.startBITREXListener: %s', error);
  }
};

