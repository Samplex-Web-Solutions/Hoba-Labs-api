import axios from 'axios';

/**
 * Fetch latest market or financial news from Biquote
 */
export async function fetchMarketNews(limit = 10) {
  try {
    // Note the lowercase 'news' in the path
    const response = await axios.get('https://biquote.io/api/news/market', {
      params: { maxResults: limit, language: 'en', country: 'US' },
      headers: { 'Accept': 'application/json' }
    });

    return response.data || [];
  } catch (err) {
    console.error('[BIQUOTE_NEWS_ERROR]:', err.message);
    return [];
  }
}