import { createClient } from "@supabase/supabase-js";

const url = (import.meta.env.VITE_SUPABASE_URL as string)?.trim();
const key = (import.meta.env.VITE_SUPABASE_ANON_KEY as string)?.trim();
if (!url || !key) throw new Error("Variáveis VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY não configuradas.");

export const supabase = createClient(url, key);
