/*
  Connect to the Coins.ph  WebSocket, and listen to Order and Trade events
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
  console.log(`Error in coinsph.js: ${error}`);
}

/** ************************************************
 Simple Array Bucket, holder of simple objects
 w/ TTL of 120 seconds, then delete
***************************************************/
let CoinsTXQueue = [];
let CoinsTXQueueCNTR = 0;
let CoinsHBCNTR = 0;
let isInit = true;

exports.getQueue = function() {
  return CoinsTXQueue;
};

let queueTTLProcessor = function() {
  try {
    // Remove anything over older then 2 minutes
    let minuteOld = Math.floor((new Date().getTime() / 1000) - 120);
    CoinsTXQueue = CoinsTXQueue.filter(o => {
      if (o.time <= minuteOld) {
        return false;
      } else {
        return true;
      }
    });
  } catch (error) {
    winston.error('encountered error in coins.queueTTLProcessor: %s', error);
  }
};

let queueQueueSize = function(){
  return CoinsTXQueue.length;
};

exports.messageProcessor = messageProcessor = function(obj){
  try {
    if (!Array.isArray(obj) || !obj.length) {
      return;
    } else {
      // Process incoming trades
      let data = obj[0];
      //  Pos indicates data type
      //  let tradeNumber = data[0];
      //  let instId = data[1];
      let amount = parseFloat(parseFloat(data[2]).toFixed(4)); // XRP
      //  let value = data[3];

      let time = parseInt(data[4] / 1000, 10);
      let buySell = ((data[6] === 0) ? 'b' : 's');

      CoinsTXQueue.push({type: buySell, xrp: amount, time: time});
      winston.debug(`${CLR.blueBright('Coinsph ')} ${buySell}, ${amount}, ${time}, Array Size: ${queueQueueSize()}`);
    }
  } catch (error) {
    winston.error('encountered error in coins.messageProcessor: %s', error);
  }
};


exports.startCoinsListener = startCoinsListener = function() {
  try {
    // Setting Coins Server wss endpoint
    let msg = `Coins.ph client connecting to: ${CLR.whiteBright(config.coinsph.server)}`;
    if (isInit === true) {
      console.log(msg);
    }
    isInit = false;
    winston.info(msg);
    const wsConnection = new WebSocket(config.coinsph.server);

    // Set Handlers for API events
    wsConnection.onerror = function(error) {
      winston.error("encountered error with coins webSocket: %s", JSON.stringify(error));
    };

    wsConnection.onmessage = function(e) {
      if (e.type === 'message') {
        let response = JSON.parse(e.data);
        if (response.m === 3 && response.n === 'TradeDataUpdateEvent') {
          // Parse the payload for processing
          let odata = JSON.parse(response.o);
          messageProcessor(odata);
        }
      }

      // Heartbeat trigger
      if (CoinsHBCNTR >= 1) {
        CoinsHBCNTR = 0;
        heartBeat();
      } else {
        CoinsHBCNTR++;
      }

      // A hack way to trigger the processor for TTL
      CoinsTXQueueCNTR++;
      if (CoinsTXQueueCNTR >= 10) {
        queueTTLProcessor();
        CoinsTXQueueCNTR = 0;
      }

    };

    // Handle closures
    wsConnection.onclose = function() {
      winston.info('bitstamp webSocket connection closed, restarting in 30 seconds');

      // clear Timeout
      clearTimeout(this.timeoutMonitor);

      // clean kill the websocket
      wsConnection.terminate();

      // Attempt a restart of listener, wait 30 seconds
      setTimeout(() => {
        winston.info('attempting restart of startCoinsListener now...');
        startCoinsListener();
      }, 300000);

    };

    // Send subscribe message to WS
    wsConnection.onopen = function() {
      // Subscribe to XRPPHP trades
      let frame = { m: 0, i: 0, n: 'SubscribeTrades', o: ''};
      let requestPayload = {OMSId: 1, InstrumentId: 8, IncludeLastCount: 1};
      frame.o = JSON.stringify(requestPayload);
      wsConnection.send(JSON.stringify(frame));

      // Subscribe to XRPTHB trades
      frame = { m: 0, i: 0, n: 'SubscribeTrades', o: ''};
      requestPayload = {OMSId: 1, InstrumentId: 3, IncludeLastCount: 0};
      frame.o = JSON.stringify(requestPayload);
      wsConnection.send(JSON.stringify(frame));

      heartBeat();
    };

    // Our heart beat for ws.. basic, but does the job.. hopefully :-)
    let heartBeat = function() {
      // console.log(`❤️❤️❤️\t Coins heartbeat detected... Queue depth of ${queueQueueSize()}`);
      clearTimeout(this.timeoutMonitor);
      this.timeoutMonitor = setTimeout(() => {
        console.log(`${CLR.red('Warning:')} Coins listener went silent, restarting listener...`);
        wsConnection.terminate();
      }, 300000); // five minutes, not much traffic here
    };
  } catch (error) {
    winston.error('encountered error in coins.startCoinsListener: %s', error);
  }
};

// Refrence Only

