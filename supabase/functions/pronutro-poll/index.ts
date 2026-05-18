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

const GREETING = `Olá! 😊 Seja muito bem-vindo(a) à ProNutro!\n\nEu sou a Maria, assistente virtual da clínica, e estou aqui para te ajudar da melhor forma possível. 💚\n\nSomos uma clínica especializada em saúde integral e qualidade de vida, com atendimentos em:\nNutrologia | Emagrecimento | Saúde mental | Saúde da mulher | Proctologia | Pediatria e Endocrinologia\n\nMe conta: qual o motivo do seu contato hoje?\n\nSe preferir, também posso encaminhar você para falar diretamente com nossa equipe, é só escrever pra mim. 😊`;

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
  // Anti-ban: mostra "digitando..." por 1-2s antes de enviar
  await setPresence(phone, "composing");
  await sleep(1000 + Math.floor(Math.random() * 1000));
  await sendWa(phone, text);
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
Tom: acolhedor, humano, empático e focado em conversão. Use emojis com moderação (como nas mensagens de exemplo).
Endereço: Ed. Centro Clínico Linea Vitta, Qd 616 SGA/SUL, Bloco C, Sala 223 — Asa Sul, Brasília.
Telefone: (61) 99954-8881 | Horários: seg–sex 8h–18h, sáb 8h–12h.

## ESTILO DE COMUNICAÇÃO
- Respostas humanizadas, nunca robóticas
- Use quebras de linha para organizar informações longas
- Ao apresentar um médico, use o formato rico com emojis (como exemplos abaixo)
- Pergunte como o paciente conheceu a clínica quando for um novo contato
- Nunca seja burocrática — qualifique naturalmente ao longo da conversa

## MÉDICOS E APRESENTAÇÕES

### Dr. Augusto Margon — R$ 980 (plano 60 dias) — Particular
Médico nutrólogo, intensivista e pós-graduado em Psiquiatria. Abordagem integrativa e humanizada.
Atende pacientes de todas as idades (desde 1 ano até idosos).
Atua em: emagrecimento saudável, ganho de peso, distúrbios alimentares, equilíbrio hormonal, ansiedade, insônia, compulsão alimentar, diabetes, hipertensão, medicina preventiva, nutrologia infantil, suporte oncológico.
Plano 60 dias inclui: consulta completa (1h), bioimpedância na consulta e no retorno, bioimpedância semanal, retorno após 40 dias, prescrições e plano alimentar.
Pagamento: Pix, dinheiro ou cartão em até 3x sem juros. Entrada de R$ 490 para confirmar.
Cancelamento/remarcação: 12h de antecedência.

### Dr. Celso Melo — R$ 650 — Particular
Médico nutrólogo e proctologista. Atendimento humanizado e individualizado.
Diferenciais: avaliação completa e personalizada, visão integrativa, acompanhamento próximo.
Atua em: Nutrologia e Cirurgia Proctológica.

### Dr. Marcus Gesteira — R$ 560 — Aceita alguns planos
Médico da Saúde da Família, especialista em emagrecimento, pós-graduado em Nutrologia.
Atua em: emagrecimento saudável, reeducação alimentar, compulsão alimentar, obesidade, diabetes, hipertensão, colesterol, deficiência de vitaminas, alterações hormonais.

### Dra. Vanessa Melo — R$ 560 — Aceita alguns planos (1 retorno incluído)
Pediatra com pós-graduação em Nutrologia. Atendimento acolhedor para crianças e adolescentes.
Atua em: introdução alimentar, seletividade alimentar, baixo peso/sobrepeso infantil, deficiência de vitaminas, imunidade, crescimento e desenvolvimento.

### Dra. Kelly Felippes — R$ 500 — Particular
Especialista em saúde feminina. Atua em: hormônios, fertilidade, menopausa, saúde da mulher.

### Gisele Falcão (Enfermeira Estética) — Avaliação R$ 250 (entrada R$ 100)
Especializada em rejuvenescimento facial e tratamentos corporais.
Atua com: Botox (Feminino R$ 1.350 | Masculino R$ 1.550), bioestimuladores de colágeno, preenchimentos, laser facial e corporal, skinbooster, enzimas emagrecedoras, estrias e flacidez.
A entrada de R$ 100 é abatida no valor da avaliação e pode ser abatida no tratamento caso fechado.

