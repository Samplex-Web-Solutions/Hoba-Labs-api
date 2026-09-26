import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import ws from 'ws'; 

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase URL or Service Role Key in environment variables.');
}

// Initialize Supabase Client with service role and WebSocket transport fix
export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false },
  realtime: { transport: ws }
});