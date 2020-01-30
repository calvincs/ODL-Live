/*
  Connect and periodically pull MercadoBitCoin.net API for Trades and Order book entries
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
  console.log(`Error in MERCADO.js: ${error}`);
}

/** ************************************************
 Simple Array Bucket, holder of simple objects
 w/ TTL of 120 seconds, then delete
***************************************************/
let MERCADOTXQueue = [];
let isInit = true;

exports.getQueue = function() {
  return MERCADOTXQueue;
};

let queueTTLProcessor = function() {
  try {
    // Remove anything over older then 2 minutes (order book is stupid, reduce mem footprint)
    let minuteOld = Math.floor((new Date().getTime() / 1000) - 120);

    MERCADOTXQueue = MERCADOTXQueue.filter(o => {
      if (o.time <= minuteOld) {
        return false;
      } else {
        return true;
      }
    });
  } catch (error) {
    winston.error('encountered error in MERCADO.getQueue: %s', error);
  }
};

let queueQueueSize = function(){
  return MERCADOTXQueue.length;
};

//Fetch Trade data from Mercado
let getTrades = async function() {
  try {
    let mercadoTrades = config.mercado.trades;

    // Request any trades from NOW - 30 Seconds ago +5 sec as buffer/overlap
    let secondsOld = Math.floor((new Date().getTime() / 1000) - 35);
    mercadoTrades = mercadoTrades + secondsOld

    let resp = await Fetch(mercadoTrades, {
      method: 'get',
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/74.0.3729.169 Safari/537.36'},
    });

    // Process the incoming data, clean it up
    let jsonResp = await resp.json();

    // Returned object is an Dict Object, enjoy
    return jsonResp;

  } catch (error){
    winston.warn(`Unable to gather addresses from ${config.mercado.server}, try again later: ${error}`);
  }
}


//Fetch Orderbook data from Mercado
let getOrders = async function() {
  try {
    let mercadoOrders = config.mercado.orderbook;
    let resp = await Fetch(mercadoOrders, {
      method: 'get',
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/74.0.3729.169 Safari/537.36'},
    });

    // Process the incoming data, clean it up
    let jsonResp = await resp.json();

    // Returned object is an Dict Object, enjoy
    return jsonResp;

  } catch (error){
    winston.warn(`Unable to gather addresses from ${config.mercado.server}, try again later: ${error}`);
  }
}

exports.startMERCADOListener = startMERCADOListener = async function() {
  try {

    // Setting MERCADO Server wss endpoint
    let msg = `MERCADO client connecting to: ${CLR.whiteBright(config.mercado.server)}`;
    if (isInit === true) {
      console.log(msg);
    }
    isInit = false;
    winston.info(msg);

    //Periodically get new trade data
    setInterval(async function(){
      let trades = await getTrades();

      for (var i=0; i < trades.length; i++) {
        let obj = trades[i];

        // Transform into a standard object for processing
        let buySell = ((obj.type === "buy") ? 'b' : 's');
        let amount = parseFloat(parseFloat(obj.amount).toFixed(4)); // XRP
        let time = new Date(obj.date).getTime();

        MERCADOTXQueue.push({type: buySell, xrp: amount, time: time});
        winston.debug(`${CLR.green('MERCADO ')} ${buySell}, ${amount}, ${time}, Array Size: ${queueQueueSize()}`);
      }

    }, 30000); //30 Seconds

    //Periodically get new orderbook data
    setInterval(async function(){
      let orders = await getOrders();

      //Process Bids
      let bids = orders.bids;
      for (var i=0; i < bids.length; i++) {
        let obj = bids[i];

        // Transform into a standard object for processing
        let buySell = 'b';
        let amount = parseFloat(parseFloat(obj[1]).toFixed(4)); // XRP
        let time =  Math.floor(Date.now() / 1000); // User current local, as not provided from stream

        MERCADOTXQueue.push({type: buySell, xrp: amount, time: time});
        if (i%100===0) {
          winston.debug(`${CLR.blue('MERCADO ')} ${buySell}, ${amount}, ${time}, Array Size: ${queueQueueSize()}`);
        }
      }

      //Process Asks
      let asks = orders.asks;
      for (var i=0; i < asks.length; i++) {
        let obj = asks[i];

        // Transform into a standard object for processing
        let buySell = 's';
        let amount = parseFloat(parseFloat(obj[1]).toFixed(4)); // XRP
        let time =  Math.floor(Date.now() / 1000); // User current local, as not provided from stream

        MERCADOTXQueue.push({type: buySell, xrp: amount, time: time});
        if (i%100===0) {
          winston.debug(`${CLR.red('MERCADO ')} ${buySell}, ${amount}, ${time}, Array Size: ${queueQueueSize()}`);
        }
      }

    }, 35000); //35 Seconds

    //Periodically process the TTL queue
    setInterval(function(){
        //Run queue TTL job
        queueTTLProcessor();
        winston.debug(`❤️❤️❤️\t MERCADO TTL run, Queue depth of ${queueQueueSize()}`);
    }, 60000); //60 Seconds

  } catch (error) {
    winston.error('encountered error in MERCADO.startMERCADOListener: %s', error);
  }
};

