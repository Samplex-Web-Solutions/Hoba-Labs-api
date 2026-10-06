import cron from 'node-cron';
import axios from 'axios';
import { calculateOrderBlocks } from '../utils/orderBlock/orderBlockDetector.js';
import { evaluateIccSetup } from '../icc/engine/engine.js';
import { dispatchAndLogSignal } from '../services/icc/iccNotificationService.js';

// Expanded target pairs covering Forex and Crypto markets
const TARGET_PAIRS = ['XAUUSD', 'EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCAD', 'NZDUSD', 'USDCHF', 'BTCUSD', 'ETHUSD'];

// Run automated scan every 5 minutes
cron.schedule('*/5 * * * *', async () => {
  console.log('[Scanner Worker] Running automated market scan...');

  try {
    for (const pair of TARGET_PAIRS) {
      // 1. Fetch historical OHLCV candle bars required for OB & FVG detection
      // Endpoint aligned with biquote.io /api/{symbol}/ohlc contract structure
      const response = await axios.get(`https://biquote.io/api/${pair}/ohlc`, {
        params: { interval: '5m', limit: 50 }
      });

      const liveBars = response.data?.bars || response.data;
      if (!Array.isArray(liveBars) || liveBars.length < 20) {
        console.warn(`[Scanner Worker] Insufficient bars returned for ${pair}`);
        continue;
      }

      // 2. Automatically calculate Order Blocks and Fair Value Gaps (AOIs)
      const activeAois = calculateOrderBlocks(liveBars);

      // 3. Run ICC engine evaluation (validates trend bias, AOI tap, and LTF confirmation)
      const signal = evaluateIccSetup(pair, liveBars, activeAois);

      // 4. Dispatch automatically if setup triggers
      if (signal) {
        console.log(`[Scanner Worker] Setup found for ${pair}! Dispatching signal...`);
        await dispatchAndLogSignal(signal);
      }
    }
  } catch (error) {
    console.error(`[Scanner Worker] Automated scan error: ${error.message}`);
  }
});





// import cron from 'node-cron';
// import axios from 'axios';
// import { calculateOrderBlocks } from '../utils/orderBlock/orderBlockDetector.js';
// import { evaluateIccSetup } from '../icc/engine/engine.js';
// import { dispatchAndLogSignal } from '../services/icc/iccNotificationService.js';

// const TARGET_PAIRS = ['XAUUSD', 'EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCAD', 'NZDUSD', 'USDCHF', 'BTCUSD', 'ETHUSD'];

// // Run automated scan every 5 minutes
// cron.schedule('*/5 * * * *', async () => {
//   console.log('[Scanner Worker] Running automated market scan...');

//   try {
//     // Construct batch query params as per biquote docs: ?symbols=XAUUSD&symbols=EURUSD...
//     const symbolParams = TARGET_PAIRS.map(pair => `symbols=${pair}`).join('&');
//     const response = await axios.get(`https://biquote.io/api/latest?${symbolParams}`);
    
//     const marketDataMap = response.data; // Assumes batch response maps symbol data

//     for (const pair of TARGET_PAIRS) {
//       const pairData = marketDataMap[pair];
//       if (!pairData || !pairData.bars || pairData.bars.length < 20) continue;

//       const liveBars = pairData.bars;

//       // 1. Automatically calculate Order Blocks (AOIs)
//       const activeAois = calculateOrderBlocks(liveBars);

//       // 2. Run ICC engine evaluation
//       const signal = evaluateIccSetup(pair, liveBars, activeAois);

//       // 3. Dispatch automatically if setup triggers
//       if (signal) {
//         console.log(`[Scanner Worker] Setup found for ${pair}! Dispatching signal...`);
//         await dispatchAndLogSignal(signal);
//       }
//     }
//   } catch (error) {
//     console.error(`[Scanner Worker] Batch scan ${TARGET_PAIRS.join(', ')} error: ${error.message}`);
//   }
// });