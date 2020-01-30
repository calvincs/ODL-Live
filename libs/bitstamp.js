/*
  Connect to the Bitstamp WebSocket, and listen to Order and Trade events
*/

// Imports
const winston = require('./loggerLib.js');
const fileSys = require('fs');
const CLR = require('cli-color');
const Yaml = require('js-yaml');
const WebSocket = require('ws');
const Fetch = require('node-fetch');


// Pull in configuration options - setup.yml
let config;
try {
  config = Yaml.safeLoad(fileSys.readFileSync('setup.yml'));
} catch (error) {
  console.log(`Error in bitstamp.js: ${error}`);
}

/** ************************************************
 Simple Array Bucket, holder of simple objects
 w/ TTL of 120 seconds, then delete
***************************************************/
let BitStampTXQueue = [];
let BitStampTXQueueCNTR = 0;
let BitstampPriceInformation = {};
let isInit = true;

exports.getQueue = function() {
  return BitStampTXQueue;
};

let queueQueueSize = function(){
  return BitStampTXQueue.length;
};

let queueTTLProcessor = function() {
  try {
    // Remove anything over older then 2 minutes
    let minuteOld = Math.floor((new Date().getTime() / 1000) - 120);
    BitStampTXQueue = BitStampTXQueue.filter(o => {
      if (o.time <= minuteOld) {
        return false;
      } else {
        return true;
      }
    });
  } catch (error) {
    winston.error('encountered error in bitstamp.queueTTLProcessor: %s', error);
  }
};

let messageProcessor = function(obj){
  try {
    if (Object.getOwnPropertyNames(obj.data).length > 0) {
      // Process Live Trades
      if (obj.channel === 'live_trades_xrpusd') {
        let data = obj.data;

        // Transform into a standard object for processing
        let buySell = ((data.type === 0) ? 'b' : 's');
        let amount = parseFloat(parseFloat(data.amount).toFixed(4)); // XRP
        let time = parseInt(data.timestamp, 10);

        BitStampTXQueue.push({type: buySell, xrp: amount, time: time});
        winston.debug(`${CLR.blueBright('Bitstamp ')}${buySell}, ${amount}, ${time}, Array Size: ${queueQueueSize()}`);
      }
      // Process Live Orders
      if (obj.channel === 'live_orders_xrpusd') {
        if (obj.event === 'order_created' || obj.event === 'order_changed') {
          let data = obj.data;

          // Transform into a standard object for processing
          let buySell = ((data.order_type === 0) ? 'b' : 's');
          let amount = parseFloat(parseFloat(data.amount).toFixed(4)); // XRP
          let time = parseInt(data.datetime, 10);

          BitStampTXQueue.push({type: buySell, xrp: amount, time: time});
          winston.debug(`${CLR.redBright('Bitstamp ')}${buySell}, ${amount}, ${time}, Array Size: ${queueQueueSize()}`);
        }
      }
    }
  } catch (error) {
    winston.error('encountered error in bitstamp.messageProcessor: %s', error);
  }
};

function apiCallBitstampPrice(){
  return new Promise(function(resolve, reject) {
    try {
      let bitstampPriceApi = config.bitstamp.priceTicker;
      Fetch(bitstampPriceApi, {
        method: 'get',
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/74.0.3729.169 Safari/537.36'},
      }).then(function(resp) {
        resolve(resp.json());
      }).catch((error) => {
        winston.error('encountered error in fetch of xrp price data: %s', error);
      });
    } catch (error){
      winston.error('unable to gather price information from bitstamp.com, tryinging again later: %s', error);
      reject({});
    }
  });
}

exports.watchCurrentPriceUSD = async function(){
  return new Promise(async function(resolve, reject) {
    try {
      // Make initial call, async
      BitstampPriceInformation = await apiCallBitstampPrice();
      setInterval(function(){
        // Async, no wait here
        BitstampPriceInformation = apiCallBitstampPrice();
      }, 60000);
      resolve(true);
    } catch (error) {
      winston.error('encountered error in watchCurrentPriceUSD: %s', error);
    }
  });
};

exports.getCurrentPriceInformation = function(){
  return BitstampPriceInformation;
};

exports.startBitstampListener = startBitstampListener = function() {
  try {
    // Setting Bitstamp Server wss endpoint
    let msg = `Bitstamp client connecting to: ${CLR.whiteBright(config.bitstamp.server)}`;
    if (isInit === true) {
      console.log(msg);
    }
    isInit = false;
    winston.info(msg);
    const wsConnection = new WebSocket(config.bitstamp.server);

    // Set Handlers for API events
    wsConnection.onerror = function(error) {
      winston.error("encountered error with bitstamp webSocket: %s", JSON.stringify(error));
    };

    wsConnection.onmessage = function(e) {
      let response = JSON.parse(e.data);

      // Process incoming messages
      messageProcessor(response);

      // A hack way to trigger the processor for TTL
      BitStampTXQueueCNTR++;
      if (BitStampTXQueueCNTR >= 100) {
        queueTTLProcessor();
        BitStampTXQueueCNTR = 0;
        heartBeat();
      }

      // Incase they send a request reconnect
      if (e.event === 'bts:request_reconnect') {
        winston.info('bitstamp server requesting reset of connection...');
        // clear Timeout
        clearTimeout(this.timeoutMonitor);
        // Close connection
        wsConnection.terminate();
        // the onclose will handle the rest w/ the restart
      }
    };

    wsConnection.onclose = function() {
      winston.info('bitstamp webSocket connection closed, restarting in 30 seconds');

      // clear Timeout
      clearTimeout(this.timeoutMonitor);

      // clean kill the websocket
      wsConnection.terminate();

      // Attempt a restart of listener, wait 30 seconds
      setTimeout(() => {
        winston.info('attempting restart of startBitstampListener now...');
        startBitstampListener();
      }, 300000);

    };

    // Send subscribe message to WS
    wsConnection.onopen = function() {
      // Like Bitso, we want to ensure we are seeing all the activity, aka, more data! (Bitstamp seems better about this.. )
      wsConnection.send(JSON.stringify({event: 'bts:subscribe', data: { channel: 'live_orders_xrpusd' }}));
      wsConnection.send(JSON.stringify({event: 'bts:subscribe', data: { channel: 'live_trades_xrpusd' }}));
      heartBeat();
    };

    // Our heart beat for ws.. basic, but does the job.. hopefully :-) 90 seconds
    let heartBeat = function() {
      winston.debug(`❤️❤️❤️\t Bitstamp heartbeat detected... Queue depth of ${queueQueueSize()}`);
      clearTimeout(this.timeoutMonitor);
      this.timeoutMonitor = setTimeout(() => {
        winston.warning(`${CLR.red('Warning:')} Bitstamp listener went silent for over 90 seconds, restarting listener...`);
        wsConnection.terminate();
      }, 90000);
    };
  } catch (error) {
    winston.error('encountered error in bitstamp.startBitstampListener: %s', error);
  }
};
