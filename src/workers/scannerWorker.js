import cron from 'node-cron';
import axios from 'axios';
import { calculateOrderBlocks } from '../utils/orderBlock/orderBlockDetector.js';
import { evaluateIccSetup } from '../icc/engine/engine.js';
import { dispatchAndLogSignal } from '../services/icc/iccNotificationService.js';

const TARGET_PAIRS = ['XAUUSD', 'EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCAD', 'NZDUSD', 'USDCHF'];

// Run automated scan every 5 minutes
cron.schedule('*/5 * * * *', async () => {
  console.log('[Scanner Worker] Running automated market scan...');

  try {
    // Construct batch query params as per biquote docs: ?symbols=XAUUSD&symbols=EURUSD...
    const symbolParams = TARGET_PAIRS.map(pair => `symbols=${pair}`).join('&');
    const response = await axios.get(`https://biquote.io/api/latest?${symbolParams}`);
    
    const marketDataMap = response.data; // Assumes batch response maps symbol data

    for (const pair of TARGET_PAIRS) {
      const pairData = marketDataMap[pair];
      if (!pairData || !pairData.bars || pairData.bars.length < 20) continue;

      const liveBars = pairData.bars;

      // 1. Automatically calculate Order Blocks (AOIs)
      const activeAois = calculateOrderBlocks(liveBars);

      // 2. Run ICC engine evaluation
      const signal = evaluateIccSetup(pair, liveBars, activeAois);

      // 3. Dispatch automatically if setup triggers
      if (signal) {
        console.log(`[Scanner Worker] Setup found for ${pair}! Dispatching signal...`);
        await dispatchAndLogSignal(signal);
      }
    }
  } catch (error) {
    console.error(`[Scanner Worker] Batch scan ${TARGET_PAIRS.join(', ')} error: ${error.message}`);
  }
});