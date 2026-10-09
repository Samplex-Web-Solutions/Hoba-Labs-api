import axios from 'axios';

/**
 * Fetch economic calendar events for today only
 */
export async function fetchTodayCalendar(importance = '') {
  try {
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);

    const endOfDay = new Date();
    endOfDay.setUTCHours(23, 59, 59, 999);

    const params = {
      from: startOfDay.toISOString(),
      to: endOfDay.toISOString(),
    };

    if (importance) params.importance = importance;

    const response = await axios.get('https://biquote.io/api/calendar', {
      params,
      headers: { 'Accept': 'application/json' }
    });

    return response.data || [];
  } catch (err) {
    console.error('[BIQUOTE_CALENDAR_ERROR]:', err.message);
    return [];
  }
}