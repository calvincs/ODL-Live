/*
  Connect to the Bitso WebSocket, and listen to Order and Trade events
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
  console.log(`Error in bitso.js: ${error}`);
}

/** ************************************************
 Simple Array Bucket, holder of simple objects
 w/ TTL of 120 seconds, then delete
***************************************************/
let BitsoTXQueue = [];
let BitsoTXQueueCNTR = 0;
let BitsoHBCNTR = 0;
let isInit = true;

exports.getQueue = function() {
  return BitsoTXQueue;
};

let queueTTLProcessor = function() {
  try {
    // Remove anything over older then 2 minutes
    let minuteOld = Math.floor((new Date().getTime() / 1000) - 120);

    BitsoTXQueue = BitsoTXQueue.filter(o => {
      if (o.time <= minuteOld) {
        return false;
      } else {
        return true;
      }
    });
  } catch (error) {
    winston.error('encountered error in bitso.getQueue: %s', error);
  }
};

let queueQueueSize = function(){
  return BitsoTXQueue.length;
};

let messageProcessor = function(obj){
  try {
    if (!Array.isArray(obj.payload) || !obj.payload.length) {
      return;
    } else {
      let data = obj.payload[0];

      // Processing incoming trades
      if (obj.type === 'trades') {
        // Transform into a standard object for processing
        let buySell = ((data.t === 0) ? 'b' : 's');
        let amount = parseFloat(parseFloat(data.a).toFixed(4)); // XRP
        let time = Math.floor(Date.now() / 1000); // User current local, as not provided from stream

        BitsoTXQueue.push({type: buySell, xrp: amount, time: time});
        winston.debug(`${CLR.blue('Bitso ')} ${buySell}, ${amount}, ${time}, Array Size: ${queueQueueSize()}`);
      }

      // Processing diff-orders
      if (obj.type === 'diff-orders') {
        // Sanity testing
        if (data.s === 'cancelled' || isNaN(data.a) === true) {
          return;
        }
        // Transform into a standard object for processing
        let buySell = ((data.t === 0) ? 'b' : 's');
        let amount = parseFloat(parseFloat(data.a).toFixed(4)); // XRP
        let time = Math.floor(parseInt(data.d, 10) / 1000);

        BitsoTXQueue.push({type: buySell, xrp: amount, time: time});
        winston.debug(`${CLR.red('Bitso ')} ${buySell}, ${amount}, ${time}, Array Size: ${queueQueueSize()}`);
      }
    }
  } catch (error) {
    winston.error('encountered error in bitso.messageProcessor: %s', error);
  }
};


exports.startBitsoListener = startBitsoListener = function() {
  try {

    // Setting Bitso Server wss endpoint
    let msg = `Bitso client connecting to: ${CLR.whiteBright(config.bitso.server)}`;
    if (isInit === true) {
      console.log(msg);
    }
    isInit = false;
    winston.info(msg);
    const wsConnection = new WebSocket(config.bitso.server);

    // Set Handlers for API events
    wsConnection.onerror = function(error) {
      winston.error("encountered error with bitso webSocket: %s", JSON.stringify(error));
    };

    wsConnection.onmessage = function(e) {
      let response = JSON.parse(e.data);
      if (response.type !== 'ka') {
        messageProcessor(response);
      } else {
        // Stop multi trigger from "ka" from multiple streams
        if (BitsoHBCNTR > 4) {
          BitsoHBCNTR = 0;
          heartBeat();
        } else {
          BitsoHBCNTR++;
        }
      }

      // A hack way to trigger the processor for TTL
      BitsoTXQueueCNTR++;
      if (BitsoTXQueueCNTR >= 25) {
        queueTTLProcessor();
        BitsoTXQueueCNTR = 0;
      }

    };

    // Handle closures
    wsConnection.onclose = function() {
      winston.info('bitso webSocket connection closed, restarting in 30 seconds');

      // clear Timeout
      clearTimeout(this.timeoutMonitor);

      // clean kill the websocket
      wsConnection.terminate();

      // Attempt a restart of listener, wait 30 seconds
      setTimeout(() => {
        winston.info('attempting restart of startBitsoListener now...');
        startBitsoListener();
      }, 300000);
    };

    // Send subscribe message to WS
    wsConnection.onopen = function() {
      // Bitso doesnt display all trades or orders, need both for completeness.
      wsConnection.send(JSON.stringify({ action: 'subscribe', book: 'xrp_mxn', type: 'diff-orders' }));
      wsConnection.send(JSON.stringify({ action: 'subscribe', book: 'xrp_mxn', type: 'trades' }));
      heartBeat();
    };

    // Our heart beat for ws.. basic, but does the job.. hopefully :-)
    let heartBeat = function() {
      winston.debug(`❤️❤️❤️\t Bitso heartbeat detected... Queue depth of ${queueQueueSize()}`);
      clearTimeout(this.timeoutMonitor);
      this.timeoutMonitor = setTimeout(() => {
        winston.warning(`${CLR.red('Warning:')} Bitso listener went silent for over 90 seconds, restarting listener...`);
        wsConnection.terminate();
      }, 90000);
    };
  } catch (error) {
    winston.error('encountered error in bitso.startBitsoListener: %s', error);
  }
};

