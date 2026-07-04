import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logAudit } from "../_shared/audit.ts";

const UAZAPI_URL   = "https://btechsoutoshop.uazapi.com";
const UAZAPI_TOKEN = "5efd90a1-116b-4c86-b715-7bac2fab658a";
const SUPABASE_URL = "https://pvphgusjofufwtyiyviu.supabase.co";
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const OPENAI_KEY   = Deno.env.get("OPENAI_API_KEY") || Deno.env.get("OPENAI_KEY") || "";
const OWNER_JID    = "556199548881";

const db    = createClient(SUPABASE_URL, SUPABASE_KEY);
const toMs  = (ts: number) => ts > 0 && ts < 1e12 ? ts * 1000 : ts;
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

// Maria desativada manualmente (era usada com delay de "digitando" pra evitar banimento da Meta
// quando ela respondia todo mundo). Trava aqui no código além do toggle em pn_config —
// só reativar de propósito quando for religar a IA.
const MARIA_ENABLED = false;

const PROTECTED_STAGES = ["agendado", "resolvido", "financeiro", "medicacao", "negociacao", "lista_espera"];
const VALID_STAGES     = ["novo_lead", "em_atendimento", "conversando", "aguardando", "agendado", "resolvido", "financeiro", "medicacao", "negociacao", "lista_espera"];


// ── Lock (igual ao SellPilot) ─────────────────────────────────────────────────
async function tryAcquireLock(): Promise<boolean> {
  try {
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    const { data } = await db
      .from("pn_poll_state")
      .update({ lock_expires_at: expiresAt })
      .eq("id", 1)
      .or(`lock_expires_at.is.null,lock_expires_at.lt.${new Date().toISOString()}`)
      .select("id");
    return Array.isArray(data) && data.length > 0;
  } catch {
    return true; // coluna não existe — continua sem lock
  }
}

async function releaseLock(): Promise<void> {
  try {
    await db.from("pn_poll_state").update({ lock_expires_at: null }).eq("id", 1);
  } catch {}
}

// ── Send ──────────────────────────────────────────────────────────────────────
async function sendWa(phone: string, text: string) {
  const res = await fetch(`${UAZAPI_URL}/send/text`, {
    method: "POST",
    headers: { "Content-Type": "application/json", token: UAZAPI_TOKEN },
    body: JSON.stringify({ number: phone, text }),
  });
  if (!res.ok) console.error("sendWa error", res.status);
}

