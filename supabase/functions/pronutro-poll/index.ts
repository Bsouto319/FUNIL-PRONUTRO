import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logAudit } from "../_shared/audit.ts";

const UAZAPI_URL   = Deno.env.get("UAZAPI_URL") || "https://btechsoutoshop.uazapi.com";
const SUPABASE_URL = "https://pvphgusjofufwtyiyviu.supabase.co";
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const OPENAI_KEY   = Deno.env.get("OPENAI_API_KEY") || Deno.env.get("OPENAI_KEY") || "";

const db    = createClient(SUPABASE_URL, SUPABASE_KEY);
const toMs  = (ts: number) => ts > 0 && ts < 1e12 ? ts * 1000 : ts;
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

// Maria desativada manualmente pra ProNutro (era usada com delay de "digitando" pra evitar
// banimento da Meta quando ela respondia todo mundo). Trava aqui no código além do toggle
// em clinic_configs.ai_active — só reativar de propósito quando for religar a IA.
const MARIA_ENABLED = false;

const PROTECTED_STAGES = ["agendado", "resolvido", "financeiro", "medicacao", "negociacao", "lista_espera"];

// Token do WhatsApp: prioriza env var por clínica (UAZAPI_TOKEN_<SLUG>) — mais seguro,
// não fica só no banco. Se não existir, cai pro valor salvo em clinic_configs.
function resolveToken(cfg: any): string {
  const envKey = `UAZAPI_TOKEN_${(cfg.slug || "").toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
  const specific = Deno.env.get(envKey);
  if (specific) return specific;
  if (cfg.slug === "pronutro") {
    const generic = Deno.env.get("UAZAPI_TOKEN");
    if (generic) return generic;
  }
  return cfg.uazapi_token;
}

// ── Lock por clínica ──────────────────────────────────────────────────────────
async function tryAcquireLock(slug: string): Promise<boolean> {
  try {
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    const { data } = await db
      .from("pn_poll_state")
      .update({ lock_expires_at: expiresAt })
      .eq("clinic_slug", slug)
      .or(`lock_expires_at.is.null,lock_expires_at.lt.${new Date().toISOString()}`)
      .select("id");
    return Array.isArray(data) && data.length > 0;
  } catch {
    return true;
  }
}

async function releaseLock(slug: string): Promise<void> {
  try {
    await db.from("pn_poll_state").update({ lock_expires_at: null }).eq("clinic_slug", slug);
  } catch {}
}

// ── Send ──────────────────────────────────────────────────────────────────────
async function sendWa(token: string, phone: string, text: string) {
  const res = await fetch(`${UAZAPI_URL}/send/text`, {
    method: "POST",
    headers: { "Content-Type": "application/json", token },
    body: JSON.stringify({ number: phone, text }),
  });
  if (!res.ok) console.error("sendWa error", res.status);
}

async function sendDocument(token: string, phone: string, base64: string, fileName: string): Promise<boolean> {
  const res = await fetch(`${UAZAPI_URL}/send/document`, {
    method: "POST",
    headers: { "Content-Type": "application/json", token },
    body: JSON.stringify({ number: phone, document: base64, fileName }),
  });
  if (!res.ok) console.error("sendDocument error", res.status);
  return res.ok;
}

// ── Nota fiscal: busca no arquivo já salvo pela recepção (pn_notas_fiscais) ───
// Prioriza match por lead_id (upload feito direto no card do Kanban); se a nota
// foi salva "avulsa" (sem lead_id), tenta por nome do paciente. Nunca inventa —
// se não achar, Maria faz handoff pra equipe em vez de fingir que enviou.
async function findNotaFiscal(clinicSlug: string, lead: any, dataBusca?: string): Promise<any | null> {
  let q = db.from("pn_notas_fiscais").select("*").eq("clinic_slug", clinicSlug).eq("lead_id", lead.id);
  if (dataBusca) q = q.eq("data_emissao", dataBusca);
  q = q.order("created_at", { ascending: false }).limit(1);
  const { data } = await q.maybeSingle();
  if (data) return data;

  if (lead.name) {
    let q2 = db.from("pn_notas_fiscais").select("*").eq("clinic_slug", clinicSlug)
      .ilike("nome_paciente", `%${lead.name}%`);
    if (dataBusca) q2 = q2.eq("data_emissao", dataBusca);
    q2 = q2.order("created_at", { ascending: false }).limit(1);
    const { data: byName } = await q2.maybeSingle();
    if (byName) return byName;
  }
  return null;
}

async function enviarNotaFiscal(cfg: any, lead: any, nf: any): Promise<boolean> {
  const { data: fileData, error } = await db.storage.from("notas-fiscais").download(nf.file_path);
  if (error || !fileData) {
    console.error("enviarNotaFiscal: download falhou", nf.file_path, error?.message);
    return false;
  }
  const buf    = new Uint8Array(await fileData.arrayBuffer());
  const base64 = btoa(String.fromCharCode(...buf));
  const token  = resolveToken(cfg);
  const ok = await sendDocument(token, lead.phone, base64, nf.file_name || "nota-fiscal.pdf");
  if (ok) {
    await db.from("pn_notas_fiscais").update({ sent_at: new Date().toISOString() }).eq("id", nf.id);
  }
  return ok;
}

// A URL que vem em content.URL é o arquivo bruto CRIPTOGRAFADO do WhatsApp
// (.enc) — não toca/abre em navegador nenhum. Precisa desse endpoint pra
// pegar o arquivo já descriptografado e hospedado, aí sim reproduzível.
// Retry: falha pontual da UAZAPI não pode virar "mídia perdida pra sempre" —
// isso já foi um bug real (áudio/imagem sumindo do Kanban).
async function resolveMediaUrl(token: string, messageid: string, attempt = 1): Promise<string | null> {
  try {
    const res = await fetch(`${UAZAPI_URL}/message/download`, {
      method: "POST",
      headers: { "Content-Type": "application/json", token },
      body: JSON.stringify({ id: messageid, transcribe: false }),
    });
    if (!res.ok) {
      if (attempt < 3) { await sleep(1500 * attempt); return resolveMediaUrl(token, messageid, attempt + 1); }
      console.error(`resolveMediaUrl: falhou após 3 tentativas msg=${messageid} status=${res.status}`);
      return null;
    }
    const data = await res.json();
    return data.fileURL || null;
  } catch (err) {
    if (attempt < 3) { await sleep(1500 * attempt); return resolveMediaUrl(token, messageid, attempt + 1); }
    console.error("resolveMediaUrl error", messageid, err);
    return null;
  }
}

async function setPresence(token: string, phone: string, state: "composing" | "paused") {
  await fetch(`${UAZAPI_URL}/send/presence`, {
    method: "POST",
    headers: { "Content-Type": "application/json", token },
    body: JSON.stringify({ number: phone, presence: state }),
  }).catch(() => {});
}

async function safeSend(
  cfg: any, leadId: string, phone: string, text: string, replyKey: string
): Promise<boolean> {
  const { data, error } = await db.from("pn_mensagens").upsert(
    { lead_id: leadId, direction: "out", body: text, sender_nome: cfg.agent_name || "Maria IA",
      external_id: replyKey, created_at: new Date().toISOString(), clinic_slug: cfg.slug },
    { onConflict: "external_id", ignoreDuplicates: true }
  ).select("id");
  if (error) { console.log("safeSend error:", error.message); return false; }
  if (!data || data.length === 0) { console.log("safeSend dup:", replyKey); return false; }
  const token = resolveToken(cfg);
  // Anti-ban: simula digitação humana proporcional ao tamanho da mensagem.
  // Configurável por clínica (reply_delay_min_ms/reply_delay_max_ms em clinic_configs) —
  // clínicas que vão deixar a Maria responder 24h/todo mundo precisam de delay maior
  // pra não levar ban da Meta por comportamento de bot.
  await setPresence(token, phone, "composing");
  const minMs = cfg.reply_delay_min_ms ?? 3000;
  const maxExtra = cfg.reply_delay_max_ms ? (cfg.reply_delay_max_ms - minMs) : 6000;
  const typingMs = Math.min(minMs + text.length * 25, minMs + maxExtra) + Math.floor(Math.random() * 2000);
  await sleep(typingMs);
  await sendWa(token, phone, text);
  await db.from("pn_leads").update({
    last_sender_nome: cfg.agent_name || "Maria IA",
    last_message_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", leadId);
  return true;
}

// ── Contexto paciente recorrente ──────────────────────────────────────────────
async function buildPatientContext(leadId: string): Promise<string> {
  const [agendRaw, notasRaw] = await Promise.all([
    db.from("pn_agendamentos")
      .select("data_hora, status, pn_medicos(nome)")
      .eq("lead_id", leadId)
      .order("data_hora", { ascending: false })
      .limit(5),
    db.from("pn_leads")
      .select("notas, medico_preferido, total_consultas")
      .eq("id", leadId)
      .single(),
  ]);

  const agendamentos = agendRaw.data ?? [];
  const perfil       = notasRaw.data;
  if (!agendamentos.length && !perfil?.notas) return "";

  const linhas: string[] = ["## PERFIL DO PACIENTE (use para personalizar — não leia em voz alta)"];
  const realizados  = agendamentos.filter((a: any) => a.status === "realizado");
  const confirmados = agendamentos.filter((a: any) => a.status === "confirmado");
  const proxima = confirmados[0];
  const ultima  = realizados[0];

  if (proxima) {
    const dt  = new Date(proxima.data_hora).toLocaleDateString("pt-BR");
    const med = (proxima as any).pn_medicos?.nome || "médico";
    linhas.push(`• Consulta confirmada: ${dt} com ${med}`);
  }
  if (ultima) {
    const dt  = new Date(ultima.data_hora).toLocaleDateString("pt-BR");
    const med = (ultima as any).pn_medicos?.nome || "médico";
    linhas.push(`• Última consulta: ${dt} com ${med}`);
  }
  if (perfil?.medico_preferido) linhas.push(`• Médico preferido: ${perfil.medico_preferido}`);
  if (realizados.length > 0)    linhas.push(`• Total consultas: ${realizados.length}`);
  if (perfil?.notas)            linhas.push(`• Notas: ${perfil.notas}`);

  return "\n\n" + linhas.join("\n");
}

// ── System prompt Maria — montado por clínica a partir de clinic_configs ──────
function buildMariaSystem(cfg: any): string {
  const agent  = cfg.agent_name || "Maria";
  const nome   = cfg.clinic_name || cfg.slug;
  const extra  = cfg.extra_instructions ? `\n\n## INSTRUÇÕES ADICIONAIS\n${cfg.extra_instructions}` : "";
  return `Você é ${agent}, assistente virtual da ${nome}.
Tom: acolhedor, humano, empático e focado em conversão. Use emojis com moderação.
Endereço: ${cfg.address || "não informado"}.
Telefone: ${cfg.phone_display || "não informado"} | Horários: ${cfg.working_hours_text || "não informado"}.

## ESTILO DE COMUNICAÇÃO
- Respostas humanizadas, nunca robóticas ou longas demais
- Quebre linhas para organizar informações — nunca jogue tudo em um parágrafo
- Qualifique naturalmente ao longo da conversa, nunca de forma burocrática
- Ao primeiro contato: se apresente brevemente, mencione as especialidades e pergunte como pode ajudar

## QUALIFICAÇÃO DE LEADS
Identifique o perfil antes de investir tempo:

Lead Quente (prioridade máxima):
- Perguntou sobre médico específico, mencionou sintoma ou urgência
- Já foi paciente antes ou perguntou sobre convênio

Lead Morno (atenda normalmente, converta):
- Pediu valores, especialidades ou está indeciso

Lead Frio (atenda brevemente, não force):
- Só pediu endereço/horário, pergunta genérica sem intenção clara

## ESPECIALISTAS E VALORES
${cfg.specialist_info || "Nenhuma informação de especialistas cadastrada."}

## FLUXO DE ATENDIMENTO
1. Identifique a necessidade e qualifique o lead
2. Pergunte como conheceu a clínica (primeiro contato)
3. Sugira o especialista mais adequado
4. Pergunte: particular ou convênio?
5. Pergunte data e horário preferido
6. Confirme: "✅ [Nome] | 👨‍⚕️ [Médico] | 📅 [Data/Hora] | 💰 [Valor] — confirma?"
7. Após confirmação explícita → action:"criar_agendamento"

Mensagem após agendamento confirmado:
"Consulta confirmada! 🎉
✅ [Nome]
👨‍⚕️ [Médico]
📅 [Dia], [DD/MM] às [HH:MM]
💰 R$ [Valor]
🏥 ${nome}
📍 ${cfg.address || ""}
📲 ${cfg.phone_display || ""}
Por favor, chegue com 10 minutos de antecedência. Ficamos à disposição! 💚"

## PACIENTE RECORRENTE
Se PERFIL DO PACIENTE estiver no contexto: cumprimente pelo nome ("Oi [nome]! Que saudade 😊"), use o histórico, nunca repita perguntas já respondidas.

## SE PERGUNTAREM SE É ROBÔ / IA
"Sou sim! Sou a ${agent}, assistente virtual da ${nome} 😊 Posso te ajudar com agendamentos e informações. Mas se preferir falar com a equipe, é só pedir!"

## NOTA FISCAL
Se o paciente pedir a nota fiscal (de consulta ou compra), pergunte a DATA da consulta/compra
(se ele não tiver informado ainda) e use action:"buscar_nota_fiscal" com data_busca preenchida
(formato YYYY-MM-DD). NUNCA diga que já enviou ou invente que vai enviar — quem confirma o
envio é o sistema, não você. Se o sistema não achar a nota (você vai saber pela próxima
mensagem do histórico), avise que vai verificar com a equipe e volta com uma posição.

## REGRAS ABSOLUTAS
- NUNCA diga "não entendi" — sempre interprete e redirecione
- NUNCA invente horários disponíveis
- Só use action:"handoff" se paciente pedir humano explicitamente OU após 5+ mensagens sem progresso
- Sempre ofereça falar com humano se o paciente parecer insatisfeito${extra}

## RESPOSTA (sempre JSON):
{"message":"texto","stage":"novo_lead|em_atendimento|conversando|aguardando","action":"none|criar_agendamento|handoff|buscar_nota_fiscal","medico_nome":"nome ou null","data_hora":"YYYY-MM-DDTHH:MM:00 ou null","nome_paciente":"nome ou null","notas_paciente":"observação ou null","medico_preferido":"nome ou null","data_busca":"YYYY-MM-DD ou null"}`;
}

