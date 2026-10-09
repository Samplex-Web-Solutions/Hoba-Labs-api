import axios from 'axios';

/**
 * Fetch high-impact economic calendar events from Biquote
 */
export async function fetchEconomicCalendar(importance = 'high', limit = 20) {
  try {
    const response = await axios.get('https://biquote.io/api/calendar', {
      params: { 
        importance: importance, // 'high', 'medium', 'low'
        limit: limit 
      },
      headers: { 'Accept': 'application/json' }
    });

    return response.data || [];
  } catch (err) {
    console.error('[BIQUOTE_CALENDAR_ERROR]:', err.message);
    return [];
  }
}