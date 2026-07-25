/**
 * pn-agent — Maria IA Multi-Tenant (Webhook)
 *
 * Recebe webhook do UAZAPI e responde como Maria.
 * Cada clínica tem seu slug: ?clinic=pronutro, ?clinic=clinica-silva
 *
 * UAZAPI webhook URL para cada cliente:
 * https://pvphgusjofufwtyiyviu.supabase.co/functions/v1/pn-agent?clinic=SLUG
 *
 * Configurações: tabela clinic_configs (1 linha por cliente)
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logAudit } from "../_shared/audit.ts";

const UAZAPI_SERVER  = "https://btechsoutoshop.uazapi.com";
const SUPABASE_URL   = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const OPENAI_KEY     = Deno.env.get("OPENAI_API_KEY") || Deno.env.get("OPENAI_KEY") || "";

const db    = createClient(SUPABASE_URL, SUPABASE_KEY);
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface ClinicConfig {
  id: string;
  slug: string;
  clinic_name: string;
  agent_name: string;
  uazapi_token: string;
  uazapi_number: string;
  address: string | null;
  phone_display: string | null;
  working_hours_text: string | null;
  specialist_info: string | null;
  extra_instructions: string | null;
  ai_active: boolean;
}

interface WaMessage {
  messageid?: string;
  id?: string;
  chatid: string;
  text?: string;
  body?: string;
  content?: { text?: string; URL?: string; caption?: string; mimetype?: string; fileName?: string };
  messageType: string;
  messageTimestamp: number;
  fromMe: boolean;
  senderName?: string;
  pushName?: string;
  isGroup?: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const toMs = (ts: number) => ts > 0 && ts < 1e12 ? ts * 1000 : ts;

const MEDIA_TYPES = ["ImageMessage","AudioMessage","VideoMessage","DocumentMessage","StickerMessage","PttMessage"];

function getMediaType(t: string): string | null {
  if (t === "ImageMessage")   return "image";
  if (t === "AudioMessage" || t === "PttMessage") return "audio";
  if (t === "VideoMessage")   return "video";
  if (t === "DocumentMessage") return "document";
  if (t === "StickerMessage") return "sticker";
  return null;
}

function extractText(m: WaMessage): string {
  return m.text || m.content?.text || m.content?.caption || m.body || "";
}

// ── UAZAPI helpers ─────────────────────────────────────────────────────────────

async function sendWa(token: string, phone: string, text: string) {
  const res = await fetch(`${UAZAPI_SERVER}/send/text`, {
    method: "POST",
    headers: { "Content-Type": "application/json", token },
    body: JSON.stringify({ number: phone, text }),
  });
  if (!res.ok) console.error("sendWa error", res.status, await res.text());
}

async function setPresence(token: string, phone: string, state: "composing" | "paused") {
  await fetch(`${UAZAPI_SERVER}/send/presence`, {
    method: "POST",
    headers: { "Content-Type": "application/json", token },
    body: JSON.stringify({ number: phone, presence: state }),
  }).catch(() => {});
}

// ── System prompt dinâmico ─────────────────────────────────────────────────────

function buildSystemPrompt(cfg: ClinicConfig, dateStr: string): string {
  const agentName   = cfg.agent_name   || "Maria";
  const clinicName  = cfg.clinic_name  || "Clínica";
  const address     = cfg.address      || "consultar pelo WhatsApp";
  const phone       = cfg.phone_display|| "";
  const hours       = cfg.working_hours_text || "seg–sex 8h–18h";
  const specialists = cfg.specialist_info  || "Consulte nossa equipe para valores e disponibilidade.";
  const extra       = cfg.extra_instructions ? `\n\n## INSTRUÇÕES ADICIONAIS\n${cfg.extra_instructions}` : "";

  return `Você é ${agentName}, assistente virtual da ${clinicName}.
Tom: acolhedor, empático e focado em conversão. Use emojis com moderação.
${address ? `Endereço: ${address}` : ""}
${phone ? `Telefone: ${phone} | ` : ""}Horários: ${hours}

## IDENTIDADE — REGRA OBRIGATÓRIA
Você é uma assistente VIRTUAL (IA). Isso deve ser TRANSPARENTE desde o primeiro contato:
- Na apresentação inicial, diga sempre: "Sou ${agentName}, assistente virtual da ${clinicName} 😊"
- Mencione que a equipe humana está disponível: "Qualquer momento que preferir falar com nossa equipe, é só pedir!"
- NUNCA se passe por humano — nem implicitamente
- NUNCA negue ser uma IA quando perguntada
Essa transparência protege o paciente, a clínica e está em conformidade com a LGPD e os Termos do WhatsApp/Meta.

## ESTILO DE COMUNICAÇÃO
- Respostas humanizadas, nunca robóticas ou longas demais
- Quebre linhas para organizar informações — nunca jogue tudo em um parágrafo
- Qualifique naturalmente ao longo da conversa, nunca de forma burocrática
- Ao primeiro contato: identifique-se como assistente virtual, mencione especialidades, ofereça atendimento humano e pergunte como pode ajudar

## QUALIFICAÇÃO DE LEADS
Lead Quente (prioridade máxima):
- Perguntou sobre médico específico, mencionou sintoma ou urgência
- Já foi paciente antes ou perguntou sobre convênio

Lead Morno (atenda normalmente, converta):
- Pediu valores, especialidades ou está indeciso

Lead Frio (atenda brevemente, não force):
- Só pediu endereço/horário, pergunta genérica sem intenção clara

## ESPECIALISTAS E VALORES
${specialists}

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
⚕️ ${clinicName.toUpperCase()} ⚕️
${address ? `🏥 ${address}` : ""}
${phone ? `📲 ${phone}` : ""}
Por favor, chegue com 10 minutos de antecedência. Ficamos à disposição! 💚"

## RECEITA CONTROLADA
"Conseguimos renovar receitas controladas apenas para pacientes com consulta ou retorno agendado no prazo indicado pelo médico. ✨ Está dentro do prazo? Me informe a medicação e o médico 😊"

## PACIENTE RECORRENTE
Se PERFIL DO PACIENTE estiver no contexto: cumprimente pelo nome ("Oi [nome]! Que saudade 😊"), use o histórico.

## SE PERGUNTAREM SE É ROBÔ / IA
"Sou sim! Sou ${agentName}, assistente virtual da ${clinicName} 😊 Estou aqui para ajudar com agendamentos e informações. Mas se preferir falar diretamente com nossa equipe, é só me avisar!"

## OFERTA DE ATENDIMENTO HUMANO
- Na primeira mensagem de qualquer conversa: mencione que a equipe humana está disponível
- Se o paciente parecer confuso, insatisfeito ou a conversa travar: ofereça atendimento humano proativamente
- Exemplos de frases: "Se preferir, posso chamar nossa equipe para continuar 😊", "Quer que eu transfira para um(a) atendente?"
- Se paciente pedir humano: use action:"handoff" imediatamente, sem tentar resolver antes

## REGRAS ABSOLUTAS
- NUNCA diga "não entendi" — sempre interprete e redirecione
- NUNCA invente horários disponíveis
- NUNCA se identifique como humano — mesmo que o paciente insista
- Só use action:"handoff" se paciente pedir humano explicitamente OU após 5+ mensagens sem progresso${extra}

## RESPOSTA (sempre JSON):
{"message":"texto","stage":"novo_lead|em_atendimento|conversando|aguardando","action":"none|criar_agendamento|handoff","medico_nome":"nome ou null","data_hora":"YYYY-MM-DDTHH:MM:00 ou null","nome_paciente":"nome ou null","notas_paciente":"observação ou null","medico_preferido":"nome ou null"}

Hoje: ${dateStr}`;
}

// ── Contexto do paciente ──────────────────────────────────────────────────────

async function buildPatientContext(leadId: string, slug: string): Promise<string> {
  const [agendRaw, perfilRaw] = await Promise.all([
    db.from("pn_agendamentos")
      .select("data_hora, status, pn_medicos(nome)")
      .eq("lead_id", leadId)
      .eq("clinic_slug", slug)
      .order("data_hora", { ascending: false })
      .limit(5),
    db.from("pn_leads")
      .select("notas, medico_preferido, total_consultas")
      .eq("id", leadId)
      .single(),
  ]);

  const agendamentos = agendRaw.data ?? [];
  const perfil       = perfilRaw.data;
  if (!agendamentos.length && !perfil?.notas) return "";

  const linhas = ["## PERFIL DO PACIENTE (use para personalizar — não leia em voz alta)"];
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
  if (realizados.length > 0)   linhas.push(`• Total consultas: ${realizados.length}`);
  if (perfil?.notas)           linhas.push(`• Notas: ${perfil.notas}`);

  return "\n\n" + linhas.join("\n");
}

// ── Salvar e enviar resposta ──────────────────────────────────────────────────

async function safeSend(
  cfg: ClinicConfig, leadId: string, phone: string, text: string, replyKey: string
): Promise<boolean> {
  const { data, error } = await db.from("pn_mensagens").upsert(
    {
      lead_id: leadId, clinic_slug: cfg.slug,
      direction: "out", body: text, sender_nome: `${cfg.agent_name} IA`,
      external_id: replyKey, created_at: new Date().toISOString(),
    },
    { onConflict: "external_id", ignoreDuplicates: true }
  ).select("id");

  if (error) { console.log("safeSend error:", error.message); return false; }
  if (!data || data.length === 0) { console.log("safeSend dup:", replyKey); return false; }

  await setPresence(cfg.uazapi_token, phone, "composing");
  const typingMs = Math.min(3000 + text.length * 25, 9000) + Math.floor(Math.random() * 2000);
  await sleep(typingMs);
  await sendWa(cfg.uazapi_token, phone, text);

  await db.from("pn_leads").update({
    last_sender_nome: `${cfg.agent_name} IA`,
    last_message_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", leadId);

  return true;
}

// ── Criar agendamento ─────────────────────────────────────────────────────────

async function criarAgendamento(
  cfg: ClinicConfig, leadId: string, medicoNome: string, dataHora: string, phone?: string
): Promise<void> {
  const last = medicoNome.split(" ").pop();
  const { data: med } = await db.from("pn_medicos").select("id").ilike("nome", `%${last}%`).maybeSingle();
  if (!med) {
    console.log(`Médico não encontrado: ${medicoNome}`);
    return;
  }

  await db.from("pn_agendamentos").insert({
    lead_id: leadId, medico_id: med.id, clinic_slug: cfg.slug,
    data_hora: dataHora, duracao_min: cfg.slot_duration_min || 60,
    status: "confirmado",
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  });

  const { data: ldCur } = await db.from("pn_leads").select("total_consultas").eq("id", leadId).single();
  await db.from("pn_leads").update({
    medico_preferido: medicoNome,
    total_consultas: ((ldCur?.total_consultas ?? 0) + 1),
    updated_at: new Date().toISOString(),
  }).eq("id", leadId);

  await logAudit({
    action: "APPOINTMENT_CREATED", table_name: "pn_agendamentos",
    record_id: leadId, user_phone: phone, severity: "info",
    metadata: { clinic: cfg.slug, medico: medicoNome, data_hora: dataHora },
  });
}

// ── Maria responde ─────────────────────────────────────────────────────────────

async function mariaRespond(
  cfg: ClinicConfig, lead: any, isNew: boolean, inboundBody: string
): Promise<void> {
  const brNow  = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const dateStr = brNow.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const systemPrompt = buildSystemPrompt(cfg, dateStr);

  let messages: any[];

  if (isNew) {
    const isGreeting = !inboundBody || inboundBody.length < 15 ||
      /^(oi+|ol[aá]|bom dia|boa tarde|boa noite|e a[ií]|tudo bem|al[oô]u?)[\s!?.]*$/i.test(inboundBody);
    const fromGoogle = /google|anúncio|anuncio|propaganda|maps/i.test(inboundBody);

    const greetingHint = isGreeting
      ? `- Paciente enviou apenas uma saudação. Apresente-se como ${cfg.agent_name} da ${cfg.clinic_name}, mencione brevemente as especialidades e pergunte como pode ajudar.`
      : "- Responda o que o paciente já informou (NÃO repita perguntas já respondidas).";

    const onboardNote = `\n\n## PRIMEIRO CONTATO\nNovo paciente.`
      + (fromGoogle ? "\n- ORIGEM: veio pelo Google." : "")
      + `\n${greetingHint}\n- Faça apenas a próxima pergunta necessária.`;

    messages = [
      { role: "system", content: systemPrompt + onboardNote },
      { role: "user",   content: inboundBody || "Oi" },
    ];
  } else {
    const [msgsRaw, patientCtx] = await Promise.all([
      db.from("pn_mensagens")
        .select("direction, body")
        .eq("lead_id", lead.id).eq("clinic_slug", cfg.slug)
        .order("created_at", { ascending: true }).limit(30),
      buildPatientContext(lead.id, cfg.slug),
    ]);

    const history = (msgsRaw.data ?? []).map((m: any) => ({
      role: m.direction === "in" ? "user" : "assistant",
      content: m.body,
    }));

    messages = [
      { role: "system", content: systemPrompt + patientCtx },
      ...history,
    ];
  }

  const gptRes = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({
      model: "gpt-4o",
      response_format: { type: "json_object" },
      messages,
    }),
  });

  if (!gptRes.ok) {
    console.error("GPT error", gptRes.status, await gptRes.text());
    return;
  }

  const aiData = await gptRes.json();
  let parsed: any;
  try { parsed = JSON.parse(aiData.choices[0].message.content); } catch { return; }
  if (!parsed.message) return;

  const replyKey = isNew ? `onboard_${lead.id}` : `reply_${lead.id}_${Date.now()}`;
  const sent = await safeSend(cfg, lead.id, lead.phone, parsed.message, replyKey);
  if (!sent) return;

  console.log(`${cfg.agent_name} [${cfg.slug}] → ${lead.phone} | action=${parsed.action}`);

  await logAudit({
    action: isNew ? "AI_ONBOARD" : "AI_REPLY",
    table_name: "pn_mensagens", record_id: lead.id,
    user_phone: lead.phone, severity: "info",
    metadata: { clinic: cfg.slug, action: parsed.action, stage: parsed.stage },
  });

  // Atualiza dados do lead extraídos pelo GPT
  const upd: any = { updated_at: new Date().toISOString() };
  if (parsed.nome_paciente && !lead.name) upd.name = parsed.nome_paciente;
  if (parsed.notas_paciente)             upd.notas = parsed.notas_paciente;
  if (parsed.medico_preferido)           upd.medico_preferido = parsed.medico_preferido;
  await db.from("pn_leads").update(upd).eq("id", lead.id);

  if (parsed.action === "criar_agendamento" && parsed.medico_nome && parsed.data_hora) {
    await criarAgendamento(cfg, lead.id, parsed.medico_nome, parsed.data_hora, lead.phone);
  }

  if (parsed.action === "handoff") {
    await db.from("pn_leads").update({ ai_mode: false, updated_at: new Date().toISOString() }).eq("id", lead.id);
    await logAudit({ action: "AI_HANDOFF", record_id: lead.id, user_phone: lead.phone, severity: "warning", metadata: { clinic: cfg.slug } });
  }
}

// ── Extrair mensagem do payload UAZAPI ────────────────────────────────────────

function extractMessage(body: any): WaMessage | null {
  // Formato 1: { messages: [...] }
  if (Array.isArray(body?.messages) && body.messages.length > 0) return body.messages[0];
  // Formato 2: { data: { messages: [...] } }
  if (Array.isArray(body?.data?.messages) && body.data.messages.length > 0) return body.data.messages[0];
  // Formato 3: mensagem direta no body
  if (body?.chatid || body?.messageType) return body as WaMessage;
  // Formato 4: { data: { message } }
  if (body?.data?.chatid || body?.data?.messageType) return body.data as WaMessage;
  return null;
}

// ── Handler principal ─────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  const cors = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const url  = new URL(req.url);
  const slug = url.searchParams.get("clinic");

  if (!slug) {
    return new Response(JSON.stringify({ error: "Parâmetro ?clinic= obrigatório" }), { status: 400, headers: cors });
  }

  // Carrega config da clínica
  const { data: cfg, error: cfgErr } = await db
    .from("clinic_configs")
    .select("*")
    .eq("slug", slug)
    .eq("active", true)
    .maybeSingle();

  if (cfgErr || !cfg) {
    console.log(`Clínica não encontrada ou inativa: ${slug}`);
    return new Response(JSON.stringify({ ok: true, skip: "clinic_not_found" }), { headers: cors });
  }

  // ai_active só desliga a Maria responder — lead e mensagem continuam sendo
  // capturados no Kanban em tempo real independente disso (ver aiOk mais abaixo).
  let body: any;
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: "Body JSON inválido" }), { status: 400, headers: cors });
  }

  const msg = extractMessage(body);
  if (!msg) {
    console.log(`[${slug}] Payload sem mensagem reconhecível`);
    await logAudit({
      action: "WEBHOOK_MESSAGE_SKIPPED", severity: "warning",
      metadata: { clinic: slug, reason: "no_message", raw_body: JSON.stringify(body).slice(0, 2000) },
    });
    return new Response(JSON.stringify({ ok: true, skip: "no_message" }), { headers: cors });
  }

  // BotGuard — não responder a si mesmo nem a grupos
  if (msg.fromMe || msg.isGroup) {
    return new Response(JSON.stringify({ ok: true, skip: "self_or_group" }), { headers: cors });
  }

  const phone = msg.chatid?.split("@")[0];
  if (!phone) {
    await logAudit({
      action: "WEBHOOK_MESSAGE_SKIPPED", severity: "warning",
      metadata: { clinic: slug, reason: "no_phone", messageType: msg.messageType, chatid: msg.chatid, raw_msg: JSON.stringify(msg).slice(0, 2000) },
    });
    return new Response(JSON.stringify({ ok: true, skip: "no_phone" }), { headers: cors });
  }

  // Reacao (emoji num balaozinho) nao e conteudo novo do cliente — unico caso que ainda pula
  // sem tocar o lead. Qualquer outra coisa (figurinha, localizacao, enquete, contato, formato
  // nao reconhecido) SEMPRE cria/atualiza o lead — garantia de nao perder card no Kanban.
  if (msg.messageType === "ReactionMessage") {
    return new Response(JSON.stringify({ ok: true, skip: "reaction" }), { headers: cors });
  }

  const hasContent = msg.text || msg.content?.text || msg.body || msg.content?.URL || MEDIA_TYPES.includes(msg.messageType);
  if (!hasContent) {
    await logAudit({
      action: "WEBHOOK_MESSAGE_SKIPPED", severity: "warning",
      user_phone: phone,
      metadata: { clinic: slug, reason: "no_content_mas_lead_criado", messageType: msg.messageType, raw_msg: JSON.stringify(msg).slice(0, 2000) },
    });
  }

  const senderName = msg.senderName || msg.pushName || null;
  const inboundBody = extractText(msg) || (msg.messageType ? `[${msg.messageType}]` : "[mensagem sem conteudo reconhecido]");
  const msgId       = msg.messageid || msg.id;
  const msgTs       = toMs(msg.messageTimestamp || Date.now());

  // Anti-duplicata: ignora mensagem já processada
  if (msgId) {
    const { count } = await db.from("pn_mensagens")
      .select("id", { count: "exact", head: true })
      .eq("external_id", msgId);
    if ((count ?? 0) > 0) {
      console.log(`[${slug}] Mensagem duplicada ${msgId}`);
      return new Response(JSON.stringify({ ok: true, skip: "duplicate" }), { headers: cors });
    }
  }

  // Busca ou cria lead
  const { data: existingLead } = await db.from("pn_leads")
    .select("*").eq("phone", phone).eq("clinic_slug", slug).maybeSingle();

  const isNew = !existingLead;

  // Stage gerenciado manualmente pela equipe — Maria só para de responder em "resolvido"
  const PROTECTED_STAGES = ["resolvido"];

  let lead: any;
  if (isNew) {
    const { data: newLead, error: insertErr } = await db.from("pn_leads").insert({
      phone, clinic_slug: slug,
      name: senderName || null,
      whatsapp_name: senderName || null,
      stage: "em_atendimento",
      first_message: inboundBody.slice(0, 500),
      ai_mode: true,
      last_sender_nome: senderName,
      last_message_at: new Date(msgTs).toISOString(),
      updated_at: new Date().toISOString(),
    }).select("*").single();

    if (insertErr) {
      if (insertErr.code === "23505") {
        // Corrida: outra entrega do mesmo webhook já criou o lead pra esse telefone.
        const { data: raceLead } = await db.from("pn_leads")
          .select("*").eq("phone", phone).eq("clinic_slug", slug).maybeSingle();
        lead = raceLead;
      } else {
        console.error(`[${slug}] Falha ao criar lead:`, insertErr);
        await logAudit({
          action: "LEAD_CREATE_FAILED", table_name: "pn_leads",
          user_phone: phone, severity: "error",
          metadata: { clinic: slug, error: insertErr.message, name: senderName },
        });
      }
    } else {
      lead = newLead;
      await logAudit({
        action: "LEAD_CREATED", table_name: "pn_leads",
        record_id: lead?.id, user_phone: phone, severity: "info",
        metadata: { clinic: slug, name: senderName, first_message: inboundBody.slice(0, 100) },
      });
    }
  } else {
    const upd: any = {
      last_sender_nome: senderName,
      last_message_at: new Date(msgTs).toISOString(),
      updated_at: new Date().toISOString(),
    };
    if (senderName) upd.whatsapp_name = senderName;
    await db.from("pn_leads").update(upd).eq("id", existingLead.id);
    lead = { ...existingLead, ...upd };
  }

  if (!lead) {
    return new Response(JSON.stringify({ error: "Falha ao criar/buscar lead" }), { status: 500, headers: cors });
  }

  // Salva mensagem do paciente
  const mType = getMediaType(msg.messageType);
  const mBody = inboundBody || (mType ? `[${mType}]` : "");
  if (msgId) {
    await db.from("pn_mensagens").upsert(
      {
        lead_id: lead.id, clinic_slug: slug,
        direction: "in", body: mBody, sender_nome: null,
        external_id: msgId,
        media_url:      msg.content?.URL || null,
        media_type:     mType,
        media_mimetype: msg.content?.mimetype || null,
        media_filename: msg.content?.fileName || null,
        created_at: new Date(msgTs).toISOString(),
      },
      { onConflict: "external_id", ignoreDuplicates: true }
    );
  }

  // Maria responde (se a clinica tiver ai_active, lead não estiver em stage protegido e ai_mode ativo)
  const aiOk = cfg.ai_active && lead.ai_mode !== false && !PROTECTED_STAGES.includes(lead.stage);
  if (aiOk) {
    await mariaRespond(cfg as ClinicConfig, lead, isNew, inboundBody);
  } else {
    console.log(`[${slug}] Skip Maria — ai_active=${cfg.ai_active} stage=${lead.stage} ai_mode=${lead.ai_mode}`);
  }

  return new Response(JSON.stringify({ ok: true }), { headers: cors });
});
