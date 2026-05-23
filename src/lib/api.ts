import { supabase } from "./supabase";
import { setCache, getCache } from "./cache";

// kanban: true = aparece como coluna no Kanban | false = só no seletor de stage
export const STAGES = [
  { key: "em_atendimento", label: "Em Atendimento", color: "bg-sky-400/15 text-sky-300",         headerBg: "#0284c7", kanban: true  },
  { key: "aguardando",     label: "Aguardando",     color: "bg-pink-400/15 text-pink-300",       headerBg: "#be185d", kanban: true  },
  { key: "negociacao",     label: "🤝 Em Negociação", color: "bg-teal-400/15 text-teal-300",       headerBg: "#0d9488", kanban: true  },
  { key: "financeiro",     label: "Financeiro 💰",   color: "bg-yellow-400/15 text-yellow-300",   headerBg: "#ca8a04", kanban: true  },
  { key: "agendado",       label: "Agendado",       color: "bg-emerald-400/15 text-emerald-300", headerBg: "#059669", kanban: false },
  { key: "resolvido",      label: "Histórico",      color: "bg-indigo-400/15 text-indigo-300",   headerBg: "#4f46e5", kanban: false },
];

// ── Auth ─────────────────────────────────────────────────────────────────────

export async function signIn(email: string, password: string) {
  return supabase.auth.signInWithPassword({ email, password });
}

export async function signOut() {
  return supabase.auth.signOut();
}

export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export async function fetchCurrentUser() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  let { data } = await supabase.from("pn_usuarios").select("*").eq("id", user.id).maybeSingle();
  if (!data) {
    // Auto-create profile for first admin login
    const { data: created } = await supabase.from("pn_usuarios").insert({
      id: user.id,
      nome: user.email?.split("@")[0] || "Admin",
      email: user.email,
      role: "admin",
      ativo: true,
    }).select().single();
    data = created;
  }
  return data;
}

// ── Leads ─────────────────────────────────────────────────────────────────────

// Mapeia stages legados → stages atuais
const STAGE_MAP: Record<string, string> = {
  "interesse_real": "em_atendimento",
  "conversando":    "em_atendimento",
  "novo_lead":      "em_atendimento",
  "maria_ia":       "em_atendimento",
  "perdido":        "resolvido",
  "inativo":        "resolvido",
};

export async function fetchLeads(search = "") {
  const cacheKey = `leads_${search}`;
  let q = supabase
    .from("pn_leads")
    .select("*, last_sender_nome, responsavel:pn_usuarios!assignee_id(id, nome, role)")
    .order("created_at", { ascending: false });
  if (search) q = q.or(`name.ilike.%${search}%,phone.ilike.%${search}%`);
  const { data, error } = await q;
  if (error || !data) {
    console.warn("fetchLeads offline — usando cache");
    const cached = getCache<any[]>(cacheKey);
    return (cached || []).map((l: any) => ({ ...l, stage: STAGE_MAP[l.stage] ?? l.stage }));
  }
  const mapped = data.map((l: any) => ({ ...l, stage: STAGE_MAP[l.stage] ?? l.stage }));
  setCache(cacheKey, mapped);
  return mapped;
}

export async function fetchStats() {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const [todayRes, mariaRes, agendRes, totalRes] = await Promise.all([
    supabase.from("pn_leads").select("id", { count: "exact" }).gte("created_at", today.toISOString()),
    supabase.from("pn_leads").select("id", { count: "exact" }).eq("ai_mode", true).not("stage", "in", '("resolvido","perdido")'),
    supabase.from("pn_leads").select("id", { count: "exact" }).eq("stage", "agendado"),
    supabase.from("pn_leads").select("id", { count: "exact" }),
  ]);
  const stats = {
    hoje:      todayRes.count  || 0,
    maria:     mariaRes.count  || 0,
    agendados: agendRes.count  || 0,
    total:     totalRes.count  || 0,
  };
  if (stats.total > 0) setCache("stats", stats);
  return stats.total > 0 ? stats : (getCache<typeof stats>("stats") || stats);
}

export async function updateLeadStage(id: string, stage: string) {
  const { error } = await supabase
    .from("pn_leads")
    .update({ stage, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) console.error("updateLeadStage", error.message);
}

// ── Respostas Rápidas ─────────────────────────────────────────────────────────

export async function fetchQuickReplies() {
  const { data, error } = await supabase
    .from("pn_quick_replies")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) console.error("fetchQuickReplies", error.message);
  return data || [];
}

export async function createQuickReply(title: string, body: string) {
  const { error } = await supabase.from("pn_quick_replies").insert({ title, body });
  if (error) console.error("createQuickReply", error.message);
}

export async function deleteQuickReply(id: string) {
  const { error } = await supabase.from("pn_quick_replies").delete().eq("id", id);
  if (error) console.error("deleteQuickReply", error.message);
}