// A URL que vem em content.URL é o arquivo bruto CRIPTOGRAFADO do WhatsApp
// (.enc) — não toca/abre em navegador nenhum. Precisa desse endpoint pra
// pegar o arquivo já descriptografado e hospedado, aí sim reproduzível.
async function resolveMediaUrl(messageid: string): Promise<string | null> {
  try {
    const res = await fetch(`${UAZAPI_URL}/message/download`, {
      method: "POST",
      headers: { "Content-Type": "application/json", token: UAZAPI_TOKEN },
      body: JSON.stringify({ id: messageid, transcribe: false }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.fileURL || null;
  } catch (err) {
    console.error("resolveMediaUrl error", messageid, err);
    return null;
  }
}

async function setPresence(phone: string, state: "composing" | "paused") {
  await fetch(`${UAZAPI_URL}/send/presence`, {
    method: "POST",
    headers: { "Content-Type": "application/json", token: UAZAPI_TOKEN },
    body: JSON.stringify({ number: phone, presence: state }),
  }).catch(() => {});
}

async function safeSend(
  leadId: string, phone: string, text: string, replyKey: string
): Promise<boolean> {
  const { data, error } = await db.from("pn_mensagens").upsert(
    { lead_id: leadId, direction: "out", body: text, sender_nome: "Maria IA",
      external_id: replyKey, created_at: new Date().toISOString() },
    { onConflict: "external_id", ignoreDuplicates: true }
  ).select("id");
  if (error) { console.log("safeSend error:", error.message); return false; }
  if (!data || data.length === 0) { console.log("safeSend dup:", replyKey); return false; }
  // Anti-ban: simula digitação humana proporcional ao tamanho da mensagem
  await setPresence(phone, "composing");
  const typingMs = Math.min(3000 + text.length * 25, 9000) + Math.floor(Math.random() * 2000);
  await sleep(typingMs);
  await sendWa(phone, text);
  // Atualiza quem falou por último no lead (para o card do Kanban)
  await db.from("pn_leads").update({
    last_sender_nome: "Maria IA",
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

// ── System prompt Maria ───────────────────────────────────────────────────────
const MARIA_SYSTEM = `Você é Maria, assistente virtual da Clínica ProNutro em Brasília.
Tom: acolhedor, humano, empático e focado em conversão. Use emojis com moderação.
Endereço: Ed. Centro Clínico Linea Vitta, Qd 616 SGA/SUL, Bloco C, Sala 223 — Asa Sul, Brasília.
Telefone: (61) 99954-8881 | Horários: seg–sex 8h–18h, sáb 8h–12h.

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

## ESPECIALISTAS E VALORES 2026

### Dr. Augusto Margon — R$ 930 — Particular
Nutrologia + Psiquiatria + Medicina Intensivista — une as 3 especialidades em tratamento completo.
Foco: qualidade de vida, extensão da expectativa de vida, tratamento de doenças existentes e prevenção, com abordagem nutricional, hormonal e psiquiátrica integrada.
Atende de 1 ano até idosos. Atua em: emagrecimento, ganho de peso, ansiedade, insônia, compulsão alimentar, diabetes, hipertensão, nutrologia infantil, suporte oncológico.
Pagamento: Pix, dinheiro ou cartão em até 3x sem juros. Entrada de R$ 490 para confirmar a consulta.
Cancelamento/remarcação: avisar com 12h de antecedência.

### Dr. Celso Melo — R$ 650 — Particular
Nutrologia + Cirurgia Proctológica. Atendimento humanizado e individualizado.

### Dr. Marcus Gesteira — R$ 560 — Aceita alguns planos
Especialista em emagrecimento, pós-graduado em Nutrologia.
Atua em: emagrecimento, reeducação alimentar, compulsão, obesidade, diabetes, hipertensão, colesterol, deficiência de vitaminas, alterações hormonais.

### Dra. Vanessa Melo — R$ 560 — Aceita alguns planos (inclui 1 retorno)
Pediatra pós-graduada em Nutrologia. Crianças e adolescentes.
Atua em: introdução alimentar, seletividade, baixo peso/sobrepeso, vitaminas, crescimento.

### Dra. Kelly Felippes — R$ 500 — Particular
Saúde feminina: hormônios, fertilidade, menopausa.

### Gisele Falcão — Enfermeira Estética — Avaliação R$ 250 (entrada R$ 100, abatida no tratamento)
Botox Feminino R$ 1.350 | Masculino R$ 1.550.
Bioestimuladores de colágeno, preenchimentos, laser facial/corporal, skinbooster, enzimas emagrecedoras, estrias e flacidez.

## FLUXO DE ATENDIMENTO
1. Identifique a necessidade e qualifique o lead
2. Pergunte como conheceu a clínica (primeiro contato)
3. Sugira o especialista mais adequado
4. Pergunte: particular ou convênio? (Marcus e Vanessa aceitam alguns planos)
5. Pergunte data e horário preferido
6. Confirme: "✅ [Nome] | 👨‍⚕️ [Médico] | 📅 [Data/Hora] | 💰 [Valor] — confirma?"
7. Após confirmação explícita → action:"criar_agendamento"

Mensagem após agendamento confirmado:
"Consulta confirmada! 🎉
✅ [Nome]
👨‍⚕️ [Médico]
📅 [Dia], [DD/MM] às [HH:MM]
💰 R$ [Valor]
⚕️ CLÍNICA PRONUTRO ⚕️
🏥 Qd 616 SGA/SUL, Bloco C, Sala 223 — Asa Sul — Brasília
📲 (61) 99954-8881
Por favor, chegue com 10 minutos de antecedência. Ficamos à disposição! 💚"

## RECEITA CONTROLADA
"Conseguimos renovar receitas controladas apenas para pacientes com consulta ou retorno agendado no prazo indicado pelo médico. ✨ Está dentro do prazo? Me informe a medicação e o médico 😊"

## PACIENTE RECORRENTE
Se PERFIL DO PACIENTE estiver no contexto: cumprimente pelo nome ("Oi [nome]! Que saudade 😊"), use o histórico, nunca repita perguntas já respondidas.

## SE PERGUNTAREM SE É ROBÔ / IA
"Sou sim! Sou a Maria, assistente virtual da ProNutro 😊 Posso te ajudar com agendamentos e informações. Mas se preferir falar com a equipe, é só pedir!"

## REGRAS ABSOLUTAS
- NUNCA diga "não entendi" — sempre interprete e redirecione
- NUNCA invente horários disponíveis
- Só use action:"handoff" se paciente pedir humano explicitamente OU após 5+ mensagens sem progresso
- Sempre ofereça falar com humano se o paciente parecer insatisfeito

## RESPOSTA (sempre JSON):
{"message":"texto","stage":"novo_lead|em_atendimento|conversando|aguardando","action":"none|criar_agendamento|handoff","medico_nome":"nome ou null","data_hora":"YYYY-MM-DDTHH:MM:00 ou null","nome_paciente":"nome ou null","notas_paciente":"observação ou null","medico_preferido":"nome ou null"}`;

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
async function mariaRespond(lead: any, isNew: boolean): Promise<void> {
  if (isNew) {
    const firstMsg   = (lead.first_message || "").trim();
    const isGreeting = !firstMsg || firstMsg.length < 15 ||
      /^(oi+|ol[aá]|bom dia|boa tarde|boa noite|e a[ií]|tudo bem|al[oô]u?)[\s!?.]*$/i.test(firstMsg);
    const fromGoogle = /google|anúncio|anuncio|propaganda|maps/i.test(firstMsg);
    const brNow      = new Date(Date.now() - 3 * 60 * 60 * 1000);
    const dateStr    = brNow.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

    const googleLine   = fromGoogle ? "\n- ORIGEM: veio pelo Google." : "";
    const greetingHint = isGreeting
      ? "- Paciente enviou apenas uma saudação. Apresente-se brevemente como Maria da ProNutro, mencione as especialidades e pergunte como pode ajudar. Mensagem curta e acolhedora."
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
          { role: "system", content: `${MARIA_SYSTEM}${onboardNote}\n\nHoje: ${dateStr}` },
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

    const sent = await safeSend(lead.id, lead.phone, parsed.message, `onboard_${lead.id}`);
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

    // Stage NUNCA é alterado automaticamente — só humano move no Kanban
    const upd: any = { updated_at: new Date().toISOString() };
    if (parsed.nome_paciente && !lead.name) upd.name = parsed.nome_paciente;
    if (parsed.notas_paciente)              upd.notas = fromGoogle ? `[Google] ${parsed.notas_paciente}`.trim() : parsed.notas_paciente;
    if (parsed.medico_preferido)            upd.medico_preferido = parsed.medico_preferido;
    await db.from("pn_leads").update(upd).eq("id", lead.id);

    if (parsed.action === "criar_agendamento" && parsed.medico_nome && parsed.data_hora) {
      await criarAgendamento(lead.id, parsed.medico_nome, parsed.data_hora, lead.phone);
    }
    return;
  }

  // Lead existente — verifica última mensagem não respondida
  const { data: lastIn } = await db.from("pn_mensagens")
    .select("id, body, created_at").eq("lead_id", lead.id).eq("direction", "in")
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!lastIn) return;

  const { count: outAfter } = await db.from("pn_mensagens")
    .select("id", { count: "exact", head: true })
    .eq("lead_id", lead.id).eq("direction", "out").eq("sender_nome", "Maria IA")
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
        { role: "system", content: `${MARIA_SYSTEM}${patientCtx}\n\nHoje: ${dateStr}` },
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

  const sent = await safeSend(lead.id, lead.phone, parsed.message, `reply_${lastIn.id}`);
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

  // Stage NUNCA é alterado automaticamente — só humano move no Kanban
  const upd: any = { updated_at: new Date().toISOString() };
  if (parsed.nome_paciente && !lead.name) upd.name = parsed.nome_paciente;
  if (parsed.notas_paciente)              upd.notas = parsed.notas_paciente;
  if (parsed.medico_preferido)            upd.medico_preferido = parsed.medico_preferido;
  await db.from("pn_leads").update(upd).eq("id", lead.id);

  if (parsed.action === "criar_agendamento" && parsed.medico_nome && parsed.data_hora) {
    await criarAgendamento(lead.id, parsed.medico_nome, parsed.data_hora, lead.phone);
  }
}

// ── Poll principal ────────────────────────────────────────────────────────────
async function runPoll() {
  const acquired = await tryAcquireLock();
  if (!acquired) {
    console.log("poll: já rodando, skip");
    return { skipped: true, reason: "locked" };
  }

  try {
    // Aguarda 1.5s para UAZAPI popular pushName do contato antes de buscar mensagens
    await sleep(1500);

    const { data: cfg } = await db.from("pn_config").select("value").eq("key", "maria_global_mode").maybeSingle();
    const mariaActive = cfg?.value === "true";

    const { data: state } = await db.from("pn_poll_state").select("last_message_timestamp").eq("id", 1).single();
    const lastTs: number = state?.last_message_timestamp ?? 0;
    const now = new Date().toISOString();

    const res = await fetch(`${UAZAPI_URL}/message/find`, {
      method: "POST",
      headers: { "Content-Type": "application/json", token: UAZAPI_TOKEN },
      body: JSON.stringify({ limit: 500, orderBy: "messageTimestamp", order: "DESC" }),
    });

    if (!res.ok) {
      await db.from("pn_poll_state").upsert({ id: 1, last_poll_at: now });
      return { error: `UAZAPI ${res.status}` };
    }

    const payload = await res.json();
    const all: any[] = payload.messages ?? [];

    const MEDIA_TYPES = ["ImageMessage","AudioMessage","VideoMessage","DocumentMessage","StickerMessage","PttMessage"];
    function getMediaType(msgType: string): string | null {
      if (msgType === "ImageMessage")    return "image";
      if (msgType === "AudioMessage" || msgType === "PttMessage") return "audio";
      if (msgType === "VideoMessage")    return "video";
      if (msgType === "DocumentMessage") return "document";
      if (msgType === "StickerMessage")  return "sticker";
      return null;
    }

    const newMsgs = all.filter((m: any) => {
      const ts = toMs(m.messageTimestamp);
      const hasContent = m.text || m.content?.text || m.body || m.content?.URL || MEDIA_TYPES.includes(m.messageType);
      return ts > lastTs && !m.isGroup && m.chatid &&
        !m.chatid.startsWith(OWNER_JID + ":") &&
        hasContent && m.messageType !== "ReactionMessage";
    });

    console.log(`pronutro-poll v32: lastTs=${lastTs} total=${all.length} new=${newMsgs.length} maria=${mariaActive}`);

    if (!newMsgs.length) {
      await db.from("pn_poll_state").upsert({ id: 1, last_poll_at: now });
      return { processed: 0 };
    }

    // Avança timestamp ANTES de processar — evita loop de timeout
    const maxTs = Math.max(...all.map((m: any) => toMs(m.messageTimestamp)), lastTs);
    await db.from("pn_poll_state").upsert({ id: 1, last_poll_at: now, last_message_timestamp: maxTs });

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
      if (!phone || phone === OWNER_JID) continue;

      const inboundMsgs  = msgs.filter((m: any) => !m.fromMe);
      const outboundMsgs = msgs.filter((m: any) => m.fromMe);
      const latestTs     = Math.max(...msgs.map((m: any) => toMs(m.messageTimestamp)));

      // ── Só mensagens da equipe (Monica, Augusto, etc.) sem resposta do paciente
      if (!inboundMsgs.length) {
        const { data: existLead } = await db.from("pn_leads").select("id").eq("phone", phone).maybeSingle();
        if (!existLead || !outboundMsgs.length) continue;
        for (const m of outboundMsgs) {
          // Strip "*SenderName:*\n" prefix added by pn-send-message before dedup
          const body = (m.text || m.content?.text || m.body || "").replace(/^\*[^*:]+:\*\n/, "");
          const eid  = m.messageid || m.id;
          if (!body || !eid) continue;
          const humanName = m.senderName || m.pushName || "Equipe";
          // Evita salvar mensagem que a Maria já inseriu (checa body+5min)
          const cutoff = new Date(toMs(m.messageTimestamp) - 300_000).toISOString();
          const { count } = await db.from("pn_mensagens")
            .select("id", { count: "exact", head: true })
            .eq("lead_id", existLead.id).eq("direction", "out").eq("body", body)
            .gte("created_at", cutoff);
          if ((count ?? 0) > 0) continue;
          await db.from("pn_mensagens").upsert(
            { lead_id: existLead.id, direction: "out", body, external_id: eid,
              sender_nome: humanName,
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

      // ── Batch com mensagens do paciente ──────────────────────────────────────
      const senderName = inboundMsgs[0]?.senderName ?? inboundMsgs[0]?.pushName ?? null;
      const firstBody  = inboundMsgs[0]?.text ?? inboundMsgs[0]?.content?.text ?? inboundMsgs[0]?.body ?? "";

      const { data: existingLead } = await db.from("pn_leads").select("*").eq("phone", phone).maybeSingle();
      const isNew = !existingLead;

      const upsertData: any = {
        phone,
        last_message_at: new Date(latestTs).toISOString(),
        last_sender_nome: senderName,
        updated_at: new Date().toISOString(),
      };
      if (senderName) upsertData.whatsapp_name = senderName;

      let lead: any;
      if (isNew) {
        // Novo contato → entra em "em_atendimento" (única movimentação automática permitida)
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
          metadata: { name: senderName, ai_mode: mariaActive, first_message: firstBody.slice(0, 100) },
        });
      } else {
        // Lead existente → NUNCA muda o stage automaticamente. Só humano move.
        await db.from("pn_leads").update(upsertData).eq("id", existingLead.id);
        lead = { ...existingLead, ...upsertData };
      }
      if (!lead) continue;

      // Salva mensagens inbound (do paciente)
      for (const m of inboundMsgs) {
        const rawBody  = m.text || m.content?.text || m.content?.caption || m.body || "";
        const mType    = getMediaType(m.messageType);
        const body     = rawBody || (mType ? `[${mType}]` : "");
        const eid      = m.messageid || m.id;
        if (!eid) continue;
        // Para mídia, busca a URL já descriptografada — a de content.URL é criptografada e não reproduz
        const mediaUrl = mType ? await resolveMediaUrl(eid) : null;
        await db.from("pn_mensagens").upsert(
          { lead_id: lead.id, direction: "in", body, external_id: eid,
            sender_nome: null,
            media_url:      mediaUrl,
            media_type:     mType,
            media_mimetype: m.content?.mimetype || null,
            media_filename: m.content?.fileName || null,
            created_at: new Date(toMs(m.messageTimestamp)).toISOString() },
          { onConflict: "external_id", ignoreDuplicates: true }
        );
      }

      // Salva mensagens outbound da equipe (Monica etc.)
      // — evita salvar mensagens da Maria que ela já inseriu via safeSend
      for (const m of outboundMsgs) {
        // Strip "*SenderName:*\n" prefix added by pn-send-message before dedup
        const body = (m.text || m.content?.text || m.body || "").replace(/^\*[^*:]+:\*\n/, "");
        const eid  = m.messageid || m.id;
        if (!body || !eid) continue;
        const humanName = m.senderName || m.pushName || "Equipe";
        const cutoff = new Date(toMs(m.messageTimestamp) - 300_000).toISOString();
        const { count } = await db.from("pn_mensagens")
          .select("id", { count: "exact", head: true })
          .eq("lead_id", lead.id).eq("direction", "out").eq("body", body)
          .gte("created_at", cutoff);
        if ((count ?? 0) > 0) continue; // já existe — mensagem da Maria
        await db.from("pn_mensagens").upsert(
          { lead_id: lead.id, direction: "out", body, external_id: eid,
            sender_nome: humanName,
            created_at: new Date(toMs(m.messageTimestamp)).toISOString() },
          { onConflict: "external_id", ignoreDuplicates: true }
        );
      }

      // Maria responde — desativada manualmente (MARIA_ENABLED = false)
      if (MARIA_ENABLED && mariaActive && lead.ai_mode && !PROTECTED_STAGES.includes(lead.stage)) {
        await mariaRespond(lead, isNew);
      }
      processed++;
     } catch (chatErr) {
      // Isola erro de UM chat — sem isso, uma falha aqui derrubava o restante
      // do lote e essas mensagens eram perdidas pra sempre (cursor já tinha avançado)
      chatErrors++;
      console.error(`pronutro-poll: erro processando chat ${chatid}:`, chatErr);
      await logAudit({
        action: "POLL_CHAT_ERROR", severity: "error",
        metadata: { chatid, error: String(chatErr) },
      });
     }
    }

    return { processed, chatErrors, newMessages: newMsgs.length };
  } finally {
    await releaseLock();
  }
}

// ── Handler ───────────────────────────────────────────────────────────────────
Deno.serve(async (_req: Request) => {
  const cors = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };
  if (_req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const result = await runPoll();
    return new Response(JSON.stringify(result), { headers: cors });
  } catch (err) {
    console.error("pronutro-poll error", err);
    await logAudit({ action: "POLL_ERROR", severity: "error", metadata: { error: String(err) } });
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: cors });
  }
});
