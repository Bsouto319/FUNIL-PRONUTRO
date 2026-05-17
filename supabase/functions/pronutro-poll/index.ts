import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const UAZAPI_URL   = "https://btechsoutoshop.uazapi.com";
const UAZAPI_TOKEN = "5efd90a1-116b-4c86-b715-7bac2fab658a";
const SUPABASE_URL = "https://pvphgusjofufwtyiyviu.supabase.co";
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const OPENAI_KEY   = Deno.env.get("OPENAI_KEY") || "";
const OWNER_JID    = "556199548881";

const db    = createClient(SUPABASE_URL, SUPABASE_KEY);
const toMs  = (ts: number) => ts > 0 && ts < 1e12 ? ts * 1000 : ts;
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

const PROTECTED_STAGES = ["perdido"];
const VALID_STAGES     = ["novo_lead", "maria_ia", "interesse_real", "agendado", "perdido"];

// ── Anti-ban helpers ──────────────────────────────────────────────────────────

/** Horário comercial Brasília: 7h–22h */
function isBusinessHours(): boolean {
  const h = new Date(Date.now() - 3 * 60 * 60 * 1000).getUTCHours();
  return h >= 7 && h < 22;
}

/** Delay aleatório para simular leitura da mensagem do paciente */
function readDelay(bodyLen: number): number {
  const base = Math.min(Math.ceil(bodyLen / 5) * 180, 3000); // ~180ms/palavra, max 3s
  return base + 800 + Math.floor(Math.random() * 1200);       // + 0.8~2s aleatório
}

/** Duração de "digitação" proporcional ao tamanho da resposta */
function typingDuration(replyLen: number): number {
  return Math.min(replyLen * 40, 5000) + Math.floor(Math.random() * 1500); // max 6.5s
}

/** Envia indicador de presença (digitando / pausado) */
async function setPresence(phone: string, state: "composing" | "paused") {
  await fetch(`${UAZAPI_URL}/send/presence`, {
    method: "POST",
    headers: { "Content-Type": "application/json", token: UAZAPI_TOKEN },
    body: JSON.stringify({ number: phone, presence: state }),
  }).catch(() => {});
}

/**
 * Quebra mensagens longas em partes menores para parecer mais humano.
 * Divide por parágrafo duplo, depois por linha, depois deixa como está.
 */
function splitChunks(text: string): string[] {
  if (text.length <= 280) return [text];
  const byPara = text.split(/\n{2,}/).map(s => s.trim()).filter(Boolean);
  if (byPara.length > 1) return byPara;
  const byLine = text.split(/\n/).map(s => s.trim()).filter(Boolean);
  if (byLine.length > 1) return byLine;
  return [text];
}

// ── Core send ─────────────────────────────────────────────────────────────────

async function sendWa(phone: string, text: string) {
  const res = await fetch(`${UAZAPI_URL}/send/text`, {
    method: "POST",
    headers: { "Content-Type": "application/json", token: UAZAPI_TOKEN },
    body: JSON.stringify({ number: phone, text }),
  });
  if (!res.ok) console.error("sendWa error", res.status);
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
  if (!data || data.length === 0) { console.log("safeSend: dup", replyKey); return false; }
  await sendWa(phone, text);
  return true;
}

/**
 * Envia resposta com comportamento humano:
 * 1. Pausa simulando leitura
 * 2. Indicador de digitação por tempo proporcional
 * 3. Divide mensagens longas com pausa entre partes
 */
async function humanSend(
  leadId: string, phone: string, text: string,
  replyKey: string, lastMsgLen = 30
): Promise<boolean> {
  // Simula leitura
  await sleep(readDelay(lastMsgLen));

  const chunks = splitChunks(text);
  let sent = false;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const key   = i === 0 ? replyKey : `${replyKey}_p${i}`;

    await setPresence(phone, "composing");
    await sleep(typingDuration(chunk.length));
    await setPresence(phone, "paused");

    const ok = await safeSend(leadId, phone, chunk, key);
    if (i === 0) sent = ok;

    if (i < chunks.length - 1) {
      await sleep(1200 + Math.floor(Math.random() * 1300));
    }
  }

  return sent;
}

