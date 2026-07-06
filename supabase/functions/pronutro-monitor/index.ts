import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logAudit } from "../_shared/audit.ts";

const UAZAPI_URL   = Deno.env.get("UAZAPI_URL")   || "https://btechsoutoshop.uazapi.com";
const UAZAPI_TOKEN = Deno.env.get("UAZAPI_TOKEN") || "";
const SUPABASE_URL = "https://pvphgusjofufwtyiyviu.supabase.co";
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const ALERT_PHONE  = "5561982025951";
const POLL_URL     = `${SUPABASE_URL}/functions/v1/pronutro-poll`;
const AI_FIX_URL   = `${SUPABASE_URL}/functions/v1/pronutro-ai-fix`;

const db = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── Utilitários ────────────────────────────────────────────────────────────────

function brTime(): string {
  return new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

/** Horário de Brasília (UTC-3). Retorna true entre 7h e 22h. */
function isBusinessHours(): boolean {
  const h = new Date(Date.now() - 3 * 60 * 60 * 1000).getUTCHours();
  return h >= 7 && h < 22;
}

// Alerta pro Bruno sempre pelo WhatsApp da BTech, não pelo da ProNutro
// (o paciente não pode ver notificação de sistema saindo do número da clínica)
const ALERT_TOKEN = Deno.env.get("UAZAPI_ALERT_TOKEN") || UAZAPI_TOKEN;

async function sendAlert(text: string): Promise<void> {
  await fetch(`${UAZAPI_URL}/send/text`, {
    method: "POST",
    headers: { "Content-Type": "application/json", token: ALERT_TOKEN },
    body: JSON.stringify({ number: ALERT_PHONE, text }),
  }).catch(e => console.error("sendAlert failed:", e));
}

async function wasAlertedRecently(type: string, cooldownMin = 60): Promise<boolean> {
  const { data } = await db.from("pn_config")
    .select("value").eq("key", `monitor_last_${type}`).maybeSingle();
  if (!data?.value) return false;
  return Date.now() - new Date(data.value).getTime() < cooldownMin * 60_000;
}

async function markAlerted(type: string): Promise<void> {
  await db.from("pn_config")
    .upsert({ key: `monitor_last_${type}`, value: new Date().toISOString() });
}

// ── Checks ────────────────────────────────────────────────────────────────────

interface CheckResult {
  type: string;
  ok: boolean;
  message?: string;
  autoFixed?: boolean;
}

/** Poll deve ter sido executado há menos de 7 minutos */
async function checkPoll(): Promise<CheckResult> {
  const { data } = await db.from("pn_poll_state")
    .select("last_poll_at").eq("id", 1).single();

  if (!data?.last_poll_at) {
    return { type: "poll", ok: false, message: "pn_poll_state sem registro — poll nunca rodou?" };
  }

  const ageMin = (Date.now() - new Date(data.last_poll_at).getTime()) / 60_000;

  if (ageMin > 7) {
    let fixed = false;
    try {
      const r = await fetch(POLL_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${SUPABASE_KEY}` },
      });
      fixed = r.ok;
    } catch { /* silencia */ }

    return {
      type: "poll",
      ok: false,
      autoFixed: fixed,
      message: `Poll parado há ${Math.round(ageMin)} min — auto-restart ${fixed ? "✅ executado" : "❌ FALHOU"}`,
    };
  }

  return { type: "poll", ok: true };
}

/** Verifica leads com Maria ativa mas sem resposta entre 30 min e 2h atrás */
async function checkMariaStuck(): Promise<CheckResult> {
  if (!isBusinessHours()) return { type: "maria_stuck", ok: true };

  const cutoffMin = new Date(Date.now() - 30 * 60_000).toISOString();
  const cutoffMax = new Date(Date.now() - 2 * 60 * 60_000).toISOString();

  const { data: leads } = await db
    .from("pn_leads")
    .select("id, name, phone, last_message_at")
    .eq("ai_mode", true)
    .not("stage", "eq", "perdido")
    .lte("last_message_at", cutoffMin)
    .gte("last_message_at", cutoffMax)
    .limit(20);

  if (!leads?.length) return { type: "maria_stuck", ok: true };

  let stuckCount = 0;
  const stuckNames: string[] = [];

  for (const lead of leads) {
    const { data: lastIn } = await db
      .from("pn_mensagens")
      .select("id, created_at")
      .eq("lead_id", lead.id)
      .eq("direction", "in")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!lastIn) continue;

    // Ignora leads cuja última mensagem chegou fora do horário comercial
    const lastInHour = new Date(new Date(lastIn.created_at).getTime() - 3 * 60 * 60 * 1000).getUTCHours();
    if (lastInHour < 7 || lastInHour >= 22) continue;

    const { count } = await db
      .from("pn_mensagens")
      .select("id", { count: "exact", head: true })
      .eq("lead_id", lead.id)
      .eq("direction", "out")
      .gt("created_at", lastIn.created_at);

    if ((count ?? 0) === 0) {
      stuckCount++;
      stuckNames.push(lead.name || lead.phone);
      if (stuckNames.length >= 3) break;
    }
  }

  if (stuckCount === 0) return { type: "maria_stuck", ok: true };

  const extra = stuckCount > 3 ? ` (+${stuckCount - 3} outros)` : "";
  return {
    type: "maria_stuck",
    ok: false,
    message: `Maria sem responder ${stuckCount} lead(s) há +30min: ${stuckNames.join(", ")}${extra}`,
  };
}

/** Verifica se houve agendamentos na última hora (apenas horário comercial 9h-18h) */
async function checkAgendamentos(): Promise<CheckResult> {
  const hour = new Date(Date.now() - 3 * 60 * 60 * 1000).getUTCHours();
  const isBusinessHour = hour >= 9 && hour < 18;
  if (!isBusinessHour) return { type: "agendamentos", ok: true };

  const since = new Date(Date.now() - 60 * 60_000).toISOString();

  const { count } = await db
    .from("pn_agendamentos")
    .select("id", { count: "exact", head: true })
    .eq("status", "confirmado")
    .gte("created_at", since);

  if ((count ?? 0) === 0) {
    const { count: totalLeads } = await db
      .from("pn_leads")
      .select("id", { count: "exact", head: true })
      .eq("ai_mode", true)
      .not("stage", "eq", "perdido");

    if ((totalLeads ?? 0) > 5) {
      return {
        type: "agendamentos",
        ok: false,
        message: `Nenhum agendamento novo na última hora (${totalLeads} leads ativos com Maria)`,
      };
    }
  }

  return { type: "agendamentos", ok: true };
}

// ── Monitor principal ─────────────────────────────────────────────────────────

async function runMonitor() {
  const results = await Promise.all([
    checkPoll(),
    checkMariaStuck(),
    checkAgendamentos(),
  ]);

  const failed = results.filter(r => !r.ok);
  const fixed  = failed.filter(r => r.autoFixed);

  // Coleta quais issues precisam de alerta (single-pass para evitar race com cooldown)
  const toAlert: CheckResult[] = [];
  for (const r of failed) {
    const alerted = await wasAlertedRecently(r.type, 60);
    if (!alerted && r.message) toAlert.push(r);
  }

  const fixRequests: Promise<void>[] = [];
  for (const r of toAlert) {
    await markAlerted(r.type);
    fixRequests.push(
      fetch(AI_FIX_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${SUPABASE_KEY}` },
        body: JSON.stringify({ issue_type: r.type, issue_message: r.message }),
      }).then(() => {}).catch(e => console.error("ai-fix dispatch error:", e))
    );
  }

  await Promise.allSettled(fixRequests);

  if (toAlert.length > 0) {
    console.log("Issues detectados, AI-Fix acionado:", toAlert.map(r => r.message));
    for (const r of toAlert) {
      await logAudit({
        action: "MONITOR_ALERT",
        severity: r.type === "poll" ? "critical" : "warning",
        metadata: { issue_type: r.type, message: r.message, auto_fixed: r.autoFixed ?? false },
      });
    }
  } else {
    console.log("Monitor v3 OK — sem alertas");
    await logAudit({ action: "MONITOR_OK", severity: "info", metadata: { checks: results.map(r => r.type) } });
  }

  return {
    checked: results.map(r => r.type),
    issues: failed.length,
    dispatched_to_ai_fix: toAlert.length,
    autoFixed: fixed.map(r => r.type),
  };
}

// ── Handler ───────────────────────────────────────────────────────────────────

Deno.serve(async (_req: Request) => {
  const cors = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };
  if (_req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const result = await runMonitor();
    return new Response(JSON.stringify(result), { headers: cors });
  } catch (err) {
    console.error("monitor error", err);
    await sendAlert(`🔴 *ProNutro Monitor — FALHA CRÍTICA*\n${String(err)}\n\n_${brTime()}_`).catch(() => {});
    await logAudit({ action: "MONITOR_CRASH", severity: "critical", metadata: { error: String(err) } });
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: cors });
  }
});
