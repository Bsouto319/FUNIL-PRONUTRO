import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "apikey,authorization,content-type",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
};

// Paciente no estágio "Agendado" só sai da visão ativa do Kanban quando o
// dia da consulta já passou -- pedido do Bruno. Se ele tiver outra consulta
// futura confirmada, continua em "Agendado". Roda 1x por dia.
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const db = createClient(SUPABASE_URL, SUPABASE_KEY);
    const now = new Date().toISOString();

    const { data: leadsAgendados, error: leadsErr } = await db
      .from("pn_leads").select("id").eq("stage", "agendado");
    if (leadsErr) throw leadsErr;
    const leadIds = (leadsAgendados || []).map((l: any) => l.id);
    if (!leadIds.length) {
      return new Response(JSON.stringify({ ok: true, arquivados: 0 }), { headers: { "Content-Type": "application/json", ...CORS } });
    }

    // Lotes de 150 -- lista grande de UUIDs no .in() estoura o tamanho
    // maximo de requisicao HTTP/2 (visto na primeira rodada: 600+ leads
    // acumulados, nunca arquivados antes dessa automacao existir).
    const CHUNK = 150;
    const temFuturo = new Set<string>();
    for (let i = 0; i < leadIds.length; i += CHUNK) {
      const batch = leadIds.slice(i, i + CHUNK);
      const { data: futuros, error: futErr } = await db
        .from("pn_agendamentos")
        .select("lead_id")
        .in("lead_id", batch)
        .eq("status", "confirmado")
        .gte("data_hora", now);
      if (futErr) throw futErr;
      for (const f of (futuros || []) as any[]) temFuturo.add(f.lead_id);
    }

    const paraArquivar = leadIds.filter(id => !temFuturo.has(id));
    for (let i = 0; i < paraArquivar.length; i += CHUNK) {
      const batch = paraArquivar.slice(i, i + CHUNK);
      const { error: updErr } = await db.from("pn_leads")
        .update({ stage: "resolvido", updated_at: now })
        .in("id", batch);
      if (updErr) throw updErr;
    }

    console.log(`pronutro-arquivar-agendados: ${paraArquivar.length} arquivados de ${leadIds.length} em "agendado"`);
    return new Response(JSON.stringify({ ok: true, arquivados: paraArquivar.length, total_agendado: leadIds.length }), {
      headers: { "Content-Type": "application/json", ...CORS },
    });
  } catch (e: any) {
    console.error("pronutro-arquivar-agendados error", e);
    const detail = e?.message || e?.error_description || JSON.stringify(e);
    return new Response(JSON.stringify({ ok: false, error: detail }), {
      status: 500, headers: { "Content-Type": "application/json", ...CORS },
    });
  }
});
