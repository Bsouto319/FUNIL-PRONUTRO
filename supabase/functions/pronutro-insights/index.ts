import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://pvphgusjofufwtyiyviu.supabase.co";
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const OPENAI_KEY   = Deno.env.get("OPENAI_KEY") || "";

const db = createClient(SUPABASE_URL, SUPABASE_KEY);

async function coletarMetricas() {
  const hoje = new Date();
  const inicioMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1).toISOString().split('T')[0];
  const fimMes    = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0).toISOString().split('T')[0];
  const inicio30  = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];

  const { data: agends } = await db.from("pn_agendamentos")
    .select("status, medico_id, medico:pn_medicos(nome, valor)")
    .gte("data_hora", `${inicioMes}T00:00:00`)
    .lte("data_hora", `${fimMes}T23:59:59`);

  const porMedico: Record<string, any> = {};
  for (const a of agends ?? []) {
    const nome  = (a.medico as any)?.nome || "Desconhecido";
    const valor = parseFloat((a.medico as any)?.valor || 0);
    if (!porMedico[nome]) porMedico[nome] = { nome, valor, confirmados: 0, no_show: 0, cancelados: 0, realizados: 0 };
    if (a.status === "confirmado")  porMedico[nome].confirmados++;
    if (a.status === "no_show")     porMedico[nome].no_show++;
    if (a.status === "cancelado")   porMedico[nome].cancelados++;
    if (a.status === "realizado")   porMedico[nome].realizados++;
  }
  const medicosList = Object.values(porMedico).map((m: any) => ({
    ...m,
    receita_confirmada: (m.confirmados + m.realizados) * m.valor,
    perda_no_show:      m.no_show * m.valor,
    perda_cancelados:   m.cancelados * m.valor,
    taxa_no_show:       (m.confirmados + m.realizados + m.no_show) > 0
      ? Math.round(m.no_show / (m.confirmados + m.realizados + m.no_show) * 100) : 0,
  }));

  const { data: leads } = await db.from("pn_leads").select("stage, ai_mode, created_at");
  const funil: Record<string, number> = {};
  let leadsMaria = 0, leadsAgendadosMaria = 0;
  for (const l of leads ?? []) {
    funil[l.stage] = (funil[l.stage] || 0) + 1;
    if (l.ai_mode) leadsMaria++;
    if (l.ai_mode && l.stage === "agendado") leadsAgendadosMaria++;
  }
  const totalLeads    = (leads ?? []).length;
  const totalAgendados = funil["agendado"] || 0;
  const convRate      = totalLeads > 0 ? Math.round(totalAgendados / totalLeads * 100) : 0;
  const roiMaria      = leadsMaria > 0 ? Math.round(leadsAgendadosMaria / leadsMaria * 100) : 0;

  const { data: fin } = await db.from("pn_financeiro")
    .select("valor")
    .gte("data_pagamento", `${inicioMes}T00:00:00`)
    .lte("data_pagamento", `${fimMes}T23:59:59`);
  const receitaRealizada = (fin ?? []).reduce((s: number, r: any) => s + parseFloat(r.valor || 0), 0);

  const inicioMesAnt = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1).toISOString().split('T')[0];
  const fimMesAnt    = new Date(hoje.getFullYear(), hoje.getMonth(), 0).toISOString().split('T')[0];
  const { data: finAnt } = await db.from("pn_financeiro")
    .select("valor")
    .gte("data_pagamento", `${inicioMesAnt}T00:00:00`)
    .lte("data_pagamento", `${fimMesAnt}T23:59:59`);
  const receitaMesAnterior = (finAnt ?? []).reduce((s: number, r: any) => s + parseFloat(r.valor || 0), 0);
  const variacaoReceita = receitaMesAnterior > 0
    ? Math.round((receitaRealizada - receitaMesAnterior) / receitaMesAnterior * 100) : 0;

  const { count: leadsNovos30 } = await db.from("pn_leads")
    .select("id", { count: "exact", head: true })
    .gte("created_at", `${inicio30}T00:00:00`);

  const totalPerdaNoShow     = medicosList.reduce((s, m) => s + m.perda_no_show, 0);
  const totalPerdaCancelados = medicosList.reduce((s, m) => s + m.perda_cancelados, 0);
  const totalAgendsMes       = medicosList.reduce((s, m) => s + m.confirmados + m.realizados + m.no_show + m.cancelados, 0);
  const totalNoShowGlobal    = medicosList.reduce((s, m) => s + m.no_show, 0);
  const taxaNoShowGlobal     = totalAgendsMes > 0 ? Math.round(totalNoShowGlobal / totalAgendsMes * 100) : 0;
  const revPAS               = totalAgendsMes > 0 ? Math.round(receitaRealizada / totalAgendsMes) : 0;
  const medicoDestaque       = medicosList.sort((a, b) => b.receita_confirmada - a.receita_confirmada)[0]?.nome || null;

  return {
    periodo: { inicio: inicioMes, fim: fimMes },
    funil, totalLeads,
    leadsNovos30: leadsNovos30 || 0,
    taxaConversao: convRate,
    roiMaria, leadsMaria, leadsAgendadosMaria,
    receitaRealizada: Math.round(receitaRealizada),
    receitaMesAnterior: Math.round(receitaMesAnterior),
    variacaoReceita, revPAS, taxaNoShowGlobal,
    totalPerdaNoShow: Math.round(totalPerdaNoShow),
    totalPerdaCancelados: Math.round(totalPerdaCancelados),
    totalOportunidadePerdida: Math.round(totalPerdaNoShow + totalPerdaCancelados),
    medicoDestaque,
    medicos: medicosList,
  };
}