export async function updateLeadPendencia(id: string, value: boolean) {
  const { error } = await supabase
    .from("pn_leads")
    .update({ pendencia_financeira: value, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) console.error("updateLeadPendencia", error.message);
}

export async function updateLeadNotes(id: string, notes: string) {
  const { error } = await supabase
    .from("pn_leads")
    .update({ notes, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) console.error("updateLeadNotes", error.message);
}

export async function updateLeadProfile(id: string, data: {
  name?: string;
  email?: string;
  cpf?: string;
  data_nascimento?: string;
  sexo?: string;
  origem?: string;
  convenio?: string;
  endereco?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  cidade?: string;
  estado?: string;
  cep?: string;
  pagamento_status?: string;
  pagamento_valor?: number | null;
  pagamento_metodo?: string;
  pagamento_data?: string;
  pagamento_obs?: string;
  data_venda?: string | null;
  bandeira_cartao?: string | null;
  taxa_cartao?: number | null;
  taxas_diversas?: number | null;
  num_parcelas?: number | null;
}): Promise<boolean> {
  const { error } = await supabase
    .from("pn_leads")
    .update({ ...data, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) console.error("updateLeadProfile", error.message);
  return !error;
}

export async function deleteLead(id: string) {
  const { error } = await supabase.from("pn_leads").delete().eq("id", id);
  if (error) console.error("deleteLead", error.message);
}

// ── Messages ──────────────────────────────────────────────────────────────────

export async function fetchMessages(leadId: string) {
  const cacheKey = `messages_${leadId}`;
  const { data, error } = await supabase
    .from("pn_mensagens")
    .select("*")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: true });
  if (error || !data) {
    console.warn("fetchMessages offline — usando cache");
    return getCache<any[]>(cacheKey) || [];
  }
  setCache(cacheKey, data);
  return data;
}

export async function sendMessage(leadId: string, phone: string, text: string, senderNome: string) {
  try {
    const res = await fetch("https://pvphgusjofufwtyiyviu.supabase.co/functions/v1/pn-send-message", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": (import.meta.env.VITE_SUPABASE_ANON_KEY as string)?.trim(),
      },
      body: JSON.stringify({ lead_id: leadId, phone, text, sender_nome: senderNome }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    return data?.ok === true;
  } catch (e) {
    console.error("sendMessage", e);
    return false;
  }
}

// ── Medicos ───────────────────────────────────────────────────────────────────

export async function fetchMedicos() {
  const { data, error } = await supabase.from("pn_medicos").select("*").eq("ativo", true).order("nome");
  if (error || !data) {
    console.warn("fetchMedicos offline — usando cache");
    return getCache<any[]>("medicos") || [];
  }
  setCache("medicos", data);
  return data;
}

export async function upsertMedico(m: {
  id?: string; nome: string; especialidade: string; valor: number;
  aceita_convenio: boolean; cor: string;
}): Promise<boolean> {
  if (m.id) {
    const { error } = await supabase.from("pn_medicos")
      .update({ nome: m.nome, especialidade: m.especialidade, valor: m.valor, aceita_convenio: m.aceita_convenio, cor: m.cor })
      .eq("id", m.id);
    return !error;
  }
  const { error } = await supabase.from("pn_medicos")
    .insert({ nome: m.nome, especialidade: m.especialidade, valor: m.valor, aceita_convenio: m.aceita_convenio, cor: m.cor, ativo: true });
  return !error;
}

export async function desativarMedico(id: string): Promise<boolean> {
  const { error } = await supabase.from("pn_medicos").update({ ativo: false }).eq("id", id);
  return !error;
}

export async function createLead(data: {
  name: string;
  phone: string;
  stage?: string;
  ai_mode?: boolean;
  first_message?: string;
  email?: string;
  cpf?: string;
  data_nascimento?: string;
  sexo?: string;
  origem?: string;
  endereco?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  cidade?: string;
  estado?: string;
  cep?: string;
  convenio?: string;
}): Promise<boolean> {
  const { error } = await supabase.from("pn_leads").insert({
    name:            data.name,
    phone:           data.phone.replace(/\D/g, ""),
    stage:           data.stage || "novo_lead",
    ai_mode:         data.ai_mode ?? false,
    first_message:   data.first_message || null,
    email:           data.email || null,
    cpf:             data.cpf ? data.cpf.replace(/\D/g, "") : null,
    data_nascimento: data.data_nascimento || null,
    sexo:            data.sexo || null,
    origem:          data.origem || null,
    endereco:        data.endereco || null,
    numero:          data.numero || null,
    complemento:     data.complemento || null,
    bairro:          data.bairro || null,
    cidade:          data.cidade || null,
    estado:          data.estado || null,
    cep:             data.cep ? data.cep.replace(/\D/g, "") : null,
    convenio:        data.convenio || null,
    created_at:      new Date().toISOString(),
    updated_at:      new Date().toISOString(),
  });
  return !error;
}

export async function createLeadPresencial(data: {
  name: string; phone: string; cpf?: string; email?: string; convenio?: string; observacao?: string;
  origem?: string; data_nascimento?: string; sexo?: string;
  cep?: string; endereco?: string; numero?: string; complemento?: string;
  bairro?: string; cidade?: string; estado?: string;
  pagamento_status?: string; pagamento_valor?: number;
  pagamento_metodo?: string; pagamento_data?: string; pagamento_obs?: string;
}): Promise<any | null> {
  const { data: lead, error } = await supabase.from("pn_leads").insert({
    name:             data.name,
    phone:            data.phone.replace(/\D/g, ""),
    stage:            "agendado",
    ai_mode:          false,
    cpf:              data.cpf ? data.cpf.replace(/\D/g, "") : null,
    email:            data.email || null,
    convenio:         data.convenio || null,
    first_message:    data.observacao || null,
    origem:           data.origem || "presencial",
    data_nascimento:  data.data_nascimento || null,
    sexo:             data.sexo || null,
    cep:              data.cep || null,
    endereco:         data.endereco || null,
    numero:           data.numero || null,
    complemento:      data.complemento || null,
    bairro:           data.bairro || null,
    cidade:           data.cidade || null,
    estado:           data.estado || null,
    pagamento_status: data.pagamento_status || null,
    pagamento_valor:  data.pagamento_valor || null,
    pagamento_metodo: data.pagamento_metodo || null,
    pagamento_data:   data.pagamento_data || null,
    pagamento_obs:    data.pagamento_obs || null,
    created_at:       new Date().toISOString(),
    updated_at:       new Date().toISOString(),
  }).select().single();
  if (error) console.error("createLeadPresencial", error.message);
  return lead;
}

// ── Insights / Relatório ──────────────────────────────────────────────────────

export async function fetchLatestInsight() {
  const { data } = await supabase.from("pn_insights")
    .select("*").order("created_at", { ascending: false }).limit(1).maybeSingle();
  return data || null;
}

export async function generateInsight(): Promise<boolean> {
  const { error } = await supabase.functions.invoke("pronutro-insights", { method: "POST" });
  if (error) console.error("generateInsight", error);
  return !error;
}

export async function updateAgendamentoStatus(id: string, status: "confirmado" | "cancelado" | "no_show" | "realizado"): Promise<boolean> {
  const { error } = await supabase.from("pn_agendamentos").update({ status, updated_at: new Date().toISOString() }).eq("id", id);
  return !error;
}

// ── Agendamentos ──────────────────────────────────────────────────────────────

export async function fetchTodayAppointedLeadIds(): Promise<string[]> {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const todayStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const { data } = await supabase
    .from("pn_agendamentos")
    .select("lead_id")
    .gte("data_hora", `${todayStr}T00:00:00`)
    .lte("data_hora", `${todayStr}T23:59:59`)
    .neq("status", "cancelado");
  return (data || []).map((a: any) => a.lead_id as string);
}

export async function fetchAgendamentos(from?: string, to?: string) {
  const cacheKey = `agendamentos_${from || ""}_${to || ""}`;
  let q = supabase
    .from("pn_agendamentos")
    .select("*, medico:pn_medicos(id, nome, especialidade, valor, aceita_convenio, cor), lead:pn_leads(id, name, whatsapp_name, phone)")
    .order("data_hora", { ascending: true });
  if (from) q = q.gte("data_hora", from);
  if (to)   q = q.lte("data_hora", to);
  const { data, error } = await q;
  if (error || !data) {
    console.warn("fetchAgendamentos offline — usando cache");
    return getCache<any[]>(cacheKey) || [];
  }
  setCache(cacheKey, data);
  return data;
}

export async function createAgendamento(payload: {
  lead_id: string;
  medico_id: string;
  data_hora: string;
  duracao_min?: number;
  tipo_consulta?: string;
  observacoes?: string;
  indicacao?: string;
  tipo_procedimento?: string;
  valor_procedimento?: number | null;
}) {
  const { data, error } = await supabase.from("pn_agendamentos").insert({
    ...payload,
    duracao_min: payload.duracao_min || 30,
    status: "confirmado",
    created_at: new Date().toISOString(),
  }).select().single();
  if (error) console.error("createAgendamento", error.message);
  return data;
}

export async function cancelAgendamento(id: string) {
  const { error } = await supabase.from("pn_agendamentos").update({ status: "cancelado" }).eq("id", id);
  if (error) console.error("cancelAgendamento", error.message);
}

export type SmartCancelCandidate = {
  lead_id: string;
  lead_name: string;
  phone: string;
  reason: string;
  message_snippet: string;
  priority: number;
};

export async function checkSmartCancel(payload: {
  agendamento_id: string;
  data_hora: string;
  medico_id: string;
  medico_nome: string;
}): Promise<SmartCancelCandidate[]> {
  const { data, error } = await supabase.functions.invoke("pn-smart-cancel", { body: payload });
  if (error) { console.error("checkSmartCancel", error); return []; }
  return data?.candidates || [];
}

export async function updateAgendamento(id: string, updates: Record<string, any>) {
  const { error } = await supabase.from("pn_agendamentos").update({ ...updates, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) console.error("updateAgendamento", error.message);
}

export async function fetchSlotsDisponiveis(medicoId: string, data: string) {
  const d = new Date(data);
  const diaSemana = d.getDay();
  const { data: disp } = await supabase
    .from("pn_disponibilidade")
    .select("*")
    .eq("medico_id", medicoId)
    .eq("dia_semana", diaSemana)
    .eq("ativo", true)
    .maybeSingle();
  if (!disp) return [];

  const { data: agendados } = await supabase
    .from("pn_agendamentos")
    .select("data_hora, duracao_min")
    .eq("medico_id", medicoId)
    .eq("status", "confirmado")
    .gte("data_hora", `${data}T00:00:00`)
    .lte("data_hora", `${data}T23:59:59`);

  const occupied = new Set((agendados || []).map(a => a.data_hora.slice(11, 16)));
  const slots: string[] = [];
  const [startH, startM] = disp.hora_inicio.split(":").map(Number);
  const [endH, endM]     = disp.hora_fim.split(":").map(Number);
  let cur = startH * 60 + startM;
  const end = endH * 60 + endM;
  while (cur + 30 <= end) {
    const hh = String(Math.floor(cur / 60)).padStart(2, "0");
    const mm = String(cur % 60).padStart(2, "0");
    if (!occupied.has(`${hh}:${mm}`)) slots.push(`${hh}:${mm}`);
    cur += 30;
  }
  return slots;
}

export async function fetchDisponibilidade(medicoId: string) {
  const { data, error } = await supabase
    .from("pn_disponibilidade")
    .select("*")
    .eq("medico_id", medicoId)
    .order("dia_semana");
  if (error) console.error("fetchDisponibilidade", error.message);
  return data || [];
}

export async function upsertDisponibilidade(payload: {
  medico_id: string;
  dia_semana: number;
  hora_inicio: string;
  hora_fim: string;
  ativo: boolean;
}) {
  const { error } = await supabase
    .from("pn_disponibilidade")
    .upsert(payload, { onConflict: "medico_id,dia_semana" });
  if (error) console.error("upsertDisponibilidade", error.message);
  return !error;
}

// ── Maria Global Mode ─────────────────────────────────────────────────────────

export async function fetchMariaGlobalMode(): Promise<boolean> {
  const { data } = await supabase.from("pn_config").select("value").eq("key", "maria_global_mode").maybeSingle();
  return data?.value === "true";
}

export async function setMariaGlobalMode(active: boolean): Promise<void> {
  await supabase.from("pn_config").upsert({
    key: "maria_global_mode",
    value: active ? "true" : "false",
    updated_at: new Date().toISOString(),
  });
  if (active) {
    await supabase.from("pn_leads").update({ ai_mode: true, updated_at: new Date().toISOString() })
      .not("stage", "in", '("agendado","resolvido","perdido")');
  }
}

export async function updateLeadAiMode(id: string, aiMode: boolean) {
  const { error } = await supabase
    .from("pn_leads")
    .update({ ai_mode: aiMode, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) console.error("updateLeadAiMode", error.message);
}

// ── Usuarios ──────────────────────────────────────────────────────────────────

export async function fetchUsuarios() {
  const { data, error } = await supabase.from("pn_usuarios").select("*").order("nome");
  if (error) console.error("fetchUsuarios", error.message);
  return data || [];
}

export async function updateUsuario(id: string, fields: { nome?: string; role?: string }) {
  const { error } = await supabase
    .from("pn_usuarios")
    .update(fields)
    .eq("id", id);
  if (error) console.error("updateUsuario", error.message);
  return !error;
}

// ── Chat da Equipe ────────────────────────────────────────────────────────────

export async function fetchChatMessages(userId1: string, userId2: string) {
  const { data, error } = await supabase.from("pn_chat_mensagens")
    .select("*")
    .or(`and(remetente_id.eq.${userId1},destinatario_id.eq.${userId2}),and(remetente_id.eq.${userId2},destinatario_id.eq.${userId1})`)
    .order("created_at", { ascending: true })
    .limit(100);
  if (error) console.error("fetchChatMessages", error.message);
  return data || [];
}

export async function sendChatMessage(remetente_id: string, destinatario_id: string, body: string) {
  const { error } = await supabase.from("pn_chat_mensagens").insert({ remetente_id, destinatario_id, body });
  if (error) console.error("sendChatMessage", error.message);
  return !error;
}

export async function marcarMensagensLidas(destinatario_id: string, remetente_id: string) {
  await supabase.from("pn_chat_mensagens")
    .update({ lida: true })
    .eq("destinatario_id", destinatario_id)
    .eq("remetente_id", remetente_id)
    .eq("lida", false);
}

export async function fetchUnreadCounts(destinatario_id: string): Promise<Record<string, number>> {
  const { data } = await supabase.from("pn_chat_mensagens")
    .select("remetente_id")
    .eq("destinatario_id", destinatario_id)
    .eq("lida", false);
  const counts: Record<string, number> = {};
  (data || []).forEach((m: any) => { counts[m.remetente_id] = (counts[m.remetente_id] || 0) + 1; });
  return counts;
}

// ── Bancos ────────────────────────────────────────────────────────────────────

export async function fetchBancos() {
  const { data, error } = await supabase.from("pn_bancos").select("*").eq("ativo", true).order("nome");
  if (error || !data) {
    console.warn("fetchBancos offline — usando cache");
    return getCache<any[]>("bancos") || [];
  }
  setCache("bancos", data);
  return data;
}

export async function insertBanco(nome: string, tipo: string, chave_pix?: string) {
  const { data, error } = await supabase.from("pn_bancos").insert({ nome, tipo, chave_pix: chave_pix || null }).select().single();
  if (error) console.error("insertBanco", error.message);
  return data;
}

export async function deleteBanco(id: string) {
  const { error } = await supabase.from("pn_bancos").update({ ativo: false }).eq("id", id);
  if (error) console.error("deleteBanco", error.message);
}

// ── Financeiro ────────────────────────────────────────────────────────────────

export async function fetchFinanceiro({ from, to, medicoId, forma, semData }: {
  from?: string; to?: string; medicoId?: string; forma?: string; semData?: boolean;
}) {
  let q = supabase
    .from("pn_financeiro")
    .select("*")
    .order("data_pagamento", { ascending: false });

  if (semData) {
    q = q.or("data_pagamento.is.null,data_pagamento.lte.1971-01-01");
  } else {
    if (from) q = q.gte("data_pagamento", from);
    if (to)   q = q.lte("data_pagamento", to);
  }

  if (medicoId) q = q.eq("medico_id", medicoId);
  if (forma)    q = q.eq("forma_pagamento", forma);

  const { data, error } = await q;
  if (error) console.error("fetchFinanceiro", error.message);
  return data || [];
}

export async function insertFinanceiro(payload: {
  lead_id?: string;
  medico_id?: string;
  nome_paciente?: string;
  medico_nome?: string;
  valor: number;
  forma_pagamento?: string;
  bandeira?: string;
  parcelas?: number;
  data_pagamento?: string;
  observacoes?: string;
  banco_id?: string;
  taxa_cartao?: number | null;
  taxas_diversas?: number | null;
}) {
  const { data, error } = await supabase.from("pn_financeiro").insert({
    ...payload,
    parcelas: payload.parcelas || 1,
    data_pagamento: payload.data_pagamento || new Date().toISOString(),
    registrado_por: "manual",
  }).select().single();
  if (error) console.error("insertFinanceiro", error.message);
  return data;
}

export async function deleteFinanceiro(id: string) {
  const { error } = await supabase.from("pn_financeiro").delete().eq("id", id);
  if (error) console.error("deleteFinanceiro", error.message);
}

export async function updateFinanceiro(id: string, payload: Record<string, any>) {
  const { error } = await supabase.from("pn_financeiro").update(payload).eq("id", id);
  if (error) console.error("updateFinanceiro", error.message);
  return !error;
}

export async function bulkInsertFinanceiro(rows: object[]) {
  const { error } = await supabase.from("pn_financeiro").insert(rows);
  if (error) console.error("bulkInsertFinanceiro", error.message);
  return !error;
}

// ── Notas Fiscais ─────────────────────────────────────────────────────────────

export async function fetchNotasFiscais(params: { leadId?: string; nomePaciente?: string }) {
  let q = supabase.from("pn_notas_fiscais").select("*").order("created_at", { ascending: false });
  if (params.leadId) q = q.eq("lead_id", params.leadId);
  else if (params.nomePaciente) q = q.ilike("nome_paciente", `%${params.nomePaciente}%`);
  const { data, error } = await q;
  if (error) console.error("fetchNotasFiscais", error.message);
  return data || [];
}

export async function uploadNotaFiscal(params: {
  file: File;
  leadId?: string;
  medicoId?: string;
  nomePaciente?: string;
  numeroNf?: string;
  dataEmissao?: string;
  valor?: number;
  observacoes?: string;
  uploadedBy?: string;
}) {
  const ext  = params.file.name.split(".").pop() || "pdf";
  const path = `${params.leadId || "avulso"}/${Date.now()}.${ext}`;
  const { error: upErr } = await supabase.storage
    .from("notas-fiscais")
    .upload(path, params.file, { contentType: params.file.type || "application/pdf" });
  if (upErr) { console.error("uploadNotaFiscal storage", upErr.message); return null; }

  const { data, error } = await supabase.from("pn_notas_fiscais").insert({
    lead_id:       params.leadId      || undefined,
    medico_id:     params.medicoId    || undefined,
    nome_paciente: params.nomePaciente || undefined,
    numero_nf:     params.numeroNf    || undefined,
    data_emissao:  params.dataEmissao || undefined,
    valor:         params.valor       || undefined,
    observacoes:   params.observacoes || undefined,
    file_name:     params.file.name,
    file_path:     path,
    mime_type:     params.file.type   || "application/pdf",
    file_size:     params.file.size,
    uploaded_by:   params.uploadedBy  || undefined,
  }).select().single();
  if (error) console.error("uploadNotaFiscal insert", error.message);
  return data;
}

export async function getNotaFiscalUrl(filePath: string): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from("notas-fiscais")
    .createSignedUrl(filePath, 600);
  if (error) { console.error("getNotaFiscalUrl", error.message); return null; }
  return data.signedUrl;
}

export async function deleteNotaFiscal(id: string, filePath: string) {
  await supabase.storage.from("notas-fiscais").remove([filePath]);
  const { error } = await supabase.from("pn_notas_fiscais").delete().eq("id", id);
  if (error) console.error("deleteNotaFiscal", error.message);
}

export async function fetchPacientesFinanceiro(): Promise<string[]> {
  const { data, error } = await supabase
    .from("pn_financeiro")
    .select("nome_paciente")
    .not("nome_paciente", "is", null)
    .neq("nome_paciente", "");
  if (error) console.error("fetchPacientesFinanceiro", error.message);
  const nomes = [...new Set((data || []).map((r: any) => r.nome_paciente as string))];
  return nomes.sort((a, b) => a.localeCompare(b, "pt-BR"));
}

// ── Import de Agendamentos via Excel ─────────────────────────────────────────

export type ImportRow = {
  nome:      string;
  telefone:  string;
  medico:    string;
  data:      string;
  hora:      string;
  tipo:      string;
  valor:     number | null;
  pagamento: string;
  parcelas:  number;
  obs:       string;
};

export type ImportResult = ImportRow & {
  status:   "vinculado" | "novo_lead" | "sem_lead" | "erro";
  msg:      string;
  leadId:   string | null;
  medicoId: string | null;
};

function normPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length <= 9) return digits;
  if (digits.startsWith("55") && digits.length >= 12) return digits;
  if (digits.startsWith("0")) return "55" + digits.slice(1);
  return "55" + digits;
}

function nameSim(a: string, b: string): number {
  const clean = (s: string) =>
    s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
  const ta = clean(a).split(/\s+/).filter(Boolean);
  const tb = clean(b).split(/\s+/).filter(Boolean);
  if (!ta.length || !tb.length) return 0;
  const matches = ta.filter(w => tb.some(w2 => w2.startsWith(w) || w.startsWith(w2)));
  return matches.length / Math.max(ta.length, tb.length);
}

function parseDataHora(data: string, hora: string): string | null {
  let d: Date | null = null;
  // DD/MM/YYYY ou DD-MM-YYYY
  const m = data.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) d = new Date(+m[3], +m[2] - 1, +m[1]);
  // YYYY-MM-DD
  const m2 = data.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m2) d = new Date(+m2[1], +m2[2] - 1, +m2[3]);
  if (!d || isNaN(d.getTime())) return null;

  const hm = hora.match(/^(\d{1,2}):(\d{2})$/);
  if (!hm) return null;
  d.setHours(+hm[1], +hm[2], 0, 0);
  return d.toISOString();
}

