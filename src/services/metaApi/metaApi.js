// src/services/metaApi.js
import axios from 'axios';
import { createClient } from '@supabase/supabase-js';
import ws from 'ws'; // Required for Node.js < 22 WebSocket support in Supabase client

// Initialize Supabase client using environment variables and ws transport
const supabase = createClient(
  process.env.SUPABASE_URL, 
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    realtime: {
      transport: ws,
    },
  }
);

const METAAPI_PROVISIONING_URL = 'https://mt-provisioning-api-v1.agiliumtrade.agiliumtrade.ai';

export async function provisionUserMetaApiAccount(userEmail, brokerLogin, brokerPassword, brokerServer) {
  try {
    const response = await axios.post(
      `${METAAPI_PROVISIONING_URL}/users/current/accounts`,
      {
        name: `Hoba Labs - ${userEmail}`,
        login: brokerLogin,
        password: brokerPassword,
        server: brokerServer,
        platform: 'mt5',
        application: 'MetaApi',
        reliability: 'high',
        region: 'london'
      },
      {
        headers: {
          'auth-token': process.env.METAAPI_TOKEN,
          'Content-Type': 'application/json'
        }
      }
    );

    const accountId = response.data.id;
    console.log(`[METAAPI_PROVISION]: Successfully provisioned account for ${userEmail}. ID: ${accountId}`);
    return accountId;
  } catch (err) {
    console.error('[METAAPI_PROVISION_ERROR]:', err.response?.data || err.message);
    throw new Error('Failed to provision broker account on MetaApi.');
  }
}

export async function linkSubscriberAccount(userId, brokerAccountId) {
  const { error } = await supabase
    .from('user_broker_accounts')
    .upsert({
      user_id: userId,
      broker_account_id: brokerAccountId,
      is_active: true,
      updated_at: new Date()
    }, { onConflict: ['user_id'] });

  if (error) {
    throw new Error(`Supabase linking failed: ${error.message}`);
  }
}