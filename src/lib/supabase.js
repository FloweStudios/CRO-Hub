import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  process.env.REACT_APP_SUPABASE_URL,
  process.env.REACT_APP_SUPABASE_ANON_KEY
);

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  return { data, error };
}

export async function signOut() {
  return supabase.auth.signOut();
}

export function onAuthChange(cb) {
  return supabase.auth.onAuthStateChange((_event, session) => cb(session));
}

export async function getPartners() {
  const { data, error } = await supabase
    .from('clients')
    .select('*')
    .order('created_at', { ascending: false });
  return { data, error };
}

export async function createPartner({ name, domain }) {
  const secret = Array.from(crypto.getRandomValues(new Uint8Array(24)))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
    + '-' + Date.now().toString(36);

  const { data: { user } } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from('clients')
    .insert({ id, name, domain, secret_key: secret, owner_id: user.id })
    .select()
    .single();

  return { data, error };
}

export async function deletePartner(id) {
  const { error } = await supabase.from('clients').delete().eq('id', id);
  return { error };
}

export async function getPartnerStats(clientId, days = 30) {
  const since = new Date(Date.now() - days * 86400000).toISOString();

  const { data, error } = await supabase
    .from('events')
    .select('type')
    .eq('client_id', clientId)
    .gte('created_at', since);

  if (error) return { pageviews: 0, clicks: 0 };

  return {
    pageviews: data.filter(e => e.type === 'pageview').length,
    clicks:    data.filter(e => e.type === 'click').length,
  };
}