export async function importAgendamentosExcel(
  rows: ImportRow[]
): Promise<ImportResult[]> {
  const { data: allLeads }  = await supabase.from("pn_leads").select("id, phone, name, whatsapp_name");
  const { data: allMedicos } = await supabase.from("pn_medicos").select("id, nome").eq("ativo", true);
  const leads  = allLeads  || [];
  const medicos = allMedicos || [];
  const results: ImportResult[] = [];

  for (const row of rows) {
    // Resolve médico
    const medicoKey = row.medico.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    const medico = medicos.find(m =>
      m.nome.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").includes(medicoKey)
    );
    if (!medico) {
      results.push({ ...row, status: "erro", msg: `Médico "${row.medico}" não encontrado`, leadId: null, medicoId: null });
      continue;
    }

    // Resolve data/hora
    const dataHora = parseDataHora(row.data, row.hora);
    if (!dataHora) {
      results.push({ ...row, status: "erro", msg: `Data/hora inválida: ${row.data} ${row.hora}`, leadId: null, medicoId: medico.id });
      continue;
    }

    // Resolve lead
    const phone = row.telefone ? normPhone(row.telefone) : null;
    let lead = phone ? leads.find(l => l.phone === phone) : null;
    if (!lead && row.nome) {
      lead = leads.find(l =>
        nameSim(l.name || l.whatsapp_name || "", row.nome) >= 0.45
      ) || null;
    }

    let leadId = lead?.id || null;
    let status: ImportResult["status"] = lead ? "vinculado" : "sem_lead";

    if (!leadId && (row.nome || phone)) {
      const { data: nl } = await supabase.from("pn_leads").insert({
        phone:         phone || `sem_tel_${Date.now()}`,
        name:          row.nome || null,
        stage:         "agendado",
        ai_mode:       false,
        first_message: "Importado via Excel",
        created_at:    new Date().toISOString(),
        updated_at:    new Date().toISOString(),
      }).select("id").single();
      leadId = nl?.id || null;
      status = "novo_lead";
    }

    // Insere agendamento
    const { error: agErr } = await supabase.from("pn_agendamentos").insert({
      lead_id:           leadId,
      medico_id:         medico.id,
      data_hora:         dataHora,
      duracao_min:       60,
      status:            "confirmado",
      tipo_consulta:     row.tipo     || null,
      nome_paciente:     row.nome     || null,
      telefone_paciente: phone        || null,
      observacoes:       row.obs      || null,
      importado_em:      new Date().toISOString(),
      created_at:        new Date().toISOString(),
    });
    if (agErr) {
      results.push({ ...row, status: "erro", msg: agErr.message, leadId, medicoId: medico.id });
      continue;
    }

    // Insere financeiro se tiver valor
    if (row.valor && row.valor > 0) {
      await supabase.from("pn_financeiro").insert({
        lead_id:        leadId,
        medico_id:      medico.id,
        nome_paciente:  row.nome     || null,
        medico_nome:    medico.nome,
        valor:          row.valor,
        forma_pagamento: row.pagamento || null,
        parcelas:       row.parcelas || 1,
        data_pagamento: dataHora,
        registrado_por: "excel_import",
        created_at:     new Date().toISOString(),
      });
    }

    const msg = lead
      ? `Vinculado a ${lead.name || lead.whatsapp_name || lead.phone}`
      : leadId
      ? "Novo lead criado"
      : "Agendamento sem lead";
    results.push({ ...row, status, msg, leadId, medicoId: medico.id });
  }

  return results;
}

