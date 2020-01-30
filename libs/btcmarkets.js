/*
  Connect to the BTC Markets WebSocket, and listen to Order and Trade events
*/

// Imports
const winston = require('./loggerLib.js');
const fileSys = require('fs');
const CLR = require('cli-color');
const Yaml = require('js-yaml');
const WebSocket = require('ws');

// Pull in configuration options - setup.yml
let config;
try {
  config = Yaml.safeLoad(fileSys.readFileSync('setup.yml'));
} catch (error) {
  console.log(`Error in btcmarkets.js: ${error}`);
}

/** ************************************************
 Simple Array Bucket, holder of simple objects
 w/ TTL of 120 seconds, then delete
***************************************************/
let BTCMarketsTXQueue = [];
let BTCMarketsTXQueueCNTR = 0;
let BTCMarketsHBCNTR = 0;
let isInit = true;

exports.getQueue = function() {
  return BTCMarketsTXQueue;
};

let queueTTLProcessor = function() {
  try {
    // Remove anything over older then 2 minutes (order book is stupid, reduce mem footprint)
    let minuteOld = Math.floor((new Date().getTime() / 1000) - 120);

    BTCMarketsTXQueue = BTCMarketsTXQueue.filter(o => {
      if (o.time <= minuteOld) {
        return false;
      } else {
        return true;
      }
    });
  } catch (error) {
    winston.error('encountered error in BTCMarkets.getQueue: %s', error);
  }
};

let queueQueueSize = function(){
  return BTCMarketsTXQueue.length;
};

let messageProcessor = function(obj){
  try {
      // Processing incoming trades
      if (obj.messageType === 'trade') {
        // Transform into a standard object for processing
        let buySell = ((obj.side === "Bid") ? 'b' : 's');
        let amount = parseFloat(parseFloat(obj.volume).toFixed(4)); // XRP
        let time = Math.floor(new Date(obj.timestamp).getTime() / 1000);

        BTCMarketsTXQueue.push({type: buySell, xrp: amount, time: time});
        winston.debug(`${CLR.blue('BTCMarkets ')} ${buySell}, ${amount}, ${time}, Array Size: ${queueQueueSize()}`);
      }

      // Processing orders
      if (obj.messageType === 'orderbook') {
        //Process the time once
        let time = Math.floor(new Date(obj.timestamp).getTime() / 1000);

        //due to the nature of the order book, we dont get a diff, only take every 10 sec (Sample the OrderBook)
        if (time % 10 !== 0) {
          return
        }

        //Process the bids
        for (var i = 0; i < obj.bids.length; i++) {
          // Transform into a standard object for processing
          let buySell = 'b';
          let amount = parseFloat(parseFloat(obj.bids[i][1]).toFixed(4)); // XRP
          BTCMarketsTXQueue.push({type: buySell, xrp: amount, time: time});
          //winston.debug(`${CLR.red('BTCMarkets ')} ${buySell}, ${amount}, ${time}, Array Size: ${queueQueueSize()}`);
        }

        //Process the asks
        for (var i = 0; i < obj.asks.length; i++) {
          // Transform into a standard object for processing
          let buySell = 's';
          let amount = parseFloat(parseFloat(obj.bids[i][1]).toFixed(4)); // XRP
          BTCMarketsTXQueue.push({type: buySell, xrp: amount, time: time});
          //winston.debug(`${CLR.blueBright('BTCMarkets ')} ${buySell}, ${amount}, ${time}, Array Size: ${queueQueueSize()}`);
        }
      }

  } catch (error) {
    winston.error('encountered error in BTCMarkets.messageProcessor: %s', error);
  }
};


exports.startBTCMarketsListener = startBTCMarketsListener = function() {
  try {

    // Setting BTCMarkets Server wss endpoint
    let msg = `BTCMarkets client connecting to: ${CLR.whiteBright(config.btcmarkets.server)}`;
    if (isInit === true) {
      console.log(msg);
    }
    isInit = false;
    winston.info(msg);
    const wsConnection = new WebSocket(config.btcmarkets.server);

    // Set Handlers for API events
    wsConnection.onerror = function(error) {
      winston.error("encountered error with BTCMarkets webSocket: %s", JSON.stringify(error));
    };

    wsConnection.onmessage = function(e) {
      let response = JSON.parse(e.data);

      if (response.messageType === 'heartbeat') {
        heartBeat();
      } else {
        messageProcessor(response);
      }
  
      // A hack way to trigger the processor for TTL
      BTCMarketsTXQueueCNTR++;
      if (BTCMarketsTXQueueCNTR >= 20) {
        queueTTLProcessor();
        BTCMarketsTXQueueCNTR = 0;
      }

    };

    // Handle closures
    wsConnection.onclose = function() {
      winston.info('BTCMarkets webSocket connection closed, restarting in 30 seconds');

      // clear Timeout
      clearTimeout(this.timeoutMonitor);

      // clean kill the websocket
      wsConnection.terminate();

      // Attempt a restart of listener, wait 30 seconds
      setTimeout(() => {
        winston.info('attempting restart of startBTCMarketsListener now...');
        startBTCMarketsListener();
      }, 300000);
    };

    // Send subscribe message to WS
    wsConnection.onopen = function() {
      // BTCMarkets doesnt display all trades or orders, need both for completeness.  
      wsConnection.send(JSON.stringify({ marketIds: ['XRP-AUD'], channels: ['orderbook', 'trade', 'heartbeat'], messageType: 'subscribe' }));
      heartBeat();
    };

    // Our heart beat for ws.. basic, but does the job.. hopefully :-)
    let heartBeat = function() {
      winston.debug(`❤️❤️❤️\t BTCMarkets heartbeat detected... Queue depth of ${queueQueueSize()}`);
      clearTimeout(this.timeoutMonitor);
      this.timeoutMonitor = setTimeout(() => {
        winston.warning(`${CLR.red('Warning:')} BTCMarkets listener went silent for over 90 seconds, restarting listener...`);
        wsConnection.terminate();
      }, 90000);
    };
  } catch (error) {
    winston.error('encountered error in BTCMarkets.startBTCMarketsListener: %s', error);
  }
};

