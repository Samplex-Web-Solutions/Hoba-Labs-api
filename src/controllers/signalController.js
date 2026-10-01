import { supabase } from '../config/supabase.js';

export const getSignals = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('signals')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;

    res.status(200).json({ success: true, signals: data });
  } catch (err) {
    console.error('Error fetching signals:', err.message);
    res.status(500).json({ success: false, message: 'Server error fetching signals' });
  }
};