async function gerarBriefingGPT(metricas: any): Promise<any> {
  if (!OPENAI_KEY) throw new Error("OPENAI_KEY not configured");
  const prompt = `Você é um consultor financeiro especialista em gestão de clínicas médicas.
Use os modelos: RevPAS (Revenue per Available Slot), Taxa de Utilização, Análise de No-Show, Funil de Conversão e ROI de automação.

Dados da clínica ProNutro (período: ${metricas.periodo.inicio} a ${metricas.periodo.fim}):

## FINANCEIRO
- Receita realizada: R$ ${metricas.receitaRealizada} | Mês anterior: R$ ${metricas.receitaMesAnterior} | Variação: ${metricas.variacaoReceita}%
- RevPAS: R$ ${metricas.revPAS} | Perda no-show: R$ ${metricas.totalPerdaNoShow} | Perda cancelamentos: R$ ${metricas.totalPerdaCancelados}
- TOTAL OPORTUNIDADE PERDIDA: R$ ${metricas.totalOportunidadePerdida}

## AGENDA
- Taxa no-show global: ${metricas.taxaNoShowGlobal}% | Médico destaque: ${metricas.medicoDestaque}

## FUNIL DE LEADS
- Total: ${metricas.totalLeads} | Novos (30d): ${metricas.leadsNovos30} | Conversão: ${metricas.taxaConversao}%
- Distribuição: ${JSON.stringify(metricas.funil)}

## ROI MARIA IA
- Leads com IA: ${metricas.leadsMaria} | Agendados pela IA: ${metricas.leadsAgendadosMaria} | Taxa IA: ${metricas.roiMaria}%

## MÉDICOS
${metricas.medicos.map((m: any) => `${m.nome}: ${m.confirmados + m.realizados} consultas | No-show: ${m.no_show} (${m.taxa_no_show}%) | Perda: R$ ${m.perda_no_show}`).join('\n') || 'Sem dados de agenda no período'}

Gere análise executiva. Responda SOMENTE em JSON:
{"briefing":"narrativa executiva de 2-3 frases diretas","bullets":["insight 1","insight 2","insight 3","insight 4"],"recomendacao":"uma ação prioritária concreta para esta semana","score_saude":numero 0-100,"alerta":"alerta crítico se existir ou null","medico_destaque":"nome do médico com melhor performance ou null"}`;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({ model: "gpt-4o", response_format: { type: "json_object" }, messages: [{ role: "user", content: prompt }] }),
  });
  if (!res.ok) throw new Error(`GPT error ${res.status}`);
  const data = await res.json();
  return JSON.parse(data.choices[0].message.content);
}

async function runInsights() {
  const metricas = await coletarMetricas();
  const gpt      = await gerarBriefingGPT(metricas);
  const row = {
    periodo_inicio:       metricas.periodo.inicio,
    periodo_fim:          metricas.periodo.fim,
    metricas,
    briefing:             gpt.briefing,
    bullets:              gpt.bullets,
    oportunidade_perdida: metricas.totalOportunidadePerdida,
    recomendacao:         gpt.recomendacao,
    score_saude:          gpt.score_saude,
    medico_destaque:      gpt.medico_destaque,
    alerta:               gpt.alerta,
    created_at:           new Date().toISOString(),
  };
  await db.from("pn_insights").insert(row);
  return { ok: true, score: gpt.score_saude, oportunidade_perdida: metricas.totalOportunidadePerdida };
}

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

Deno.serve(async (_req) => {
  if (_req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const result = await runInsights();
    return new Response(JSON.stringify(result), { headers: CORS });
  } catch (err) {
    console.error("insights error", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: CORS });
  }
});