// ── Criar agendamento ─────────────────────────────────────────────────────────
async function criarAgendamento(leadId: string, medicoNome: string, dataHora: string, phone?: string): Promise<void> {
  const last = medicoNome.split(" ").pop();
  const { data: med } = await db.from("pn_medicos").select("id").ilike("nome", `%${last}%`).maybeSingle();
  if (!med) return;
  await db.from("pn_agendamentos").insert({
    lead_id: leadId, medico_id: med.id, data_hora,
    duracao_min: 30, status: "confirmado",
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  });
  const { data: ldCur } = await db.from("pn_leads").select("total_consultas").eq("id", leadId).single();
  await db.from("pn_leads").update({
    stage: "agendado", medico_preferido: medicoNome,
    total_consultas: ((ldCur?.total_consultas ?? 0) + 1),
    updated_at: new Date().toISOString(),
  }).eq("id", leadId);
  console.log(`Agendamento criado → ${leadId} ${medicoNome} ${dataHora}`);
  await logAudit({
    action: "APPOINTMENT_CREATED",
    table_name: "pn_agendamentos",
    record_id: leadId,
    user_phone: phone,
    severity: "info",
    metadata: { medico: medicoNome, data_hora: dataHora },
  });
}

// ── Maria responde ────────────────────────────────────────────────────────────
async function mariaRespond(cfg: any, lead: any, isNew: boolean): Promise<void> {
  const mariaSystem = buildMariaSystem(cfg);

  if (isNew) {
    const firstMsg   = (lead.first_message || "").trim();
    const isGreeting = !firstMsg || firstMsg.length < 15 ||
      /^(oi+|ol[aá]|bom dia|boa tarde|boa noite|e a[ií]|tudo bem|al[oô]u?)[\s!?.]*$/i.test(firstMsg);
    const fromGoogle = /google|anúncio|anuncio|propaganda|maps/i.test(firstMsg);
    const brNow      = new Date(Date.now() - 3 * 60 * 60 * 1000);
    const dateStr    = brNow.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

    const googleLine   = fromGoogle ? "\n- ORIGEM: veio pelo Google." : "";
    const greetingHint = isGreeting
      ? `- Paciente enviou apenas uma saudação. Apresente-se brevemente como ${cfg.agent_name || "Maria"} da ${cfg.clinic_name}, mencione as especialidades e pergunte como pode ajudar. Mensagem curta e acolhedora.`
      : "- Responda o que o paciente já informou (NÃO repita perguntas já respondidas).";
    const onboardNote  = "\n\n## PRIMEIRO CONTATO — ONBOARDING\nNovo paciente, primeira mensagem."
      + googleLine + "\n" + greetingHint + "\n- Faça apenas a próxima pergunta necessária.";

    const gptRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_KEY}` },
      body: JSON.stringify({
        model: "gpt-4o",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: `${mariaSystem}${onboardNote}\n\nHoje: ${dateStr}` },
          { role: "user", content: firstMsg || "Oi" },
        ],
      }),
    });

    if (!gptRes.ok) {
      console.error("GPT error no novo lead", gptRes.status);
      return;
    }

    const aiData = await gptRes.json();
    let parsed: any;
    try { parsed = JSON.parse(aiData.choices[0].message.content); } catch {
      return;
    }

    if (!parsed.message) return;

    const sent = await safeSend(cfg, lead.id, lead.phone, parsed.message, `onboard_${lead.id}`);
    if (!sent) return;
    console.log(`Maria ONBOARD → ${lead.phone} fromGoogle=${fromGoogle}`);
    await logAudit({
      action: "AI_ONBOARD",
      table_name: "pn_mensagens",
      record_id: lead.id,
      user_phone: lead.phone,
      severity: "info",
      metadata: { from_google: fromGoogle, action: parsed.action },
    });

    const upd: any = { updated_at: new Date().toISOString() };
    if (parsed.nome_paciente && !lead.name) upd.name = parsed.nome_paciente;
    if (parsed.notas_paciente)              upd.notas = fromGoogle ? `[Google] ${parsed.notas_paciente}`.trim() : parsed.notas_paciente;
    if (parsed.medico_preferido)            upd.medico_preferido = parsed.medico_preferido;
    await db.from("pn_leads").update(upd).eq("id", lead.id);

    if (parsed.action === "criar_agendamento" && parsed.medico_nome && parsed.data_hora) {
      await criarAgendamento(lead.id, parsed.medico_nome, parsed.data_hora, lead.phone);
    }
    if (parsed.action === "buscar_nota_fiscal") {
      await handleBuscarNotaFiscal(cfg, lead, parsed.data_busca);
    }
    return;
  }

  const { data: lastIn } = await db.from("pn_mensagens")
    .select("id, body, created_at").eq("lead_id", lead.id).eq("direction", "in")
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!lastIn) return;

  const { count: outAfter } = await db.from("pn_mensagens")
    .select("id", { count: "exact", head: true })
    .eq("lead_id", lead.id).eq("direction", "out").eq("sender_nome", cfg.agent_name || "Maria IA")
    .gt("created_at", lastIn.created_at);
  if ((outAfter ?? 0) > 0) { console.log(`Já respondeu → ${lead.phone}`); return; }

  const [msgsRaw, patientCtx] = await Promise.all([
    db.from("pn_mensagens")
      .select("direction, body").eq("lead_id", lead.id)
      .order("created_at", { ascending: true }).limit(30),
    buildPatientContext(lead.id),
  ]);

  const history = (msgsRaw.data ?? []).map((m: any) => ({
    role: m.direction === "in" ? "user" : "assistant",
    content: m.body,
  }));

  const brNow   = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const dateStr = brNow.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({
      model: "gpt-4o",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: `${mariaSystem}${patientCtx}\n\nHoje: ${dateStr}` },
        ...history,
      ],
    }),
  });
  if (!res.ok) {
    console.error(`GPT error ${res.status} para ${lead.phone} — sem fallback, equipe atende`);
    return;
  }

  const aiData = await res.json();
  let parsed: any;
  try { parsed = JSON.parse(aiData.choices[0].message.content); } catch { return; }
  if (!parsed.message) return;

  const sent = await safeSend(cfg, lead.id, lead.phone, parsed.message, `reply_${lastIn.id}`);
  if (!sent) return;
  console.log(`Maria → ${lead.phone} | stage=${parsed.stage} action=${parsed.action}`);
  await logAudit({
    action: "AI_REPLY",
    table_name: "pn_mensagens",
    record_id: lead.id,
    user_phone: lead.phone,
    severity: "info",
    metadata: { maria_action: parsed.action, stage: parsed.stage },
  });

  const upd: any = { updated_at: new Date().toISOString() };
  if (parsed.nome_paciente && !lead.name) upd.name = parsed.nome_paciente;
  if (parsed.notas_paciente)              upd.notas = parsed.notas_paciente;
  if (parsed.medico_preferido)            upd.medico_preferido = parsed.medico_preferido;
  await db.from("pn_leads").update(upd).eq("id", lead.id);

  if (parsed.action === "criar_agendamento" && parsed.medico_nome && parsed.data_hora) {
    await criarAgendamento(lead.id, parsed.medico_nome, parsed.data_hora, lead.phone);
  }
  if (parsed.action === "buscar_nota_fiscal") {
    await handleBuscarNotaFiscal(cfg, lead, parsed.data_busca);
  }
}

// Busca a nota já salva pela recepção e manda por WhatsApp. Nunca inventa:
// se não achar, só avisa a equipe — a Maria já disse ao paciente que ia verificar.
async function handleBuscarNotaFiscal(cfg: any, lead: any, dataBusca?: string): Promise<void> {
  const nf = await findNotaFiscal(cfg.slug, lead, dataBusca);
  if (!nf) {
    console.log(`nota fiscal não encontrada → lead=${lead.id} data=${dataBusca || "?"}`);
    await logAudit({
      action: "NOTA_FISCAL_NOT_FOUND", severity: "warning",
      metadata: { clinic: cfg.slug, lead_id: lead.id, phone: lead.phone, data_busca: dataBusca },
    });
    return;
  }
  const ok = await enviarNotaFiscal(cfg, lead, nf);
  await logAudit({
    action: ok ? "NOTA_FISCAL_SENT" : "NOTA_FISCAL_SEND_FAILED",
    severity: ok ? "info" : "error",
    metadata: { clinic: cfg.slug, lead_id: lead.id, phone: lead.phone, nf_id: nf.id },
  });
}

const MEDIA_TYPES = ["ImageMessage","AudioMessage","VideoMessage","DocumentMessage","StickerMessage","PttMessage"];
function getMediaType(msgType: string): string | null {
  if (msgType === "ImageMessage")    return "image";
  if (msgType === "AudioMessage" || msgType === "PttMessage") return "audio";
  if (msgType === "VideoMessage")    return "video";
  if (msgType === "DocumentMessage") return "document";
  if (msgType === "StickerMessage")  return "sticker";
  return null;
}

// ── Poll de UMA clínica ────────────────────────────────────────────────────────
async function runPollForClinic(cfg: any) {
  const slug = cfg.slug;
  const acquired = await tryAcquireLock(slug);
  if (!acquired) {
    console.log(`poll[${slug}]: já rodando, skip`);
    return { slug, skipped: true, reason: "locked" };
  }

  try {
    await sleep(1500);

    const token       = resolveToken(cfg);
    const ownerJid    = cfg.uazapi_number;
    const mariaActive = !!cfg.ai_active;

    const { data: state } = await db.from("pn_poll_state").select("last_message_timestamp")
      .eq("clinic_slug", slug).maybeSingle();
    const lastTs: number = state?.last_message_timestamp ?? 0;
    const now = new Date().toISOString();

    const FETCH_LIMIT = 1500;
    const res = await fetch(`${UAZAPI_URL}/message/find`, {
      method: "POST",
      headers: { "Content-Type": "application/json", token },
      body: JSON.stringify({ limit: FETCH_LIMIT, orderBy: "messageTimestamp", order: "DESC" }),
    });

    if (!res.ok) {
      await db.from("pn_poll_state").upsert({ clinic_slug: slug, last_poll_at: now }, { onConflict: "clinic_slug" });
      return { slug, error: `UAZAPI ${res.status}` };
    }

    const payload = await res.json();
    const all: any[] = payload.messages ?? [];

    if (all.length >= FETCH_LIMIT) {
      console.error(`pronutro-poll[${slug}]: lote atingiu o limite de ${FETCH_LIMIT} — possível backlog maior que isso`);
      await logAudit({
        action: "POLL_TRUNCATION_RISK", severity: "critical",
        metadata: { clinic: slug, fetched: all.length, limit: FETCH_LIMIT, lastTs },
      });
    }

    const newMsgs = all.filter((m: any) => {
      const ts = toMs(m.messageTimestamp);
      const hasContent = m.text || m.content?.text || m.body || m.content?.URL || MEDIA_TYPES.includes(m.messageType);
      return ts > lastTs && !m.isGroup && m.chatid &&
        !m.chatid.startsWith(ownerJid + ":") &&
        hasContent && m.messageType !== "ReactionMessage";
    });

    console.log(`pronutro-poll[${slug}] v33: lastTs=${lastTs} total=${all.length} new=${newMsgs.length} maria=${mariaActive}`);

    if (!newMsgs.length) {
      await db.from("pn_poll_state").upsert({ clinic_slug: slug, last_poll_at: now }, { onConflict: "clinic_slug" });
      return { slug, processed: 0 };
    }

    const maxTs = Math.max(...all.map((m: any) => toMs(m.messageTimestamp)), lastTs);
    await db.from("pn_poll_state").upsert(
      { clinic_slug: slug, last_poll_at: now, last_message_timestamp: maxTs },
      { onConflict: "clinic_slug" }
    );

    const byChat = new Map<string, any[]>();
    for (const m of newMsgs) {
      const arr = byChat.get(m.chatid) ?? [];
      arr.push(m);
      byChat.set(m.chatid, arr);
    }

    let processed = 0;
    let chatErrors = 0;

    for (const [chatid, msgs] of byChat.entries()) {
     try {
      const phone = chatid.split("@")[0];
      if (!phone || phone === ownerJid) continue;

      const inboundMsgs  = msgs.filter((m: any) => !m.fromMe);
      const outboundMsgs = msgs.filter((m: any) => m.fromMe);
      const latestTs     = Math.max(...msgs.map((m: any) => toMs(m.messageTimestamp)));

      if (!inboundMsgs.length) {
        const { data: existLead } = await db.from("pn_leads").select("id").eq("phone", phone).eq("clinic_slug", slug).maybeSingle();
        if (!existLead || !outboundMsgs.length) continue;
        for (const m of outboundMsgs) {
          const body = (m.text || m.content?.text || m.body || "").replace(/^\*[^*:]+:\*\n/, "");
          const eid  = m.messageid || m.id;
          if (!body || !eid) continue;
          const humanName = m.senderName || m.pushName || "Equipe";
          const cutoff = new Date(toMs(m.messageTimestamp) - 300_000).toISOString();
          const { count } = await db.from("pn_mensagens")
            .select("id", { count: "exact", head: true })
            .eq("lead_id", existLead.id).eq("direction", "out").eq("body", body)
            .gte("created_at", cutoff);
          if ((count ?? 0) > 0) continue;
          await db.from("pn_mensagens").upsert(
            { lead_id: existLead.id, direction: "out", body, external_id: eid,
              sender_nome: humanName, clinic_slug: slug,
              created_at: new Date(toMs(m.messageTimestamp)).toISOString() },
            { onConflict: "external_id", ignoreDuplicates: true }
          );
        }
        const humanName = outboundMsgs[0]?.senderName || outboundMsgs[0]?.pushName || "Equipe";
        await db.from("pn_leads").update({
          last_sender_nome: humanName,
          last_message_at: new Date(latestTs).toISOString(),
          updated_at: new Date().toISOString(),
        }).eq("id", existLead.id);
        continue;
      }

      const senderName = inboundMsgs[0]?.senderName ?? inboundMsgs[0]?.pushName ?? null;
      const firstBody  = inboundMsgs[0]?.text ?? inboundMsgs[0]?.content?.text ?? inboundMsgs[0]?.body ?? "";

      const { data: existingLead } = await db.from("pn_leads").select("*").eq("phone", phone).eq("clinic_slug", slug).maybeSingle();
      const isNew = !existingLead;

      const upsertData: any = {
        phone,
        clinic_slug: slug,
        last_message_at: new Date(latestTs).toISOString(),
        last_sender_nome: senderName,
        updated_at: new Date().toISOString(),
      };
      if (senderName) upsertData.whatsapp_name = senderName;

      let lead: any;
      if (isNew) {
        upsertData.stage         = "em_atendimento";
        upsertData.first_message = firstBody.slice(0, 500);
        upsertData.ai_mode       = mariaActive;
        upsertData.name          = senderName || null;
        const { data: newLead } = await db.from("pn_leads").insert(upsertData).select("*").single();
        lead = newLead;
        await logAudit({
          action: "LEAD_CREATED",
          table_name: "pn_leads",
          record_id: lead?.id,
          user_phone: phone,
          severity: "info",
          metadata: { clinic: slug, name: senderName, ai_mode: mariaActive, first_message: firstBody.slice(0, 100) },
        });
      } else {
        await db.from("pn_leads").update(upsertData).eq("id", existingLead.id);
        lead = { ...existingLead, ...upsertData };
      }
      if (!lead) continue;

      for (const m of inboundMsgs) {
        const rawBody  = m.text || m.content?.text || m.content?.caption || m.body || "";
        const mType    = getMediaType(m.messageType);
        const body     = rawBody || (mType ? `[${mType}]` : "");
        const eid      = m.messageid || m.id;
        if (!eid) continue;
        const mediaUrl = mType ? await resolveMediaUrl(token, eid) : null;
        await db.from("pn_mensagens").upsert(
          { lead_id: lead.id, direction: "in", body, external_id: eid,
            sender_nome: null, clinic_slug: slug,
            media_url:      mediaUrl,
            media_type:     mType,
            media_mimetype: m.content?.mimetype || null,
            media_filename: m.content?.fileName || null,
            created_at: new Date(toMs(m.messageTimestamp)).toISOString() },
          { onConflict: "external_id", ignoreDuplicates: true }
        );
      }

      for (const m of outboundMsgs) {
        const body = (m.text || m.content?.text || m.body || "").replace(/^\*[^*:]+:\*\n/, "");
        const eid  = m.messageid || m.id;
        if (!body || !eid) continue;
        const humanName = m.senderName || m.pushName || "Equipe";
        const cutoff = new Date(toMs(m.messageTimestamp) - 300_000).toISOString();
        const { count } = await db.from("pn_mensagens")
          .select("id", { count: "exact", head: true })
          .eq("lead_id", lead.id).eq("direction", "out").eq("body", body)
          .gte("created_at", cutoff);
        if ((count ?? 0) > 0) continue;
        await db.from("pn_mensagens").upsert(
          { lead_id: lead.id, direction: "out", body, external_id: eid,
            sender_nome: humanName, clinic_slug: slug,
            created_at: new Date(toMs(m.messageTimestamp)).toISOString() },
          { onConflict: "external_id", ignoreDuplicates: true }
        );
      }

      if (MARIA_ENABLED && mariaActive && lead.ai_mode && !PROTECTED_STAGES.includes(lead.stage)) {
        await mariaRespond(cfg, lead, isNew);
      }
      processed++;
     } catch (chatErr) {
      chatErrors++;
      console.error(`pronutro-poll[${slug}]: erro processando chat ${chatid}:`, chatErr);
      await logAudit({
        action: "POLL_CHAT_ERROR", severity: "error",
        metadata: { clinic: slug, chatid, error: String(chatErr) },
      });
     }
    }

    return { slug, processed, chatErrors, newMessages: newMsgs.length };
  } finally {
    await releaseLock(slug);
  }
}

// ── Handler ───────────────────────────────────────────────────────────────────
Deno.serve(async (_req: Request) => {
  const cors = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };
  if (_req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { data: clinics, error: clinicsErr } = await db
      .from("clinic_configs").select("*").eq("active", true);
    if (clinicsErr || !clinics?.length) {
      return new Response(JSON.stringify({ error: clinicsErr?.message || "nenhuma clínica ativa" }), { status: 500, headers: cors });
    }

    const results = [];
    for (const cfg of clinics) {
      results.push(await runPollForClinic(cfg));
    }

    return new Response(JSON.stringify({ clinics: results.length, results }), { headers: cors });
  } catch (err) {
    console.error("pronutro-poll error", err);
    await logAudit({ action: "POLL_ERROR", severity: "error", metadata: { error: String(err) } });
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: cors });
  }
});