## FLUXO DE ATENDIMENTO
1. Receba a mensagem e identifique a necessidade do paciente
2. Pergunte como conheceu a clínica (se for primeiro contato)
3. Qualifique: objetivo (emagrecer, estética, saúde feminina, criança, etc.)
4. Sugira o médico mais adequado com a apresentação rica
5. Pergunte: particular ou convênio? (Marcus e Vanessa aceitam alguns planos)
6. Pergunte data e horário preferido
7. Confirme antes de agendar:
"✅ [Nome] | 👨‍⚕️ [Médico] | 📅 [Data/Hora] | 💰 [Valor] — confirma?"
8. Após confirmação explícita → action:"criar_agendamento"

Mensagem de confirmação após agendamento:
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
"Para receitas controladas, conseguimos renovar apenas para pacientes com consulta ou retorno agendado no prazo solicitado pelo médico. ✨ Está dentro do prazo? Me informe a medicação e o médico 😊"

## PACIENTE RECORRENTE
Se PERFIL DO PACIENTE estiver no contexto: cumprimente pelo nome ("Oi [nome]! Que saudade 😊"), use o histórico, nunca repita perguntas já respondidas.

## SE PERGUNTAREM SE É ROBÔ / IA
"Sou sim! Sou a Maria, assistente virtual da ProNutro 😊 Posso te ajudar com agendamentos e informações. Mas se preferir falar com a equipe, é só pedir!"

## REGRAS ABSOLUTAS
- NUNCA diga "não entendi" — sempre interprete e redirecione
- NUNCA invente horários disponíveis
- Só use action:"perdido" se paciente pedir humano explicitamente OU após 5+ mensagens sem interesse
- Sempre ofereça falar com humano se o paciente parecer insatisfeito

## RESPOSTA (sempre JSON):
{"message":"texto","stage":"novo_lead|maria_ia|interesse_real|agendado|perdido","action":"none|criar_agendamento|perdido","medico_nome":"nome ou null","data_hora":"YYYY-MM-DDTHH:MM:00 ou null","nome_paciente":"nome ou null","notas_paciente":"observação ou null","medico_preferido":"nome ou null"}`;

// ── Criar agendamento ─────────────────────────────────────────────────────────
async function criarAgendamento(leadId: string, medicoNome: string, dataHora: string): Promise<void> {
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
}

// ── Maria responde ────────────────────────────────────────────────────────────
async function mariaRespond(lead: any, isNew: boolean): Promise<void> {
  if (isNew) {
    const firstMsg   = (lead.first_message || "").trim();
    const isGreeting = !firstMsg || firstMsg.length < 15 ||
      /^(oi+|ol[aá]|bom dia|boa tarde|boa noite|e a[ií]|tudo bem|al[oô]u?)[\s!?.]*$/i.test(firstMsg);

    if (isGreeting) {
      await safeSend(lead.id, lead.phone, GREETING, `saudacao_${lead.id}`);
      console.log(`Maria SAUDAÇÃO → ${lead.phone}`);
      return;
    }

    // Primeiro contato com conteúdo real
    const fromGoogle = /google|anúncio|anuncio|propaganda|maps/i.test(firstMsg);
    const brNow      = new Date(Date.now() - 3 * 60 * 60 * 1000);
    const dateStr    = brNow.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    const onboardNote = `\n\n## PRIMEIRO CONTATO — ONBOARDING
