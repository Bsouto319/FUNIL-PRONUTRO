import { createClient } from "@supabase/supabase-js";

const url = (import.meta.env.VITE_SUPABASE_URL as string)?.trim();
const key = (import.meta.env.VITE_SUPABASE_ANON_KEY as string)?.trim();
if (!url || !key) throw new Error("Variáveis VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY não configuradas.");

export const supabase = createClient(url, key, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    storageKey: "pn-auth-v2",
    storage: window.localStorage,
  },
  realtime: {
    params: { eventsPerSecond: 10 },
    heartbeatIntervalMs: 20000,
    reconnectAfterMs: (tries: number) => Math.min(tries * 600, 8000),
  },
});
