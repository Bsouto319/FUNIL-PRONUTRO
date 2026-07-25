import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const db = createClient(SUPABASE_URL, SUPABASE_KEY);

export interface AuditEntry {
  action: string;
  table_name?: string;
  record_id?: string;
  user_phone?: string;
  severity?: "info" | "warning" | "error" | "critical";
  metadata?: Record<string, unknown>;
  old_data?: Record<string, unknown>;
  new_data?: Record<string, unknown>;
}

export async function logAudit(entry: AuditEntry): Promise<void> {
  try {
    await db.from("audit_logs").insert({
      project:    "pronutro",
      action:     entry.action,
      table_name: entry.table_name  ?? null,
      record_id:  entry.record_id   ?? null,
      user_phone: entry.user_phone  ?? null,
      severity:   entry.severity    ?? "info",
      metadata:   entry.metadata    ?? {},
      old_data:   entry.old_data    ?? null,
      new_data:   entry.new_data    ?? null,
      created_at: new Date().toISOString(),
    });
  } catch (e) {
    // Nunca deixar falha de log derrubar a função principal
    console.error("audit_log failed:", e);
  }
}