/* Instruments */
// let instruments = [
//   {
//     "InstrumentId": 9,
//     "Symbol": "XRPETH",
//     "Product1": 5,
//     "Product1Symbol": "XRP",
//     "Product2": 3,
//     "Product2Symbol": "ETH",
//     "InstrumentType": "Standard"
//   },
//   {
//     "InstrumentId": 6,
//     "Symbol": "BTCPHP",
//     "Product1": 1,
//     "Product1Symbol": "BTC",
//     "Product2": 7,
//     "Product2Symbol": "PHP",
//     "InstrumentType": "Standard"
//   },
//   {
//     "InstrumentId": 2,
//     "Symbol": "BCHTHB",
//     "Product1": 4,
//     "Product1Symbol": "BCH",
//     "Product2": 6,
//     "Product2Symbol": "THB",
//     "InstrumentType": "Standard"
//   },
//   {
//     "InstrumentId": 11,
//     "Symbol": "ETHPHP",
//     "Product1": 3,
//     "Product1Symbol": "ETH",
//     "Product2": 7,
//     "Product2Symbol": "PHP",
//     "InstrumentType": "Standard"
//   },
//   {
//     "InstrumentId": 8,
//     "Symbol": "XRPPHP",
//     "Product1": 5,
//     "Product1Symbol": "XRP",
//     "Product2": 7,
//     "Product2Symbol": "PHP",
//     "InstrumentType": "Standard"
//   },
//   {
//     "InstrumentId": 7,
//     "Symbol": "BCHPHP",
//     "Product1": 4,
//     "Product1Symbol": "BCH",
//     "Product2": 7,
//     "Product2Symbol": "PHP",
//     "InstrumentType": "Standard"
//   },
//   {
//     "InstrumentId": 13,
//     "Symbol": "BCHBTC",
//     "Product1": 4,
//     "Product1Symbol": "BCH",
//     "Product2": 1,
//     "Product2Symbol": "BTC",
//     "InstrumentType": "Standard"
//   },
//   {
//     "InstrumentId": 4,
//     "Symbol": "ETHTHB",
//     "Product1": 3,
//     "Product1Symbol": "ETH",
//     "Product2": 6,
//     "Product2Symbol": "THB",
//     "InstrumentType": "Standard"
//   },
//   {
//     "InstrumentId": 14,
//     "Symbol": "XRPBTC",
//     "Product1": 5,
//     "Product1Symbol": "XRP",
//     "Product2": 1,
//     "Product2Symbol": "BTC",
//     "InstrumentType": "Standard"
//   },
//   {
//     "InstrumentId": 3,
//     "Symbol": "XRPTHB",
//     "Product1": 5,
//     "Product1Symbol": "XRP",
//     "Product2": 6,
//     "Product2Symbol": "THB",
//     "InstrumentType": "Standard"
//   },
//   {
//     "InstrumentId": 12,
//     "Symbol": "ETHBTC",
//     "Product1": 3,
//     "Product1Symbol": "ETH",
//     "Product2": 1,
//     "Product2Symbol": "BTC",
//     "InstrumentType": "Standard"
//   },
//   {
//     "InstrumentId": 5,
//     "Symbol": "LTCTHB",
//     "Product1": 2,
//     "Product1Symbol": "LTC",
//     "Product2": 6,
//     "Product2Symbol": "THB",
//     "InstrumentType": "Standard"
//   },
//   {
//     "InstrumentId": 10,
//     "Symbol": "LTCPHP",
//     "Product1": 2,
//     "Product1Symbol": "LTC",
//     "Product2": 7,
//     "Product2Symbol": "PHP",
//     "InstrumentType": "Standard"
//   },
//   {
//     "InstrumentId": 1,
//     "Symbol": "BTCTHB",
//     "Product1": 1,
//     "Product1Symbol": "BTC",
//     "Product2": 6,
//     "Product2Symbol": "THB",
//     "InstrumentType": "Standard"
//   }
// ];

/* Products */
// let coinsphProducts = [
//   {
//     "ProductId": 7,
//     "Product": "PHP",
//     "ProductFullName": "Philippine Peso",
//     "ProductType": "NationalCurrency",
//     "DecimalPlaces": 2
//   },
//   {
//     "ProductId": 6,
//     "Product": "THB",
//     "ProductFullName": "Thai Baht",
//     "ProductType": "NationalCurrency",
//     "DecimalPlaces": 2
//   },
//   {
//     "ProductId": 4,
//     "Product": "BCH",
//     "ProductFullName": "Bitcoin Cash",
//     "ProductType": "CryptoCurrency",
//     "DecimalPlaces": 8
//   },
//   {
//     "ProductId": 2,
//     "Product": "LTC",
//     "ProductFullName": "Litecoin",
//     "ProductType": "CryptoCurrency",
//     "DecimalPlaces": 8
//   },
//   {
//     "ProductId": 3,
//     "Product": "ETH",
//     "ProductFullName": "Ethereum",
//     "ProductType": "CryptoCurrency",
//     "DecimalPlaces": 8
//   },
//   {
//     "ProductId": 5,
//     "Product": "XRP",
//     "ProductFullName": "Ripple",
//     "ProductType": "CryptoCurrency",
//     "DecimalPlaces": 8
//   },
//   {
//     "ProductId": 1,
//     "Product": "BTC",
//     "ProductFullName": "Bitcoin",
//     "ProductType": "CryptoCurrency",
//     "DecimalPlaces": 8
//   }
// ];
