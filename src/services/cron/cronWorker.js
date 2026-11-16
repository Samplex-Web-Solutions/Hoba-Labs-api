import cron from 'node-cron';
import { supabase } from '../config/supabase.js';

export function startCronWorker() {
  // Runs every day at midnight (00:00 UTC)
  cron.schedule('0 0 * * *', async () => {
    console.log('[Cron Worker] Running daily subscription expiration check...');

    try {
      const now = new Date().toISOString();

      // 1. Fetch active keys past their expiration date
      const { data: expiredKeys, error } = await supabase
        .from('license_keys')
        .select('id, user_id, key_code')
        .eq('status', 'ACTIVE')
        .lt('expires_at', now);

      if (error) throw error;

      if (!expiredKeys || expiredKeys.length === 0) {
        console.log('[Cron Worker] No expired subscriptions today.');
        return;
      }

      console.log(`[Cron Worker] Found ${expiredKeys.length} expired license keys. Deactivating...`);

      const expiredUserIds = expiredKeys.map(k => k.user_id);
      const expiredKeyIds = expiredKeys.map(k => k.id);

      // 2. Mark license keys as EXPIRED
      await supabase
        .from('license_keys')
        .update({ status: 'EXPIRED' })
        .in('id', expiredKeyIds);

      // 3. Disable EA access for expired users
      await supabase
        .from('users')
        .update({ ea_access: false })
        .in('id', expiredUserIds);

      // 4. Update broker connection status to DISCONNECTED
      await supabase
        .from('broker_accounts')
        .update({ connection_status: 'DISCONNECTED' })
        .in('user_id', expiredUserIds);

      console.log('[Cron Worker] Successfully deactivated expired accounts.');
    } catch (err) {
      console.error('[Cron Worker Error]', err.message);
    }
  });

  console.log('[Cron Worker] Subscription expiration monitor initialized.');
}