// ── Vincula financeiro → leads (re-executa match) ─────────────────────────────
export async function vincularFinanceiroLeads(): Promise<number> {
  const { data: fins }  = await supabase.from("pn_financeiro").select("id, nome_paciente").is("lead_id", null);
  const { data: leads } = await supabase.from("pn_leads").select("id, name, whatsapp_name");
  if (!fins?.length || !leads?.length) return 0;
  let linked = 0;
  for (const f of fins) {
    if (!f.nome_paciente) continue;
    const match = leads.find(l => nameSim(l.name || l.whatsapp_name || "", f.nome_paciente) >= 0.45);
    if (!match) continue;
    await supabase.from("pn_financeiro").update({ lead_id: match.id }).eq("id", f.id);
    linked++;
  }
  return linked;
}

export async function fetchAgendamentosPendentes() {
  const now     = new Date().toISOString();
  const past14d = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("pn_agendamentos")
    .select("id, data_hora, status, tipo_consulta, nome_paciente, telefone_paciente, medico:pn_medicos(nome, valor), lead:pn_leads(id, name, phone)")
    .in("status", ["confirmado", "realizado"])
    .lte("data_hora", now)
    .gte("data_hora", past14d)
    .order("data_hora", { ascending: false });
  if (error) console.error("fetchAgendamentosPendentes", error.message);
  return data || [];
}

