import axios from 'axios';

/**
 * Checks if current time falls within a 30-minute pre/post high-impact USD news buffer.
 */
export async function isNewsBlocked() {
  try {
    // Example integration with a financial calendar API or ForexFactory scraper
    // For production, you can cache today's high-impact events or query a calendar API endpoint
    const now = new Date();
    
    // Placeholder for fetched high-impact events (DateTime objects)
    // In production, fetch events where currency === 'USD' and impact === 'High'
    const highImpactEvents = []; 

    const BUFFER_MINUTES = 30;

    for (const eventTime of highImpactEvents) {
      const diffMinutes = (now.getTime() - eventTime.getTime()) / (1000 * 60);

      // If within 30 mins before (-30) or 30 mins after (+30) the news event
      if (diffMinutes >= -BUFFER_MINUTES && diffMinutes <= BUFFER_MINUTES) {
        console.log(`[NEWS_FILTER]: Trade blocked due to high-impact news at ${eventTime.toISOString()}`);
        return true;
      }
    }

    return false;
  } catch (err) {
    console.error('[NEWS_FILTER_ERROR]:', err.message);
    return false; // Fail open or closed depending on risk preference (default open with warning)
  }
}