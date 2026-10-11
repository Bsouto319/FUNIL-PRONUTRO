import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Staging por padrão -- trocar MEMED_API_URL/MEMED_API_KEY/MEMED_SECRET_KEY nos
// secrets da function quando a Memed liberar as chaves de produção (ver
// memed.com.br/parceiro-software). Não requer mudança de código.
const MEMED_API_URL    = Deno.env.get("MEMED_API_URL")    ?? "https://integrations.api.memed.com.br/v1";
const MEMED_API_KEY    = Deno.env.get("MEMED_API_KEY")    ?? "iJGiB4kjDGOLeDFPWMG3no9VnN7Abpqe3w1jEFm6olkhkZD6oSfSmYCm";
const MEMED_SECRET_KEY = Deno.env.get("MEMED_SECRET_KEY") ?? "Xe8M5GvBGCr4FStKfxXKisRo3SfYKI7KrTMkJpCAstzu2yXVN4av5nmL";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

// Memed exige nome + sobrenome separados; nosso cadastro só tem nome completo.
function splitNome(nomeCompleto: string): { nome: string; sobrenome: string } {
  const partes = nomeCompleto.trim().replace(/^Dr\.?a?\.?\s+/i, "").split(/\s+/);
  return { nome: partes[0] || nomeCompleto, sobrenome: partes.slice(1).join(" ") || partes[0] || "" };
}

async function cadastrarNaMemed(medico: any): Promise<{ ok: boolean; token?: string; error?: string }> {
  if (!medico.cpf || !medico.registro_profissional || !medico.uf_registro) {
    return { ok: false, error: "Médico sem CPF/CRM/UF cadastrado -- preencha no Admin > Médicos antes de emitir receita digital." };
  }
  const { nome, sobrenome } = splitNome(medico.nome);

  // NOTA: o payload de exemplo da doc da Memed inclui relationships.cidade e
  // relationships.especialidade (IDs internos deles, via endpoint de busca que
  // ainda não confirmamos). Tentando cadastrar sem isso primeiro -- se a Memed
  // rejeitar por campo obrigatório faltando, precisamos achar o endpoint de
  // lookup de cidade/especialidade e resolver o ID antes deste POST.
  const payload = {
    data: {
      type: "usuarios",
      attributes: {
        external_id: medico.id,
        nome,
        sobrenome,
        cpf: String(medico.cpf).replace(/\D/g, ""),
        board: {
          board_code: "CRM",
          board_number: String(medico.registro_profissional).trim(),
          board_state: String(medico.uf_registro).trim().toUpperCase(),
        },
      },
    },
  };

  const res = await fetch(`${MEMED_API_URL}/sinapse-prescricao/usuarios?api-key=${MEMED_API_KEY}&secret-key=${MEMED_SECRET_KEY}`, {
    method: "POST",
    headers: { "Accept": "application/vnd.api+json", "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  if (!res.ok) {
    console.error("Memed cadastro falhou", res.status, text.slice(0, 500));
    return { ok: false, error: `Memed respondeu ${res.status}: ${text.slice(0, 300)}` };
  }

  let parsed: any;
  try { parsed = JSON.parse(text); } catch { return { ok: false, error: "Resposta da Memed não é JSON válido" }; }
  const token = parsed?.data?.attributes?.token;
  if (!token) return { ok: false, error: "Memed não retornou token no cadastro" };

  await supabase.from("pn_medicos").update({ memed_token: token, memed_cadastrado_em: new Date().toISOString() }).eq("id", medico.id);
  return { ok: true, token };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    const { action, medico_id } = await req.json();
    if (!medico_id) return json({ error: "medico_id required" }, 400);

    const { data: medico, error } = await supabase.from("pn_medicos").select("*").eq("id", medico_id).single();
    if (error || !medico) return json({ error: "Médico não encontrado" }, 404);

    if (action === "obter-token") {
      if (medico.memed_token) return json({ ok: true, token: medico.memed_token, cached: true });
      const result = await cadastrarNaMemed(medico);
      return json(result, result.ok ? 200 : 422);
    }

    if (action === "cadastrar") {
      const result = await cadastrarNaMemed(medico);
      return json(result, result.ok ? 200 : 422);
    }

    return json({ error: "action inválida (use 'obter-token' ou 'cadastrar')" }, 400);
  } catch (e) {
    console.error("pn-memed-prescricao error", e);
    return json({ error: String(e) }, 500);
  }
});