export function exportLeadsCSV(leads: any[]) {
  const headers = ["Nome", "Telefone", "Stage", "Médico", "Resumo IA", "Entrada"];
  const rows = leads.map(l => [
    l.name || "",
    l.phone,
    STAGES.find(s => s.key === l.stage)?.label || l.stage,
    l.medico?.nome || "",
    (l.summary || "").replace(/,/g, " "),
    new Date(l.created_at).toLocaleString("pt-BR"),
  ]);
  const csv  = [headers, ...rows].map(r => r.join(",")).join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url;
  a.download = `pronutro-leads-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── WhatsApp direto (sem leadId) ─────────────────────────────────────────────

export async function sendDirectWhatsApp(phone: string, text: string): Promise<boolean> {
  const baseUrl = import.meta.env.VITE_UAZAPI_URL as string;
  const token   = import.meta.env.VITE_UAZAPI_TOKEN as string;
  try {
    const res = await fetch(`${baseUrl}/send/text`, {
      method: "POST",
      headers: { "Content-Type": "application/json", token },
      body: JSON.stringify({ number: phone, text }),
    });
    return res.ok;
  } catch { return false; }
}

async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export async function sendMediaWhatsApp(phone: string, file: File): Promise<boolean> {
  const baseUrl = import.meta.env.VITE_UAZAPI_URL as string;
  const token   = import.meta.env.VITE_UAZAPI_TOKEN as string;
  try {
    const base64   = await blobToBase64(file);
    const isImage  = file.type.startsWith("image/");
    const isVideo  = file.type.startsWith("video/");
    const endpoint = isImage ? "/send/image" : isVideo ? "/send/video" : "/send/document";
    const body     = isImage
      ? { number: phone, image: base64, caption: file.name }
      : isVideo
      ? { number: phone, video: base64, caption: file.name }
      : { number: phone, document: base64, fileName: file.name };
    const res = await fetch(`${baseUrl}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", token },
      body: JSON.stringify(body),
    });
    return res.ok;
  } catch { return false; }
}

