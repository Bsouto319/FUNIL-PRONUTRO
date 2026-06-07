import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://pvphgusjofufwtyiyviu.supabase.co";
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const OPENAI_KEY   = Deno.env.get("OPENAI_KEY") || "";

const db = createClient(SUPABASE_URL, SUPABASE_KEY);

const SYSTEM_PROMPT = `Você é Maria, assistente estratégica da clínica ProNutro (nutrição funcional), em Brasília-DF.

Sua tarefa tem DUAS etapas obrigatórias:

═══════════════════════════════════════════
ETAPA 1 — CLASSIFICAÇÃO DO CONTATO
═══════════════════════════════════════════
Antes de qualquer plano, classifique quem é esta pessoa:

- "paciente": Já realizou consulta(s) ou está em tratamento ativo na clínica. Conversa menciona retorno, plano alimentar, exames, etc.
- "lead_conversivel": Demonstrou interesse real em consultar — perguntou sobre preço, horários, procedimentos, nutricionistas, convênio. Ainda não agendou ou agendou mas não compareceu.
- "lead_frio": Fez contato inicial mas sem interesse claro, não respondeu follow-ups, ou a conversa sugere que não tem intenção de consultar.
- "interno": Parece ser profissional de saúde, nutricionista, médico, funcionário da clínica ou parceiro comercial. Mensagem tem tom profissional/institucional.
- "ruido": Mensagem errada, spam, número errado, sem contexto clínico, ou pessoa que não tem relação com a clínica.

═══════════════════════════════════════════
ETAPA 2 — PLANO DE FOLLOW-UP
═══════════════════════════════════════════
Com base na classificação, defina o plano:

TIPOS DISPONÍVEIS:
- "isca_educacional": Para lead_conversivel que fez perguntas técnicas (procedimentos, resultados, dieta). Enviar conteúdo educativo relevante ao que perguntou. SEM pedir agendamento diretamente.
- "isca_promocional": Para lead_conversivel com objeção de preço, parcelamento, convênio. Enviar condição especial, promoção ou calendário sem pedir agendamento diretamente.
- "reengajamento": Para lead_frio que sumiu após contato inicial. Mensagem empática e personalizada baseada no contexto, sem soar como vendedor.
- "checkin": Para paciente em tratamento. Check-in genuíno sobre saúde e evolução.
- "acompanhamento": Para lead_conversivel ativo que demonstrou interesse recente. Lembrete gentil e personalizado.
- "sem_acao": Para: paciente com conversa resolvida satisfatoriamente, interno, ruido, lead_frio sem histórico relevante. NÃO enviar nada.

REGRAS CRÍTICAS:
1. interno → sempre sem_acao
2. ruido → sempre sem_acao
3. SE a equipe já tentou contato 2+ vezes sem resposta → isca (nunca perguntar "tem interesse?" de novo)
4. paciente com conversa resolvida (agradeceu, pedido atendido) → sem_acao
5. A mensagem_sugerida deve soar como Maria enviando naturalmente, personalizada ao contexto
6. Para isca: apresentar como "novidade" ou "informação relevante", SEM CTA de agendamento explícito
7. Assinar sempre: *Maria | ProNutro* no final
8. Português brasileiro informal mas profissional, pode usar emojis com moderação
9. NUNCA usar termos de marketing na mensagem ("follow-up", "prospecção", "CRM" etc.)

═══════════════════════════════════════════
FORMATO DE RESPOSTA (JSON puro, sem markdown)
═══════════════════════════════════════════
{
  "classificacao": "paciente|lead_conversivel|lead_frio|interno|ruido",
  "classificacao_motivo": "1 frase explicando por que classificou assim",
  "tipo": "isca_educacional|isca_promocional|reengajamento|checkin|acompanhamento|sem_acao",
  "analise": "2-3 frases analisando o contexto da conversa e motivação do plano",
  "plano": "O que fazer, por quê e quando (visível apenas para a equipe)",
  "mensagem_sugerida": "Texto completo para WhatsApp (vazio se sem_acao)",
  "urgencia": "alta|media|baixa",
  "tags": ["objeção_preço", "perguntou_procedimento", etc]
}`;