Novo paciente, primeira mensagem.${fromGoogle ? "\n- ORIGEM: veio pelo Google." : ""}
- Apresente-se como Maria da Clínica ProNutro
- Responda o que o paciente já informou (NÃO repita perguntas já respondidas)
- Faça apenas a próxima pergunta necessária`;

    const gptRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_KEY}` },
      body: JSON.stringify({
        model: "gpt-4o",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: `${MARIA_SYSTEM}${onboardNote}\n\nHoje: ${dateStr}` },
          { role: "user", content: firstMsg },
        ],
      }),
    });

    if (!gptRes.ok) {
      await safeSend(lead.id, lead.phone, GREETING, `saudacao_${lead.id}`);
      return;
    }

    const aiData = await gptRes.json();
    let parsed: any;
    try { parsed = JSON.parse(aiData.choices[0].message.content); } catch {
      await safeSend(lead.id, lead.phone, GREETING, `saudacao_${lead.id}`);
      return;
    }

    if (!parsed.message) return;

    const sent = await safeSend(lead.id, lead.phone, parsed.message, `onboard_${lead.id}`);
    if (!sent) return;
    console.log(`Maria ONBOARD → ${lead.phone} fromGoogle=${fromGoogle}`);

    const upd: any = { updated_at: new Date().toISOString() };
    if (parsed.stage && VALID_STAGES.includes(parsed.stage)) upd.stage = parsed.stage;
    if (parsed.nome_paciente && !lead.name) upd.name = parsed.nome_paciente;
    if (parsed.notas_paciente)              upd.notas = fromGoogle ? `[Google] ${parsed.notas_paciente}`.trim() : parsed.notas_paciente;
    if (parsed.medico_preferido)            upd.medico_preferido = parsed.medico_preferido;
    await db.from("pn_leads").update(upd).eq("id", lead.id);

    if (parsed.action === "criar_agendamento" && parsed.medico_nome && parsed.data_hora) {
      await criarAgendamento(lead.id, parsed.medico_nome, parsed.data_hora);
    }
    if (parsed.action === "perdido") {
      await db.from("pn_leads").update({ stage: "perdido", ai_mode: false, updated_at: new Date().toISOString() }).eq("id", lead.id);
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
    console.error(`GPT error ${res.status} para ${lead.phone} — enviando fallback`);
    await safeSend(
      lead.id, lead.phone,
      "Olá! Recebi sua mensagem 😊 Nossa equipe responderá em breve. Qualquer dúvida, ligue: (61) 99954-8881",
      `fallback_${lastIn.id}`
    );
    return;
  }

  const aiData = await res.json();
  let parsed: any;
  try { parsed = JSON.parse(aiData.choices[0].message.content); } catch { return; }
  if (!parsed.message) return;

  const sent = await safeSend(lead.id, lead.phone, parsed.message, `reply_${lastIn.id}`);
  if (!sent) return;
  console.log(`Maria → ${lead.phone} | stage=${parsed.stage} action=${parsed.action}`);

  const upd: any = { updated_at: new Date().toISOString() };
  if (parsed.stage && VALID_STAGES.includes(parsed.stage) && !PROTECTED_STAGES.includes(lead.stage)) upd.stage = parsed.stage;
  if (parsed.nome_paciente && !lead.name) upd.name = parsed.nome_paciente;
  if (parsed.notas_paciente)              upd.notas = parsed.notas_paciente;
  if (parsed.medico_preferido)            upd.medico_preferido = parsed.medico_preferido;
  await db.from("pn_leads").update(upd).eq("id", lead.id);

  if (parsed.action === "criar_agendamento" && parsed.medico_nome && parsed.data_hora) {
    await criarAgendamento(lead.id, parsed.medico_nome, parsed.data_hora);
  }
  if (parsed.action === "perdido") {
    await db.from("pn_leads").update({ stage: "perdido", ai_mode: false, updated_at: new Date().toISOString() }).eq("id", lead.id);
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

    const newMsgs = all.filter((m: any) => {
      const ts = toMs(m.messageTimestamp);
      return ts > lastTs && !m.isGroup && m.chatid &&
        !m.chatid.startsWith(OWNER_JID + ":") &&
        (m.text || m.content?.text || m.body);
    });

    console.log(`pronutro-poll v20: lastTs=${lastTs} total=${all.length} new=${newMsgs.length} maria=${mariaActive}`);

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

    for (const [chatid, msgs] of byChat.entries()) {
      const phone = chatid.split("@")[0];
      if (!phone || phone === OWNER_JID) continue;

      const inboundMsgs  = msgs.filter((m: any) => !m.fromMe);
      const outboundMsgs = msgs.filter((m: any) => m.fromMe);
      if (!inboundMsgs.length) continue;

      const latestTs   = Math.max(...msgs.map((m: any) => toMs(m.messageTimestamp)));
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
        upsertData.stage         = "novo_lead";
        upsertData.first_message = firstBody.slice(0, 500);
        upsertData.ai_mode       = mariaActive;
        upsertData.name          = senderName || null;
        const { data: newLead } = await db.from("pn_leads").insert(upsertData).select("*").single();
        lead = newLead;
      } else {
        await db.from("pn_leads").update(upsertData).eq("id", existingLead.id);
        lead = { ...existingLead, ...upsertData };
      }
      if (!lead) continue;

      // Salva todas as mensagens
      for (const m of msgs) {
        const body = m.text || m.content?.text || m.body || "";
        const eid  = m.messageid || m.id;
        if (!body || !eid) continue;
        await db.from("pn_mensagens").upsert(
          { lead_id: lead.id, direction: m.fromMe ? "out" : "in", body, external_id: eid,
            sender_nome: m.fromMe ? "Secretaria" : null,
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

    return { processed, newMessages: newMsgs.length };
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
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: cors });
  }
});
