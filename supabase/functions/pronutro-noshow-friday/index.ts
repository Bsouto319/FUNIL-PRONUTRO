import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const UAZAPI_URL = Deno.env.get("UAZAPI_URL") || "https://btechsoutoshop.uazapi.com";
const UAZAPI_TOKEN = Deno.env.get("UAZAPI_TOKEN") || "";
const SUPABASE_URL = "https://pvphgusjofufwtyiyviu.supabase.co";
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "apikey,authorization,content-type",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
};

function todayRangeBrasilia() {
  // Servidor roda em UTC. Brasilia = UTC-3, sem horario de verao.
  const now = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  const dateStr = `${y}-${m}-${d}`;
  return { start: `${dateStr}T00:00:00`, end: `${dateStr}T23:59:59` };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const db = createClient(SUPABASE_URL, SUPABASE_KEY);
    const { start, end } = todayRangeBrasilia();

    const { data: agendamentos, error } = await db
      .from("pn_agendamentos")
      .select("id, data_hora, status, lead:pn_leads(id, name, whatsapp_name, phone)")
      .gte("data_hora", start)
      .lte("data_hora", end)
      .eq("status", "confirmado");

    if (error) throw error;

    const results: Array<{ id: string; ok: boolean }> = [];

    for (const ag of (agendamentos || []) as any[]) {
      const lead = ag.lead;
      if (!lead?.phone) continue;
      const nome = lead.name || lead.whatsapp_name || "";

      // Mensagem 100% ASCII (UAZAPI corrompe acentos/emoji)
      const msg = [
        `Ola${nome ? ", " + nome : ""}!`,
        "Notamos que voce nao compareceu a consulta agendada hoje na Clinica ProNutro.",
        "Temos horario disponivel amanha (sexta-feira) para te atender.",
        "Quer que a gente reserve um horario pra voce?",
      ].join(" ");

      const res = await fetch(`${UAZAPI_URL}/send/text`, {
        method: "POST",
        headers: { "Content-Type": "application/json", token: UAZAPI_TOKEN },
        body: JSON.stringify({ number: lead.phone, text: msg }),
      });

      const ok = res.ok;
      if (ok) {
        await db.from("pn_agendamentos").update({ status: "no_show", updated_at: new Date().toISOString() }).eq("id", ag.id);
      }
      results.push({ id: ag.id, ok });
    }

    return new Response(JSON.stringify({ ok: true, total: results.length, results }), {
      headers: { "Content-Type": "application/json", ...CORS },
    });
  } catch (e) {
    console.error("pronutro-noshow-friday error", e);
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500, headers: { "Content-Type": "application/json", ...CORS },
    });
  }
});