Deno.serve(async (req) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { lead_id, batch } = await req.json();

    if (batch) {
      // Analisa leads ainda não analisados ou com plano com mais de 7 dias
      const { data: leads } = await db
        .from("pn_leads")
        .select("id, name, whatsapp_name, phone, stage, pn_followup_plans(id, created_at)")
        .not("stage", "in", '("perdido")')
        .limit(40);

      const toAnalyze = (leads || []).filter((l: any) => {
        const plan = l.pn_followup_plans?.[0];
        if (!plan) return true;
        const age = Date.now() - new Date(plan.created_at).getTime();
        return age > 7 * 86400000;
      });

      const results = [];
      for (const lead of toAnalyze) {
        try {
          const result = await analyzeLead(lead.id);
          results.push({ lead_id: lead.id, ...result });
        } catch (e) {
          results.push({ lead_id: lead.id, error: String(e) });
        }
      }

      return new Response(JSON.stringify({ analyzed: results.length, results }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const result = await analyzeLead(lead_id);
    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function analyzeLead(lead_id: string) {
  const { data: lead } = await db
    .from("pn_leads")
    .select("id, name, whatsapp_name, phone, stage, created_at, pn_agendamentos(id, status, data_hora)")
    .eq("id", lead_id)
    .single();

  if (!lead) throw new Error("Lead não encontrado: " + lead_id);

  const { data: messages } = await db
    .from("pn_mensagens")
    .select("direction, sender_nome, body, created_at")
    .eq("lead_id", lead_id)
    .order("created_at", { ascending: true })
    .limit(120);

  const nome = lead.name || lead.whatsapp_name || `+${lead.phone}`;
  const agendamentos = lead.pn_agendamentos || [];

  const conv = (messages || []).map((m: any) => {
    const ts     = new Date(m.created_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
    const sender = m.direction === "in" ? "👤 Paciente" : `💬 ${m.sender_nome || "Clínica"}`;
    return `${ts} ${sender}: ${m.body || ""}`;
  }).join("\n");

  // Lead sem histórico — classificar como lead_frio sem ação
  if (!conv.trim()) {
    const plan = {
      classificacao: "lead_frio",
      classificacao_motivo: "Nenhuma mensagem encontrada no histórico.",
      tipo: "sem_acao",
      analise: "Lead sem histórico de mensagens. Nenhuma ação recomendada.",
      plano: "Aguardar primeiro contato do lead.",
      mensagem_sugerida: "",
      urgencia: "baixa",
      tags: [],
    };
    await savePlan(lead_id, plan);
    return plan;
  }

  const userContent = `Lead: ${nome}
Stage atual no CRM: ${lead.stage}
Cadastrado em: ${new Date(lead.created_at).toLocaleDateString("pt-BR")}
Consultas no sistema: ${agendamentos.length > 0 ? `${agendamentos.length} agendamento(s)` : "nenhuma"}

--- HISTÓRICO COMPLETO DA CONVERSA ---
${conv}`;

  const gptRes = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENAI_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o",
      temperature: 0.35,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user",   content: userContent },
      ],
    }),
  });

  if (!gptRes.ok) {
    const errText = await gptRes.text();
    throw new Error("OpenAI error: " + errText);
  }

  const gptData = await gptRes.json();
  const raw = gptData.choices?.[0]?.message?.content || "{}";
  const plan = JSON.parse(raw);

  await savePlan(lead_id, plan);
  return plan;
}

async function savePlan(lead_id: string, plan: any) {
  await db.from("pn_followup_plans").upsert({
    lead_id,
    tipo:                   plan.tipo || "sem_acao",
    analise:                plan.analise || "",
    plano:                  plan.plano || "",
    mensagem_sugerida:      plan.mensagem_sugerida || "",
    urgencia:               plan.urgencia || "media",
    tags:                   plan.tags || [],
    status:                 "pendente",
    updated_at:             new Date().toISOString(),
    // Campos extras de classificação (adicionados via migration separada ou como jsonb)
  }, { onConflict: "lead_id" });

  // Salva a classificação na tabela de leads
  if (plan.classificacao) {
    await db.from("pn_leads").update({
      summary: plan.classificacao_motivo
        ? `[${plan.classificacao.toUpperCase()}] ${plan.classificacao_motivo}`
        : undefined,
    }).eq("id", lead_id);
  }
}
