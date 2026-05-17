import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const UAZAPI_URL   = "https://btechsoutoshop.uazapi.com";
const UAZAPI_TOKEN = "5efd90a1-116b-4c86-b715-7bac2fab658a";
const SUPABASE_URL = "https://pvphgusjofufwtyiyviu.supabase.co";
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const OPENAI_KEY   = Deno.env.get("OPENAI_KEY") || "";
const ALERT_PHONE  = "5561982025951";
const POLL_URL     = `${SUPABASE_URL}/functions/v1/pronutro-poll`;

const db = createClient(SUPABASE_URL, SUPABASE_KEY);

function brTime(): string {
  return new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

// ── Ferramentas disponíveis para o agente ─────────────────────────────────────

const TOOLS = [
  {
    type: "function",
    function: {
      name: "get_system_status",
      description: "Retorna o estado atual do sistema: último poll, leads com Maria ativa, últimos erros.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "restart_poll",
      description: "Reinicia o pronutro-poll (função que processa mensagens WhatsApp).",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "get_lead_info",
      description: "Busca informações de um lead pelo nome ou telefone.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Nome ou telefone parcial do lead" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "fix_lead_ai",
      description: "Liga ou desliga a Maria IA para um lead específico.",
      parameters: {
        type: "object",
        properties: {
          lead_id: { type: "string" },
          ai_mode: { type: "boolean" },
        },
        required: ["lead_id", "ai_mode"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_lead_stage",
      description: "Atualiza o stage de um lead no pipeline.",
      parameters: {
        type: "object",
        properties: {
          lead_id: { type: "string" },
          stage: {
            type: "string",
            enum: ["novo_lead", "maria_ia", "interesse_real", "agendado", "perdido"],
          },
        },
        required: ["lead_id", "stage"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "notify_owner",
      description: "Envia mensagem WhatsApp ao responsável da clínica. Usar SOMENTE se não conseguir resolver.",
      parameters: {
        type: "object",
        properties: {
          message: { type: "string" },
        },
        required: ["message"],
      },
    },
  },
];

// ── Implementação das ferramentas ─────────────────────────────────────────────

async function toolGetSystemStatus(): Promise<object> {
  const [pollState, activeLeads, recentMsgs] = await Promise.all([
    db.from("pn_poll_state").select("last_poll_at, last_message_timestamp").eq("id", 1).single(),
    db.from("pn_leads").select("id, name, stage, ai_mode", { count: "exact" }).eq("ai_mode", true).not("stage", "eq", "perdido"),
    db.from("pn_mensagens").select("direction, created_at").order("created_at", { ascending: false }).limit(10),
  ]);

  const lastPoll    = pollState.data?.last_poll_at;
  const pollAgeMin  = lastPoll ? Math.round((Date.now() - new Date(lastPoll).getTime()) / 60_000) : null;

  return {
    poll: { last_poll_at: lastPoll, age_minutes: pollAgeMin, healthy: (pollAgeMin ?? 999) < 5 },
    active_leads_with_maria: activeLeads.count ?? 0,
    recent_leads: (activeLeads.data ?? []).slice(0, 5).map(l => ({ id: l.id, name: l.name, stage: l.stage })),
    recent_messages: recentMsgs.data ?? [],
    timestamp: brTime(),
  };
}

async function toolRestartPoll(): Promise<object> {
  try {
    const r = await fetch(POLL_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${SUPABASE_KEY}` },
    });
    const body = await r.json().catch(() => ({}));
    return { success: r.ok, status: r.status, response: body };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

async function toolGetLeadInfo(query: string): Promise<object> {
  const { data } = await db.from("pn_leads")
    .select("id, name, phone, stage, ai_mode, last_message_at")
    .or(`name.ilike.%${query}%,phone.ilike.%${query}%`)
    .limit(5);
  return { leads: data ?? [] };
}

async function toolFixLeadAi(leadId: string, aiMode: boolean): Promise<object> {
  const { error } = await db.from("pn_leads")
    .update({ ai_mode: aiMode, updated_at: new Date().toISOString() })
    .eq("id", leadId);
  return { success: !error, error: error?.message };
}

async function toolUpdateLeadStage(leadId: string, stage: string): Promise<object> {
  const { error } = await db.from("pn_leads")
    .update({ stage, updated_at: new Date().toISOString() })
    .eq("id", leadId);
  return { success: !error, error: error?.message };
}

async function toolNotifyOwner(message: string): Promise<object> {
  await fetch(`${UAZAPI_URL}/send/text`, {
    method: "POST",
    headers: { "Content-Type": "application/json", token: UAZAPI_TOKEN },
    body: JSON.stringify({ number: ALERT_PHONE, text: message }),
  }).catch(() => {});
  return { sent: true };
}

async function executeTool(name: string, args: any): Promise<string> {
  let result: object;
  switch (name) {
    case "get_system_status":  result = await toolGetSystemStatus(); break;
    case "restart_poll":       result = await toolRestartPoll(); break;
    case "get_lead_info":      result = await toolGetLeadInfo(args.query); break;
    case "fix_lead_ai":        result = await toolFixLeadAi(args.lead_id, args.ai_mode); break;
    case "update_lead_stage":  result = await toolUpdateLeadStage(args.lead_id, args.stage); break;
    case "notify_owner":       result = await toolNotifyOwner(args.message); break;
    default:                   result = { error: `Tool desconhecida: ${name}` };
  }
  return JSON.stringify(result);
}

// ── Loop agêntico ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `Você é um agente autônomo de SRE (Site Reliability Engineering) do sistema ProNutro — CRM de uma clínica médica em Brasília que usa WhatsApp + IA para agendamentos.

Seu objetivo: diagnosticar e corrigir problemas automaticamente, sem intervenção humana.

Regras:
1. Sempre tente corrigir antes de notificar o dono
2. Use get_system_status para entender o contexto antes de agir
3. Após corrigir, verifique se funcionou
4. Use notify_owner SOMENTE se: (a) não conseguiu corrigir, ou (b) a correção impactou dados críticos e o dono precisa saber
5. Seja eficiente: máximo 5 rodadas de ferramentas
6. Responda sempre em português`;

async function runAgentLoop(issueType: string, issueMessage: string): Promise<{ fixed: boolean; actions: string[]; finalMessage: string }> {
  const messages: any[] = [
    {
      role: "user",
      content: `Problema detectado no sistema ProNutro:\n\nTipo: ${issueType}\nDetalhes: ${issueMessage}\n\nDiagnostique e corrija agora.`,
    },
  ];

  const actions: string[] = [];
  let fixed = false;

  for (let round = 0; round < 5; round++) {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_KEY}` },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
        tools: TOOLS,
        tool_choice: "auto",
      }),
    });

    if (!res.ok) {
      console.error("OpenAI error:", res.status);
      break;
    }

    const data = await res.json();
    const choice = data.choices[0];
    const assistantMsg = choice.message;
    messages.push(assistantMsg);

    // Sem mais tool calls — agente terminou
    if (!assistantMsg.tool_calls || assistantMsg.tool_calls.length === 0) {
      const content = assistantMsg.content || "";
      fixed = content.toLowerCase().includes("corrig") ||
              content.toLowerCase().includes("resolvid") ||
              content.toLowerCase().includes("reiniciad");
      return { fixed, actions, finalMessage: content };
    }

    // Executa todas as tool calls desta rodada
    for (const tc of assistantMsg.tool_calls) {
      const toolName = tc.function.name;
      const toolArgs = JSON.parse(tc.function.arguments || "{}");

      console.log(`[AI-Fix] Tool: ${toolName}`, toolArgs);
      actions.push(toolName);

      const toolResult = await executeTool(toolName, toolArgs);

      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: toolResult,
      });

      if (toolName === "restart_poll") {
        const parsed = JSON.parse(toolResult);
        if (parsed.success) fixed = true;
      }
    }
  }

  return { fixed, actions, finalMessage: "Limite de rodadas atingido." };
}