// ── Recibo por imagem ─────────────────────────────────────────────────────────

async function processReceiptImage(msg: any): Promise<void> {
  const imageUrl = msg.url || msg.mediaUrl || msg.content?.url || msg.media?.url || msg.fileUrl;
  const caption  = msg.caption || msg.content?.caption || msg.text || "";
  if (!imageUrl) return;

  const imgRes = await fetch(imageUrl, { headers: { token: UAZAPI_TOKEN } });
  if (!imgRes.ok) return;

  const buf   = await imgRes.arrayBuffer();
  const uint8 = new Uint8Array(buf);
  let binary  = "";
  for (let i = 0; i < uint8.length; i++) binary += String.fromCharCode(uint8[i]);
  const base64   = btoa(binary);
  const mimeType = imgRes.headers.get("content-type") || "image/jpeg";

  const gptRes = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({
      model: "gpt-4o", response_format: { type: "json_object" }, max_tokens: 400,
      messages: [{ role: "user", content: [
        { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64}`, detail: "low" } },
        { type: "text", text: `Analise este recibo de pagamento de clínica.\nTexto junto: "${caption}"\nRetorne JSON: {"is_recibo":true|false,"valor":number|null,"forma_pagamento":"crédito"|"débito"|"pix"|"dinheiro"|null,"bandeira":string|null,"parcelas":number,"data_pagamento":"YYYY-MM-DD"|null,"nome_paciente":string|null,"medico_nome":string|null}` },
      ]}],
    }),
  });
  if (!gptRes.ok) return;

  const aiData = await gptRes.json();
  let parsed: any;
  try { parsed = JSON.parse(aiData.choices[0].message.content); } catch { return; }
  if (!parsed.is_recibo || !parsed.valor) return;

  let medicoId: string | null = null;
  if (parsed.medico_nome) {
    const last = parsed.medico_nome.split(" ").pop();
    const { data: med } = await db.from("pn_medicos").select("id").ilike("nome", `%${last}%`).maybeSingle();
    medicoId = med?.id || null;
  }
  let leadId: string | null = null;
  if (parsed.nome_paciente) {
    const { data: lead } = await db.from("pn_leads").select("id").ilike("name", `%${parsed.nome_paciente}%`).maybeSingle();
    leadId = lead?.id || null;
  }

  await db.from("pn_financeiro").insert({
    medico_id: medicoId, lead_id: leadId,
    nome_paciente: parsed.nome_paciente, medico_nome: parsed.medico_nome,
    valor: parsed.valor, forma_pagamento: parsed.forma_pagamento,
    bandeira: parsed.bandeira, parcelas: parsed.parcelas || 1,
    data_pagamento: parsed.data_pagamento ? `${parsed.data_pagamento}T12:00:00` : new Date().toISOString(),
    observacoes: caption || null, registrado_por: "receita_imagem",
    created_at: new Date().toISOString(),
  });
}

// ── Maria IA ──────────────────────────────────────────────────────────────────

function getSaudacao(nome?: string | null): string {
  const h  = new Date(Date.now() - 3 * 60 * 60 * 1000).getUTCHours();
  const oi = h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
  return `${oi}! 😊\n\nMeu nome é Maria e serei responsável pelo seu atendimento a partir de agora.\n\nSomos uma clínica especializada em nutrologia, endocrinologia, proctologia, pediatria, clínica médica da família, psiquiatria e saúde da mulher.\n\nPara te direcionar ao profissional mais adequado, poderia nos informar qual a finalidade da consulta e o motivo da sua procura?\n\nComo conheceu a nossa clínica? 💚`;
}

/** Monta o bloco de contexto do paciente recorrente para incluir no prompt da Maria */
async function buildPatientContext(leadId: string): Promise<string> {
  const [agendRaw, notasRaw] = await Promise.all([
    db.from("pn_agendamentos")
      .select("data_hora, status, pn_medicos(nome)")
      .eq("lead_id", leadId)
      .order("data_hora", { ascending: false })
      .limit(10),
    db.from("pn_leads")
      .select("notas, medico_preferido, total_consultas")
      .eq("id", leadId)
      .single(),
  ]);

  const agendamentos = agendRaw.data ?? [];
  const perfil       = notasRaw.data;

  if (!agendamentos.length && !perfil?.notas) return "";

  const linhas: string[] = [];

  if (agendamentos.length > 0) {
    const realizados  = agendamentos.filter((a: any) => a.status === "realizado");
    const confirmados = agendamentos.filter((a: any) => a.status === "confirmado");
    const proxima     = confirmados[0];
    const ultima      = realizados[0];

    linhas.push(`## PERFIL DO PACIENTE (use para personalizar — não leia em voz alta)`);

    if (proxima) {
      const dt = new Date(proxima.data_hora).toLocaleDateString("pt-BR");
      const med = (proxima as any).pn_medicos?.nome || "médico";
      linhas.push(`• Consulta confirmada: ${dt} com ${med}`);
    }
    if (ultima) {
      const dt = new Date(ultima.data_hora).toLocaleDateString("pt-BR");
      const med = (ultima as any).pn_medicos?.nome || "médico";
      linhas.push(`• Última consulta realizada: ${dt} com ${med}`);
    }
    if (perfil?.medico_preferido) linhas.push(`• Médico de preferência: ${perfil.medico_preferido}`);
    if (realizados.length > 0)    linhas.push(`• Total de consultas realizadas: ${realizados.length}`);
  }

  if (perfil?.notas) linhas.push(`• Observações: ${perfil.notas}`);

  return linhas.length > 0 ? "\n\n" + linhas.join("\n") : "";
}

const MARIA_SYSTEM = `Você é Maria, atendente virtual da Clínica ProNutro em Brasília.
Tom: acolhedor, empático e profissional.
Endereço: Ed. Centro Clínico Linea Vitta, Qd 616 SGA/SUL, Bloco C, Sala 223 — Asa Sul, Brasília.
Telefone: (61) 99954-8881

## MÉDICOS
Dr. Augusto Margon — R$ 980 (plano 60 dias) — Particular apenas. Nutrologia + Psiquiatria + Medicina Intensivista. Emagrecimento, ansiedade, insônia, compulsão alimentar, diabetes, nutrologia infantil.
Dr. Celso Melo — R$ 650 — Particular. Nutrologia + Proctologia.
Dr. Marcus Gesteira — R$ 560 — Aceita alguns planos. Emagrecimento, reeducação alimentar, diabetes, hipertensão.
Dra. Vanessa Melo — R$ 560 — Aceita alguns planos — 1 retorno incluído. Pediatra + Nutrologia infantil.
Dra. Kelly Felippes — R$ 500 — Particular. Saúde feminina, hormônios, fertilidade, menopausa.
Gisele Falcão (Enfermeira Estética) — Avaliação R$ 250. Botox, preenchimento, bioestimuladores, laser.
Botox Feminino R$ 1.350 | Masculino R$ 1.550. Entrada de R$ 100 para avaliação.
Dr. Augusto: entrada R$ 490 para confirmar. Cancelamento/remarcação com 12h de antecedência.
Horários: seg–sex 8h–18h, sáb 8h–12h.

## RECEITA CONTROLADA
Se o paciente pedir renovação ou troca de receita controlada, responda EXATAMENTE assim (adaptando ao contexto):
"Em relação às receitas de medicações controladas, conseguimos realizar a troca ou renovação apenas para pacientes que estejam com consulta ou retorno agendado dentro do prazo de acompanhamento médico solicitado pelo doutor.

Isso é necessário para garantir a segurança do tratamento e o acompanhamento adequado da evolução do paciente. ✨

Caso esteja dentro do prazo, poderia me informar qual seria a medicação e qual médico realizou a emissão da receita? 😊"

Se o paciente confirmar que está dentro do prazo → anote a medicação e o médico → ofereça agendar retorno se necessário.

## PACIENTE RECORRENTE
Se o PERFIL DO PACIENTE estiver presente no contexto, o paciente já é conhecido da clínica.
- Cumprimente pelo primeiro nome se souber: "Oi [nome]! Que saudade! 😊"
- Mencione naturalmente o histórico quando útil: "Sei que você já consultou com o Dr. Augusto, quer continuar com ele?"
- Nunca peça informações que já constam no perfil
- Se ele já tem consulta confirmada → confirme a data e pergunte o que precisa

## PACIENTE JÁ AGENDADO
Se o histórico mostrar consulta marcada e o paciente enviar nova mensagem:
- Pergunta sobre consulta existente → responda normalmente
- Quer marcar outra consulta → qualifique e agende
- Quer cancelar/remarcar → oriente

## FLUXO
1. Escute e qualifique (objetivo: emagrecer, estética, criança, etc.)
2. Sugira o médico mais adequado
3. Pergunte: particular ou convênio? (Marcus e Vanessa aceitam alguns)
4. Pergunte data e horário
5. Confirme: "✅ [Nome] | 👨‍⚕️ [Médico] | 📅 [Data/Hora] | 💰 [Valor] — confirma?"
6. Após confirmação explícita → action:"criar_agendamento"

## REGRAS
- Máximo 3–4 linhas por mensagem
- Não se identifique como IA
- Após 2 tentativas sem engajamento → action:"perdido"
- NUNCA invente horários disponíveis

## RESPOSTA (sempre JSON):
{"message":"texto","stage":"novo_lead|maria_ia|interesse_real|agendado|perdido","action":"none|criar_agendamento|perdido","medico_nome":"nome ou null","data_hora":"YYYY-MM-DDTHH:MM:00 ou null","nome_paciente":"nome ou null","notas_paciente":"observação importante para lembrar do paciente ou null","medico_preferido":"nome do médico preferido ou null"}`;

async function mariaRespond(lead: any, isNew: boolean): Promise<void> {
  // Só responde em horário comercial (7h–22h Brasília)
  if (!isBusinessHours()) {
    console.log(`Fora do horário comercial → ${lead.phone}`);
    return;
  }

  // Anti-race: não responde se enviou algo nos últimos 20s
  const { count: recentOut } = await db.from("pn_mensagens")
    .select("id", { count: "exact", head: true })
    .eq("lead_id", lead.id).eq("direction", "out")
    .gte("created_at", new Date(Date.now() - 20000).toISOString());
  if ((recentOut ?? 0) > 0) { console.log(`Cooldown → ${lead.phone}`); return; }

  if (isNew) {
    const firstMsg    = (lead.first_message || "").trim();
    const isGreeting  = firstMsg.length < 15 ||
      /^(oi+|ol[aá]|bom dia|boa tarde|boa noite|e a[ií]|tudo bem|al[oô]u?)[\s!?.]*$/i.test(firstMsg);

    if (isGreeting) {
      const saud = getSaudacao(lead.name);
      await setPresence(lead.phone, "composing");
      await sleep(typingDuration(saud.length));
      await setPresence(lead.phone, "paused");
      await safeSend(lead.id, lead.phone, saud, `saudacao_${lead.id}`);
      console.log(`Maria SAUDAÇÃO → ${lead.phone}`);
      return;
    }

    // Primeira mensagem com conteúdo real — onboarding inteligente via GPT
    const fromGoogle  = /google|anúncio|anuncio|propaganda|maps/i.test(firstMsg);
    const brNow   = new Date(Date.now() - 3 * 60 * 60 * 1000);
    const dateStr = brNow.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    const onboardNote = `\n\n## PRIMEIRO CONTATO — ONBOARDING
Novo paciente entrando em contato pela primeira vez.${fromGoogle ? "\n- ORIGEM: veio pelo Google. Agradeça gentilmente por ter encontrado a clínica." : ""}
- Apresente-se brevemente como Maria da Clínica ProNutro
- Reconheça e responda o que o paciente já informou (NÃO repita a pergunta que ele já respondeu)
- Faça apenas a próxima pergunta de qualificação necessária`;

    const sysContent = `${MARIA_SYSTEM}${onboardNote}\n\nHoje: ${dateStr}`;
    const gptRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_KEY}` },
      body: JSON.stringify({
        model: "gpt-4o",
        response_format: { type: "json_object" },
        messages: [{ role: "system", content: sysContent }, { role: "user", content: firstMsg }],
      }),
    });

    if (!gptRes.ok) {
      const saud = getSaudacao(lead.name);
      await setPresence(lead.phone, "composing");
      await sleep(typingDuration(saud.length));
      await setPresence(lead.phone, "paused");
      await safeSend(lead.id, lead.phone, saud, `saudacao_${lead.id}`);
      return;
    }

    const aiData = await gptRes.json();
    let parsed: any;
    try { parsed = JSON.parse(aiData.choices[0].message.content); } catch {
      const saud = getSaudacao(lead.name);
      await safeSend(lead.id, lead.phone, saud, `saudacao_${lead.id}`);
      return;
    }

    const { message, stage, action, medico_nome, data_hora, nome_paciente, notas_paciente, medico_preferido } = parsed;
    if (!message) return;

    await humanSend(lead.id, lead.phone, message, `saudacao_${lead.id}`, firstMsg.length);
    console.log(`Maria ONBOARD → ${lead.phone} fromGoogle=${fromGoogle}`);

    const onboardUpdates: any = { updated_at: new Date().toISOString() };
    if (stage && VALID_STAGES.includes(stage)) onboardUpdates.stage = stage;
    if (nome_paciente && !lead.name)            onboardUpdates.name = nome_paciente;
    if (notas_paciente)                         onboardUpdates.notas = notas_paciente;
    if (medico_preferido)                       onboardUpdates.medico_preferido = medico_preferido;
    if (fromGoogle)                             onboardUpdates.notas = `[Google] ${notas_paciente || ""}`.trim();
    await db.from("pn_leads").update(onboardUpdates).eq("id", lead.id);

    if (action === "criar_agendamento" && medico_nome && data_hora) {
      const last = medico_nome.split(" ").pop();
      const { data: med } = await db.from("pn_medicos").select("id").ilike("nome", `%${last}%`).maybeSingle();
      if (med) {
        await db.from("pn_agendamentos").insert({
          lead_id: lead.id, medico_id: med.id, data_hora,
          duracao_min: 30, status: "confirmado",
          created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        });
        await db.from("pn_leads").update({ stage: "agendado", medico_preferido: medico_nome, updated_at: new Date().toISOString() }).eq("id", lead.id);
      }
    }
    if (action === "perdido") {
      await db.from("pn_leads").update({ stage: "perdido", ai_mode: false, updated_at: new Date().toISOString() }).eq("id", lead.id);
    }
    return;
  }

  // Verifica se já respondemos à última mensagem
  const { data: lastIn } = await db.from("pn_mensagens")
    .select("id, body, created_at").eq("lead_id", lead.id).eq("direction", "in")
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!lastIn) return;

  const { count: outAfter } = await db.from("pn_mensagens")
    .select("id", { count: "exact", head: true })
    .eq("lead_id", lead.id).eq("direction", "out")
    .gt("created_at", lastIn.created_at);
  if ((outAfter ?? 0) > 0) { console.log(`Já respondeu → ${lead.phone}`); return; }

  // Histórico + contexto do paciente para GPT
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
  const sysContent = `${MARIA_SYSTEM}${patientCtx}\n\nHoje: ${dateStr}`;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({
      model: "gpt-4o",
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: sysContent }, ...history],
    }),
  });
  if (!res.ok) { console.error("GPT error", res.status); return; }

  const aiData = await res.json();
  let parsed: any;
  try { parsed = JSON.parse(aiData.choices[0].message.content); } catch { return; }

  const { message, stage, action, medico_nome, data_hora, nome_paciente, notas_paciente, medico_preferido } = parsed;
  if (!message) return;

  const lastMsgLen = (lastIn.body || "").length;
  const sent = await humanSend(lead.id, lead.phone, message, `reply_${lastIn.id}`, lastMsgLen);
  if (!sent) return;

  console.log(`Maria → ${lead.phone} | stage=${stage} action=${action}`);

  const updates: any = { updated_at: new Date().toISOString() };
  if (stage && VALID_STAGES.includes(stage) && !PROTECTED_STAGES.includes(lead.stage)) updates.stage = stage;
  if (nome_paciente && !lead.name)   updates.name = nome_paciente;
  if (notas_paciente)                updates.notas = notas_paciente;
  if (medico_preferido)              updates.medico_preferido = medico_preferido;
  await db.from("pn_leads").update(updates).eq("id", lead.id);

  if (action === "criar_agendamento" && medico_nome && data_hora) {
    const last = medico_nome.split(" ").pop();
    const { data: med } = await db.from("pn_medicos").select("id").ilike("nome", `%${last}%`).maybeSingle();
    if (med) {
      await db.from("pn_agendamentos").insert({
        lead_id: lead.id, medico_id: med.id, data_hora,
        duracao_min: 30, status: "confirmado",
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      });
      // Atualiza médico preferido e contador de consultas
      const { data: ldCur } = await db.from("pn_leads").select("total_consultas").eq("id", lead.id).single();
      await db.from("pn_leads").update({
        stage: "agendado",
        medico_preferido: medico_nome,
        total_consultas: ((ldCur?.total_consultas ?? 0) + 1),
        updated_at: new Date().toISOString(),
      }).eq("id", lead.id);
      console.log(`Agendamento criado → ${lead.phone} ${medico_nome} ${data_hora}`);
    }
  }
  if (action === "perdido") {
    await db.from("pn_leads").update({ stage: "perdido", ai_mode: false, updated_at: new Date().toISOString() }).eq("id", lead.id);
  }
}

// ── Poll principal ────────────────────────────────────────────────────────────

async function runPoll() {
  const { data: cfg } = await db.from("pn_config").select("value").eq("key", "maria_global_mode").maybeSingle();
  const mariaActive = cfg?.value === "true";

  const { data: state } = await db.from("pn_poll_state").select("last_message_timestamp").eq("id", 1).single();
  const lastTs: number = state?.last_message_timestamp ?? 0;
  const now = new Date().toISOString();

  const res = await fetch(`${UAZAPI_URL}/message/find`, {
    method: "POST",
    headers: { "Content-Type": "application/json", token: UAZAPI_TOKEN },
    body: JSON.stringify({ limit: 100, orderBy: "messageTimestamp", order: "DESC" }),
  });

  if (!res.ok) {
    await db.from("pn_poll_state").upsert({ id: 1, last_poll_at: now });
    return { error: `UAZAPI ${res.status}` };
  }

  const payload = await res.json();
  const all: any[] = payload.messages ?? [];

  // Recibos de imagem
  const imageMsgs = all.filter((m: any) => {
    const ts    = toMs(m.messageTimestamp);
    const isImg = m.messageType === "imageMessage" || m.type === "image" ||
                  (m.mimetype && m.mimetype.startsWith("image/"));
    return ts > lastTs && m.fromMe && !m.isGroup && isImg;
  });
  for (const m of imageMsgs) {
    await processReceiptImage(m).catch(e => console.error("receipt error", e));
  }

  // Mensagens novas de texto
  const newMsgs = all.filter((m: any) => {
    const ts = toMs(m.messageTimestamp);
    return ts > lastTs && !m.isGroup && m.chatid &&
      !m.chatid.startsWith(OWNER_JID + ":") &&
      (m.text || m.content?.text || m.body);
  });

  console.log(`pronutro-poll v13: lastTs=${lastTs} total=${all.length} new=${newMsgs.length}`);

  if (!newMsgs.length && !imageMsgs.length) {
    await db.from("pn_poll_state").upsert({ id: 1, last_poll_at: now });
    return { processed: 0 };
  }

  const byChat = new Map<string, any[]>();
  for (const m of newMsgs) {
    const arr = byChat.get(m.chatid) ?? [];
    arr.push(m);
    byChat.set(m.chatid, arr);
  }

  let maxTs = lastTs;
  let processed = 0;

  for (const [chatid, msgs] of byChat.entries()) {
    const phone = chatid.split("@")[0];
    if (!phone || phone === OWNER_JID) continue;

    const inboundMsgs  = msgs.filter((m: any) => !m.fromMe);
    const outboundMsgs = msgs.filter((m: any) => m.fromMe);
    if (!inboundMsgs.length) continue;

    const latestTs = Math.max(...msgs.map((m: any) => toMs(m.messageTimestamp)));
    if (latestTs > maxTs) maxTs = latestTs;

    const senderName = inboundMsgs[0]?.senderName ?? inboundMsgs[0]?.pushName ?? null;
    const firstBody  = inboundMsgs[0]?.text ?? inboundMsgs[0]?.content?.text ?? inboundMsgs[0]?.body ?? "";

    const { data: existingLead } = await db.from("pn_leads").select("*").eq("phone", phone).maybeSingle();
    const isNew = !existingLead;

    const upsertData: any = {
      phone,
      last_message_at: new Date(latestTs).toISOString(),
      updated_at: new Date().toISOString(),
    };
    if (senderName) upsertData.whatsapp_name = senderName;

    let lead: any;
    if (isNew) {
      upsertData.stage        = "novo_lead";
      upsertData.first_message = firstBody.slice(0, 500);
      upsertData.ai_mode      = mariaActive;
      upsertData.name         = senderName || null;
      const { data: newLead } = await db.from("pn_leads").insert(upsertData).select("*").single();
      lead = newLead;
    } else {
      await db.from("pn_leads").update(upsertData).eq("id", existingLead.id);
      lead = { ...existingLead, ...upsertData };
    }
    if (!lead) continue;

    // Detecção de intervenção humana
    if (outboundMsgs.length > 0 && lead.ai_mode) {
      const extIds = outboundMsgs.map((m: any) => m.messageid || m.id).filter(Boolean);
      if (extIds.length > 0) {
        const { data: inDb } = await db.from("pn_mensagens").select("external_id").in("external_id", extIds);
        const inDbSet = new Set((inDb || []).map((m: any) => m.external_id));
        const humanIntervened = outboundMsgs.some((m: any) => {
          const eid = m.messageid || m.id;
          return eid && !inDbSet.has(eid);
        });
        if (humanIntervened) {
          console.log(`Intervenção humana → desligando IA para ${phone}`);
          await db.from("pn_leads").update({ ai_mode: false, updated_at: new Date().toISOString() }).eq("id", lead.id);
          lead = { ...lead, ai_mode: false };
        }
      }
    }

    // Salva mensagens da secretaria
    for (const m of outboundMsgs) {
      const eid  = m.messageid || m.id;
      const body = m.text || m.content?.text || m.body || "";
      if (!eid || !body) continue;
      await db.from("pn_mensagens").upsert(
        { lead_id: lead.id, direction: "out", body, external_id: eid,
          sender_nome: "Secretaria", created_at: new Date(toMs(m.messageTimestamp)).toISOString() },
        { onConflict: "external_id", ignoreDuplicates: true }
      );
    }

    // Salva mensagens do paciente
    for (const m of inboundMsgs) {
      const body  = m.text || m.content?.text || m.body || "";
      if (!body) continue;
      const extId = m.messageid || m.id || null;
      await db.from("pn_mensagens").upsert(
        { lead_id: lead.id, direction: "in", body, external_id: extId,
          created_at: new Date(toMs(m.messageTimestamp)).toISOString() },
        { onConflict: "external_id", ignoreDuplicates: true }
      );
    }

    // Maria responde
    if (mariaActive && lead.ai_mode && !PROTECTED_STAGES.includes(lead.stage)) {
      await mariaRespond(lead, isNew);
    }
    processed++;
  }

  const maxToSave = Math.max(...all.map((m: any) => toMs(m.messageTimestamp)), lastTs);
  await db.from("pn_poll_state").upsert({ id: 1, last_poll_at: now, last_message_timestamp: maxToSave });

  // Follow-up proativo removido — risco de banimento UAZAPI

  return { processed, newMessages: newMsgs.length, receipts: imageMsgs.length };
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
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: cors });
  }
});
