import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } }
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return new Response(JSON.stringify({ error: "Não autenticado" }), { status: 401, headers: corsHeaders });

    const { data: perfil } = await userClient.from("pn_usuarios").select("role").eq("id", user.id).maybeSingle();
    if (!perfil || (perfil.role !== "admin" && perfil.role !== "gerente")) {
      return new Response(JSON.stringify({ error: "Sem permissão" }), { status: 403, headers: corsHeaders });
    }

    const { id, nome, role, email } = await req.json();
    if (!id) return new Response(JSON.stringify({ error: "Campo obrigatório: id" }), { status: 400, headers: corsHeaders });

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // Email mora em dois lugares -- auth.users (login) e pn_usuarios (exibição).
    // Sem atualizar o auth.users, a pessoa continuaria sem conseguir logar
    // com o e-mail novo mesmo depois de "editado" aqui.
    if (email) {
      const { error: authErr } = await admin.auth.admin.updateUserById(id, { email, email_confirm: true });
      if (authErr) return new Response(JSON.stringify({ error: authErr.message }), { status: 400, headers: corsHeaders });
    }

    const fields: Record<string, unknown> = {};
    if (nome !== undefined) fields.nome = nome;
    if (role !== undefined) fields.role = role;
    if (email !== undefined) fields.email = email;

    if (Object.keys(fields).length > 0) {
      const { error: dbErr } = await admin.from("pn_usuarios").update(fields).eq("id", id);
      if (dbErr) return new Response(JSON.stringify({ error: dbErr.message }), { status: 500, headers: corsHeaders });
    }

    return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: corsHeaders });
  }
});