// ── Handler ───────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  const cors = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const body = await req.json().catch(() => ({}));
    const issueType    = body.issue_type    || "desconhecido";
    const issueMessage = body.issue_message || "Sem detalhes";

    console.log(`[AI-Fix] Recebido: ${issueType} — ${issueMessage}`);

    const result = await runAgentLoop(issueType, issueMessage);

    // Se não conseguiu corrigir e não enviou notify_owner, envia alerta manual
    if (!result.fixed && !result.actions.includes("notify_owner")) {
      await toolNotifyOwner(
        `🔴 *ProNutro AI-Fix — Não Resolvido*\n\nProblema: ${issueMessage}\n\nAções tentadas: ${result.actions.join(", ") || "nenhuma"}\n\nIntervença manual necessária.\n\n_${brTime()}_`
      );
    } else if (result.fixed) {
      // Correção silenciosa — apenas loga. Notifica só se foi restart_poll (impacto visível)
      if (result.actions.includes("restart_poll")) {
        await toolNotifyOwner(
          `✅ *ProNutro AI-Fix — Auto-corrigido*\n\nProblema: ${issueMessage}\n\nAção: Poll reiniciado automaticamente.\n\n_${brTime()}_`
        );
      }
    }

    return new Response(JSON.stringify(result), { headers: cors });
  } catch (err) {
    console.error("ai-fix error", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: cors });
  }
});
