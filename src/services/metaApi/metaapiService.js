import MetaApi from 'metaapi.cloud-sdk/esm-node';
import { supabase } from '../../config/supabase.js';
const token = process.env.METAAPI_TOKEN;
const metaApi = new MetaApi(token);

/**
 * Initializes or fetches a cloud MetaApi account connection for a user
 */
export async function getConnectedMetaApiAccount(userId) {
  try {
    // 1. Fetch broker account credentials from Supabase
    const { data: brokerAcc, error } = await supabase
      .from('broker_accounts')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error || !brokerAcc) {
      throw new Error('Broker account credentials not found for user.');
    }

    let metaapiAccountId = brokerAcc.metaapi_account_id;

    // 2. If account isn't provisioned on MetaApi yet, provision it
    if (!metaapiAccountId) {
      const account = await metaApi.metatraderAccountApi.createAccount({
        name: `HobaLabs User ${userId}`,
        type: 'cloud',
        login: brokerAcc.account_login,
        password: brokerAcc.encrypted_password,
        server: brokerAcc.server_name,
        platform: 'mt5',
        provisioningProfile: process.env.METAAPI_PROVISIONING_PROFILE_ID,
      });

      metaapiAccountId = account.id;

      // Save metaapi_account_id back to database
      await supabase
        .from('broker_accounts')
        .update({ metaapi_account_id: metaapiAccountId })
        .eq('id', brokerAcc.id);

      // Deploy and wait for connection
      await account.deploy();
      await account.waitConnected();
    }

    const account = await metaApi.metatraderAccountApi.getAccount(metaapiAccountId);
    const connection = account.getRpcConnection();
    await connection.connect();
    await connection.waitSynchronized();

    return { connection, brokerAcc };
  } catch (err) {
    console.error('[METAAPI_CONNECTION_ERROR]:', err.message);
    throw err;
  }
}