export async function sendPttWhatsApp(phone: string, blob: Blob): Promise<boolean> {
  const baseUrl = import.meta.env.VITE_UAZAPI_URL as string;
  const token   = import.meta.env.VITE_UAZAPI_TOKEN as string;
  try {
    const base64 = await blobToBase64(blob);
    const res = await fetch(`${baseUrl}/send/ptt`, {
      method: "POST",
      headers: { "Content-Type": "application/json", token },
      body: JSON.stringify({ number: phone, audio: base64 }),
    });
    return res.ok;
  } catch { return false; }
}

// ── Prontuários ───────────────────────────────────────────────────────────────

export async function fetchProntuarios(leadId?: string) {
  let q = supabase
    .from("pn_prontuarios")
    .select("*, medico:pn_medicos(id, nome, especialidade)")
    .order("data_consulta", { ascending: false });
  if (leadId) q = q.eq("lead_id", leadId);
  const { data, error } = await q;
  if (error) console.error("fetchProntuarios", error.message);
  return data || [];
}

export async function upsertProntuario(p: {
  id?: string; lead_id?: string; medico_id?: string;
  nome_paciente?: string; telefone_paciente?: string;
  data_consulta: string; queixa_principal?: string;
  historia_clinica?: string; exame_fisico?: string;
  diagnostico?: string; plano_tratamento?: string; observacoes?: string;
}): Promise<{ id: string } | null> {
  if (p.id) {
    const { data, error } = await supabase.from("pn_prontuarios")
      .update({ ...p, updated_at: new Date().toISOString() })
      .eq("id", p.id).select("id").single();
    if (error) { console.error("upsertProntuario", error.message); return null; }
    return data;
  }
  const { data, error } = await supabase.from("pn_prontuarios")
    .insert(p).select("id").single();
  if (error) { console.error("upsertProntuario", error.message); return null; }
  return data;
}

