import { validateIccPayload } from '../icc/validator/validator.js';
import { evaluateIccSetup } from '../icc/engine/engine.js';
import { dispatchAndLogSignal } from '../services/icc/iccNotificationService.js';

/**
 * Handles incoming market evaluation requests for the ICC trading engine.
 */
export async function processIccSignal(req, res) {
  try {
    const payload = req.body;

    // 1. Strict Enterprise Validation
    const validation = validateIccPayload(payload);
    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        error: 'VALIDATION_ERROR',
        message: validation.message,
        timestamp: new Date().toISOString()
      });
    }

    const { pair, bars, aois } = payload;

    // 2. Execute ICC Strategy Evaluation
    const signal = evaluateIccSetup(pair, bars, aois);

    if (!signal) {
      return res.status(200).json({
        success: true,
        status: 'NO_SETUP',
        message: 'Market conditions do not match current ICC criteria.',
        timestamp: new Date().toISOString()
      });
    }

    // 3. Dispatch & Log (Asynchronous)
    dispatchAndLogSignal(signal);

    return res.status(200).json({
      success: true,
      status: 'SIGNAL_GENERATED',
      data: {
        action: signal.bias === 'BULLISH' ? 'BUY' : 'SELL',
        pair: signal.pair,
        entryPrice: signal.entryPrice,
        stopLoss: signal.stopLoss,
        takeProfit: signal.takeProfit,
        aoiId: signal.aoiId,
        confidenceScore: signal.confidenceScore || 1.0,
        timestamp: signal.timestamp
      }
    });

  } catch (error) {
    console.error(`${error.message}`, error.stack);
    
    return res.status(500).json({
      success: false,
      error: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred while processing the trading signal.',
      timestamp: new Date().toISOString()
    });
  }
}