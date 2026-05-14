import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL   = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const UAZAPI_URL     = Deno.env.get("UAZAPI_URL")!;
const UAZAPI_TOKEN   = Deno.env.get("UAZAPI_TOKEN")!;
const OPENAI_KEY     = Deno.env.get("OPENAI_KEY")!;

const db = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── Maria system prompt ───────────────────────────────────────────────────────

const MARIA_PROMPT = `Você é Maria, assistente virtual da Clínica ProNutro em Brasília.
Comunicação: ágil, humana, empática e focada em agendamento.

MÉDICOS E VALORES:
- Dr. Augusto Margon: Nutrologia/Psiquiatria — R$930
- Dr. Celso Melo: Nutrologia/Cirurgia Proctológica — R$650
- Dr. Marcus Gesteira: Emagrecimento — R$560 (aceita convênio)
- Dra. Vanessa Melo: Pediatria e Nutrologia — R$560 (aceita convênio)
- Dra. Kelly Felippes: Saúde e Fertilidade — R$500
- Gisele Falcão: Enfermagem Estética — R$200

OBJETIVO: Qualificar o lead, descobrir qual médico ele quer, e agendar uma consulta.

FLUXO:
1. Saudação calorosa + pergunta sobre necessidade
2. Identifique médico/especialidade desejada
3. Pergunte se particular ou convênio
4. Para convênio: informe quais médicos aceitam
5. Quando o paciente confirmar interesse real em agendar, responda com action:"agendar" no JSON
6. Se desistir ou não responder, action:"perdido"

RESPONDA SEMPRE NESTE JSON:
{
  "message": "texto da resposta ao paciente",
  "action": "none|agendar|perdido",
  "medico_interesse": "nome do médico se mencionado, senão null",
  "stage": "novo_lead|maria_ia|interesse_real|agendado|perdido"
}`;

// ── UAZAPI helpers ────────────────────────────────────────────────────────────

async function sendWA(phone: string, text: string) {
  try {
    await fetch(`${UAZAPI_URL}/send/text`, {
      method: "POST",
      headers: { "Content-Type": "application/json", token: UAZAPI_TOKEN },
      body: JSON.stringify({ number: phone, text }),
    });
  } catch (e) {
    console.error("sendWA error", e);
  }
}

async function pollMessages(): Promise<any[]> {
  const { data: state } = await db.from("pn_poll_state").select("*").eq("id", 1).maybeSingle();
  const lastTs = state?.last_message_timestamp || 0;

  const res = await fetch(`${UAZAPI_URL}/messages/list`, {
    method: "POST",
    headers: { "Content-Type": "application/json", token: UAZAPI_TOKEN },
    body: JSON.stringify({ timestamp: lastTs, limit: 100 }),
  });
  if (!res.ok) return [];
  const json = await res.json();
  return json.messages || json || [];
}

async function updatePollState(ts: number) {
  await db.from("pn_poll_state").upsert({ id: 1, last_message_timestamp: ts, updated_at: new Date().toISOString() });
}

// ── Maria AI ──────────────────────────────────────────────────────────────────

async function mariaRespond(lead: any): Promise<void> {
  const { data: msgs } = await db
    .from("pn_mensagens")
    .select("direction, body, sender_nome")
    .eq("lead_id", lead.id)
    .order("created_at", { ascending: true })
    .limit(30);

  const history = (msgs || []).map((m: any) => ({
    role: m.direction === "in" ? "user" : "assistant",
    content: m.body,
  }));

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({
      model: "gpt-4o",
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: MARIA_PROMPT }, ...history],
    }),
  });

  const json = await res.json();
  const raw = json.choices?.[0]?.message?.content || "{}";
  let parsed: any = {};
  try { parsed = JSON.parse(raw); } catch { return; }

  const { message, action, stage } = parsed;

  if (message) {
    await sendWA(lead.phone, message);
    await db.from("pn_mensagens").insert({
      lead_id: lead.id,
      body: message,
      direction: "out",
      sender_nome: "Maria IA",
      created_at: new Date().toISOString(),
    });
  }

  if (stage && stage !== lead.stage) {
    await db.from("pn_leads").update({ stage, updated_at: new Date().toISOString() }).eq("id", lead.id);
  }

  if (action === "perdido") {
    await db.from("pn_leads").update({ stage: "perdido", ai_mode: false, updated_at: new Date().toISOString() }).eq("id", lead.id);
  }
}

// ── Main poll ─────────────────────────────────────────────────────────────────

async function runPoll() {
  const { data: cfg } = await db.from("pn_config").select("value").eq("key", "maria_global_mode").maybeSingle();
  const mariaActive = cfg?.value === "true";

  const messages = await pollMessages();
  if (!messages.length) return;

  let maxTs = 0;

  for (const msg of messages) {
    if (msg.fromMe) continue;

    const phone = (msg.phone || msg.from || "").replace(/\D/g, "");
    if (!phone) continue;

    const body = msg.body || msg.text || "";
    const ts   = msg.timestamp || msg.messageTimestamp || 0;
    if (ts > maxTs) maxTs = ts;

    // Upsert lead
    let { data: lead } = await db.from("pn_leads").select("*").eq("phone", phone).maybeSingle();
    if (!lead) {
      const { data: newLead } = await db.from("pn_leads").insert({
        phone,
        name: msg.pushName || msg.senderName || null,
        stage: "novo_lead",
        ai_mode: mariaActive,
        first_message: body.slice(0, 500),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).select().single();
      lead = newLead;
    }

    if (!lead) continue;

    // Save inbound message
    const { count } = await db.from("pn_mensagens")
      .select("id", { count: "exact" })
      .eq("lead_id", lead.id)
      .eq("body", body)
      .gte("created_at", new Date(Date.now() - 5000).toISOString());

    if ((count || 0) === 0) {
      await db.from("pn_mensagens").insert({
        lead_id: lead.id,
        body,
        direction: "in",
        created_at: new Date(ts * 1000).toISOString(),
      });
    }

    // Maria response
    if (mariaActive && lead.ai_mode && lead.stage !== "perdido") {
      await mariaRespond(lead);
    }
  }

  if (maxTs > 0) await updatePollState(maxTs);
}

// ── Edge function handler ─────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };

  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    await runPoll();
    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("poll error", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});