export async function fetchDocumentos(prontuarioId: string) {
  const { data, error } = await supabase.from("pn_documentos")
    .select("*").eq("prontuario_id", prontuarioId)
    .order("created_at", { ascending: false });
  if (error) console.error("fetchDocumentos", error.message);
  return data || [];
}

export async function insertDocumento(d: {
  prontuario_id: string; lead_id?: string; medico_id?: string;
  nome_paciente?: string; medico_nome?: string;
  tipo: "receita" | "atestado" | "encaminhamento";
  conteudo: string; cid?: string; dias_afastamento?: number;
}): Promise<{ id: string } | null> {
  const { data, error } = await supabase.from("pn_documentos")
    .insert(d).select("id").single();
  if (error) { console.error("insertDocumento", error.message); return null; }
  return data;
}

export async function marcarDocumentoEnviado(id: string, phone: string) {
  await supabase.from("pn_documentos").update({
    enviado_whatsapp: true, phone_enviado: phone, enviado_em: new Date().toISOString(),
  }).eq("id", id);
}

// ── Estoque ───────────────────────────────────────────────────────────────────

export async function fetchEstoque() {
  const { data, error } = await supabase.from("pn_estoque").select("*").eq("ativo", true).order("nome");
  if (error) console.error("fetchEstoque", error.message);
  return data || [];
}

