import { dispatchAndLogSignal } from './services/iccNotificationService.js'; // Adjust path to your service file

async function runTest() {
  console.log('Sending test signal to Telegram and Supabase...');

  const mockSignal = {
    pair: 'EURUSD',
    bias: 'BULLISH',
    entryPrice: 1.0850,
    stopLoss: 1.0820,
    takeProfit: 1.0920,
    aoiId: 'test_aoi_999',
    timestamp: Date.now()
  };

  const success = await dispatchAndLogSignal(mockSignal);

  if (success) {
    console.log('✅ Test signal dispatched successfully!');
  } else {
    console.log('❌ Test signal dispatch failed. Check console errors above.');
  }
}

runTest();