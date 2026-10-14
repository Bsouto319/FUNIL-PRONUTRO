import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Site do Dr. Celso aponta pro ?medico=celso, site do Dr. Augusto pro
// ?medico=augusto -- cada site usa sua própria URL de webhook, cada lead já
// cai direto na coluna certa do médico no kanban.
const MEDICOS: Record<string, string> = {
  celso: "Dr. Celso Melo",
  augusto: "Dr. Augusto Margon",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const medicoKey = (url.searchParams.get("medico") || "").toLowerCase();
    const secret = url.searchParams.get("secret");

    if (secret !== Deno.env.get("WEBSITE_LEAD_SECRET")) {
      return new Response("unauthorized", { status: 401, headers: corsHeaders });
    }

    const medicoNome = MEDICOS[medicoKey];
    if (!medicoNome) {
      return new Response(JSON.stringify({ error: "medico invalido -- use ?medico=celso ou ?medico=augusto" }), { status: 400, headers: corsHeaders });
    }

    // Aceita tanto JSON quanto o POST normal de formulario (CF7/qualquer form HTML).
    const contentType = req.headers.get("content-type") || "";
    const raw: Record<string, string> = {};
    if (contentType.includes("application/json")) {
      Object.assign(raw, await req.json());
    } else {
      const form = await req.formData();
      for (const [k, v] of form.entries()) raw[k] = String(v);
    }

    // Normaliza o formato "fields[your-name]" do plugin "CF7 to Webhook" (Moranet)
    // pra um objeto plano -- mesmo plugin usado no site do CP Cabinets.
    const body: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) {
      const m = k.match(/^fields\[(.+)\]$/);
      body[m ? m[1] : k] = v;
    }

    const getField = (...keys: string[]): string => {
      for (const k of keys) { const v = (body[k] || "").trim(); if (v) return v; }
      return "";
    };

    const name    = getField("your-name", "name", "nome", "full-name") || "Lead do site";
    const email   = getField("your-email", "your-e-mail", "email") || null;
    const message = getField("your-message", "message", "mensagem", "comments");

    let phone = getField("your-phone", "your-tel", "phone", "telefone", "tel-1", "whatsapp");
    if (!phone) {
      const k = Object.keys(body).find(k => /phone|tel|whats/i.test(k));
      if (k) phone = body[k];
    }
    phone = phone.replace(/\D/g, "");
    if (phone && phone.length <= 11) phone = "55" + phone; // garante DDI Brasil
    if (!phone || phone.length < 12) {
      return new Response(JSON.stringify({ error: "telefone ausente ou invalido no formulario" }), { status: 400, headers: corsHeaders });
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const { data: existing } = await admin
      .from("pn_leads")
      .select("id")
      .eq("phone", phone)
      .eq("clinic_slug", "pronutro")
      .maybeSingle();

    if (existing) {
      // Já é lead conhecido -- volta pro início do ciclo na coluna do médico
      // pedido, igual já fazemos quando um "resolvido" manda mensagem de novo.
      await admin.from("pn_leads").update({
        stage: "em_atendimento",
        medico_preferido: medicoNome,
        updated_at: new Date().toISOString(),
      }).eq("id", existing.id);
    } else {
      await admin.from("pn_leads").insert({
        name, phone, email,
        stage: "em_atendimento",
        medico_preferido: medicoNome,
        ai_mode: false,
        first_message: message || `Lead do site do ${medicoNome}`,
        origem: `site-${medicoKey}`,
        clinic_slug: "pronutro",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    }

    return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: corsHeaders });
  }
});
