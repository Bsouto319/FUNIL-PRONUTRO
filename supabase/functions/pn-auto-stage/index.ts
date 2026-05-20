import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const OPENAI_KEY  = Deno.env.get("OPENAI_API_KEY") ?? Deno.env.get("OPENAI_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const STAGES = [
  { key: "novo_lead",      label: "Novo Lead" },
  { key: "em_atendimento", label: "Em Atendimento" },
  { key: "conversando",    label: "Conversando" },
  { key: "aguardando",     label: "Aguardando" },
  { key: "agendado",       label: "Agendado" },
  { key: "resolvido",      label: "Resolvido" },
  { key: "financeiro",     label: "Financeiro" },
];

const PROTECTED_STAGES = ["agendado", "resolvido", "financeiro"];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" } });
  }

  try {
    const { lead_id } = await req.json();
    if (!lead_id) return new Response(JSON.stringify({ error: "lead_id required" }), { status: 400, headers: { "Content-Type": "application/json" } });

    const { data: lead } = await supabase.from("pn_leads").select("*").eq("id", lead_id).single();
    if (!lead) return new Response(JSON.stringify({ error: "lead not found" }), { status: 404, headers: { "Content-Type": "application/json" } });

    if (PROTECTED_STAGES.includes(lead.stage)) {
      return new Response(JSON.stringify({ ok: true, changed: false, reason: "stage_protected" }), { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
    }

    const { data: msgs } = await supabase.from("pn_mensagens").select("direction, body, sender_nome, created_at").eq("lead_id", lead_id).order("created_at", { ascending: false }).limit(15);
    const conversation = (msgs || []).reverse().map((m: any) => `[${m.direction === "in" ? "PACIENTE" : m.sender_nome || "SISTEMA"}]: ${m.body}`).join("\n");

    const stageList = STAGES.map(s => `- ${s.key}: ${s.label}`).join("\n");

    const prompt = `Você é um assistente de CRM para clínicas de nutrição. Analise a conversa abaixo e decida em qual etapa do funil este lead deve estar.

Stage atual: ${lead.stage}

Etapas disponíveis:
${stageList}

Regras:
- novo_lead: lead acabou de entrar, ainda não demonstrou interesse claro
- em_atendimento: sendo atendido pela Maria IA, ainda sem interesse confirmado
- conversando: demonstrou interesse genuíno, perguntou sobre preços ou disponibilidade
- aguardando: pediu para falar com humano, aguardando retorno da equipe
- agendado: confirmou agendamento — NÃO use este aqui (o agendamento é feito automaticamente)
- resolvido: pedido do paciente foi atendido com sucesso sem necessidade de consulta
- financeiro: paciente desistiu, não respondeu mais, ou tem pendências financeiras

Conversa:
${conversation || "(sem mensagens)"}

Primeiro nome do paciente: ${lead.name || lead.whatsapp_name || "desconhecido"}

Responda SOMENTE com JSON válido no formato:
{"stage": "<chave_do_stage>", "motivo": "<explicação em 1 linha>", "notificar": <true|false>, "mensagem_notif": "<texto curto para a secretária, se notificar=true>"}

notificar deve ser true apenas se algo importante aconteceu (urgência alta, lead quente, ou lead aguardando humano).`;

    const gptRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${OPENAI_KEY}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        max_tokens: 200,
        temperature: 0.2,
      }),
    });

    if (!gptRes.ok) {
      const errText = await gptRes.text();
      return new Response(JSON.stringify({ ok: false, error: `OpenAI error ${gptRes.status}`, detail: errText }), { status: 500, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
    }

    const gptData = await gptRes.json();
    const parsed = JSON.parse(gptData.choices?.[0]?.message?.content || "{}");
    const newStage = parsed.stage;

    if (!STAGES.find(s => s.key === newStage)) {
      return new Response(JSON.stringify({ ok: false, error: "invalid stage from GPT", raw: parsed }), { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
    }

    const changed = newStage !== lead.stage;

    if (changed) {
      await supabase.from("pn_leads").update({ stage: newStage, updated_at: new Date().toISOString() }).eq("id", lead_id);
    }

    if (parsed.notificar && parsed.mensagem_notif) {
      const typeMap: Record<string, string> = { financeiro: "retorno", conversando: "stage_change", resolvido: "stage_change", aguardando: "stage_change" };
      const notifType = typeMap[newStage] || "stage_change";
      await supabase.from("pn_notifications").insert({
        lead_id: lead_id,
        lead_name: lead.name || lead.whatsapp_name || `+${lead.phone}`,
        type: notifType,
        message: parsed.mensagem_notif,
        read: false,
      });
    }

    return new Response(
      JSON.stringify({ ok: true, changed, new_stage: newStage, motivo: parsed.motivo }),
      { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }
    );

  } catch (err: any) {
    return new Response(JSON.stringify({ ok: false, error: err.message }), { status: 500, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
  }
});
