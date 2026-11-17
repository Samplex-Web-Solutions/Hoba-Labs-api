// src/controllers/adminController.js
import { supabase } from '../config/supabase.js';

/**
 * Get all platform users along with their broker account connection status and EA access
 */
export async function getAllUsersAdmin(req, res) {
  try {
    // Fetch users with their associated broker accounts
    const { data: users, error: usersError } = await supabase
      .from('users')
      .select(`
        id,
        email,
        client_id,
        ea_access,
        is_admin,
        created_at,
        broker_accounts (
          account_login,
          server_name,
          connection_status,
          balance,
          equity,
          updated_at
        )
      `)
      .order('created_at', { ascending: false });

    if (usersError) throw usersError;

    return res.status(200).json({
      success: true,
      count: users.length,
      users: users || []
    });
  } catch (err) {
    console.error('[ADMIN_GET_USERS_ERROR]:', err.message);
    return res.status(500).json({ success: false, error: 'Failed to fetch platform users.' });
  }
}

/**
 * Grant or revoke EA access for a specific user
 */
export async function updateUserEaAccess(req, res) {
  try {
    const { targetUserId } = req.params;
    const { ea_access } = req.body;

    if (typeof ea_access !== 'boolean') {
      return res.status(400).json({ success: false, error: 'Invalid payload. "ea_access" must be a boolean.' });
    }

    const { data: updatedUser, error } = await supabase
      .from('users')
      .update({ ea_access, updated_at: new Date().toISOString() })
      .eq('id', targetUserId)
      .select('id, email, ea_access')
      .single();

    if (error) throw error;

    console.log(`[ADMIN_ACTION]: Admin ${req.adminEmail} updated user ${updatedUser.email} EA access to: ${ea_access}`);

    return res.status(200).json({
      success: true,
      message: `User EA access successfully ${ea_access ? 'granted' : 'revoked'}.`,
      user: updatedUser
    });
  } catch (err) {
    console.error('[ADMIN_UPDATE_EA_ERROR]:', err.message);
    return res.status(500).json({ success: false, error: 'Failed to update user EA access.' });
  }
}

/**
 * Get platform-wide statistics (Total users, active EA connections, total balances)
 */
export async function getAdminPlatformStats(req, res) {
  try {
    const { count: totalUsers } = await supabase
      .from('users')
      .select('*', { count: 'exact', head: true });

    const { count: activeEaUsers } = await supabase
      .from('users')
      .select('*', { count: 'exact', head: true })
      .eq('ea_access', true);

    const { data: connectedAccounts } = await supabase
      .from('broker_accounts')
      .select('balance, equity, connection_status');

    const totalManagedCapital = connectedAccounts?.reduce((sum, acc) => sum + Number(acc.balance || 0), 0) || 0;
    const activeConnections = connectedAccounts?.filter(acc => acc.connection_status === 'CONNECTED').length || 0;

    return res.status(200).json({
      success: true,
      stats: {
        totalUsers: totalUsers || 0,
        activeEaUsers: activeEaUsers || 0,
        totalConnectedBrokers: connectedAccounts?.length || 0,
        activeBrokerConnections: activeConnections,
        totalManagedCapital
      }
    });
  } catch (err) {
    console.error('[ADMIN_STATS_ERROR]:', err.message);
    return res.status(500).json({ success: false, error: 'Failed to fetch platform stats.' });
  }
}