export async function upsertEstoque(item: {
  id?: string; nome: string; categoria: string; unidade: string;
  estoque_atual: number; estoque_min: number; valor_unitario: number;
}): Promise<boolean> {
  if (item.id) {
    const { error } = await supabase.from("pn_estoque")
      .update({ nome: item.nome, categoria: item.categoria, unidade: item.unidade,
        estoque_atual: item.estoque_atual, estoque_min: item.estoque_min,
        valor_unitario: item.valor_unitario, updated_at: new Date().toISOString() })
      .eq("id", item.id);
    if (error) console.error("upsertEstoque", error.message);
    return !error;
  }
  const { error } = await supabase.from("pn_estoque").insert({
    nome: item.nome, categoria: item.categoria, unidade: item.unidade,
    estoque_atual: item.estoque_atual, estoque_min: item.estoque_min,
    valor_unitario: item.valor_unitario, ativo: true,
  });
  if (error) console.error("upsertEstoque", error.message);
  return !error;
}

export async function desativarEstoque(id: string): Promise<boolean> {
  const { error } = await supabase.from("pn_estoque").update({ ativo: false }).eq("id", id);
  if (error) console.error("desativarEstoque", error.message);
  return !error;
}

export async function fetchEstoqueMovimentos(estoqueId?: string, limitN = 50) {
  let q = supabase.from("pn_estoque_movimentos")
    .select("*, item:pn_estoque(nome, unidade)")
    .order("created_at", { ascending: false })
    .limit(limitN);
  if (estoqueId) q = q.eq("estoque_id", estoqueId);
  const { data, error } = await q;
  if (error) console.error("fetchEstoqueMovimentos", error.message);
  return data || [];
}

export async function insertEstoqueMovimento(payload: {
  estoque_id: string;
  tipo: "entrada" | "saida" | "ajuste" | "consumo";
  quantidade: number;
  valor_unit?: number;
  obs?: string;
  agendamento_id?: string;
}): Promise<boolean> {
  const { error: mvErr } = await supabase.from("pn_estoque_movimentos").insert({
    estoque_id:     payload.estoque_id,
    tipo:           payload.tipo,
    quantidade:     payload.quantidade,
    valor_unit:     payload.valor_unit   || null,
    obs:            payload.obs          || null,
    agendamento_id: payload.agendamento_id || null,
  });
  if (mvErr) { console.error("insertEstoqueMovimento", mvErr.message); return false; }

  // Atualiza estoque_atual
  const { data: item } = await supabase.from("pn_estoque").select("estoque_atual").eq("id", payload.estoque_id).single();
  if (item) {
    let novoEstoque: number;
    if (payload.tipo === "ajuste") {
      novoEstoque = payload.quantidade;
    } else if (payload.tipo === "entrada") {
      novoEstoque = (item.estoque_atual || 0) + payload.quantidade;
    } else {
      novoEstoque = Math.max(0, (item.estoque_atual || 0) - payload.quantidade);
    }
    await supabase.from("pn_estoque").update({ estoque_atual: novoEstoque, updated_at: new Date().toISOString() }).eq("id", payload.estoque_id);
  }
  return true;
}
