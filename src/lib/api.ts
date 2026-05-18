import { supabase } from "./supabase";

export const STAGES = [
  { key: "novo_lead",      label: "Novo Lead",       color: "bg-green-400/15 text-green-300",    headerBg: "#16a34a" },
  { key: "maria_ia",       label: "Maria IA",        color: "bg-sky-400/15 text-sky-300",        headerBg: "#0284c7" },
  { key: "interesse_real", label: "Interesse Real",  color: "bg-amber-400/15 text-amber-300",    headerBg: "#d97706" },
  { key: "agendado",       label: "Agendado",        color: "bg-emerald-400/15 text-emerald-300", headerBg: "#059669" },
  { key: "perdido",        label: "Perdido",         color: "bg-rose-400/15 text-rose-300",      headerBg: "#dc2626" },
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

export async function fetchLeads(search = "") {
  let q = supabase
    .from("pn_leads")
    .select("*, last_sender_nome, responsavel:pn_usuarios!assignee_id(id, nome, role)")
    .order("created_at", { ascending: false });
  if (search) q = q.or(`name.ilike.%${search}%,phone.ilike.%${search}%`);
  const { data, error } = await q;
  if (error) console.error("fetchLeads", error.message);
  return data || [];
}

export async function fetchStats() {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const [todayRes, mariaRes, agendRes, totalRes] = await Promise.all([
    supabase.from("pn_leads").select("id", { count: "exact" }).gte("created_at", today.toISOString()),
    supabase.from("pn_leads").select("id", { count: "exact" }).eq("stage", "maria_ia"),
    supabase.from("pn_leads").select("id", { count: "exact" }).eq("stage", "agendado"),
    supabase.from("pn_leads").select("id", { count: "exact" }),
  ]);
  return {
    hoje:     todayRes.count  || 0,
    maria:    mariaRes.count  || 0,
    agendados: agendRes.count || 0,
    total:    totalRes.count  || 0,
  };
}

export async function updateLeadStage(id: string, stage: string) {
  const { error } = await supabase
    .from("pn_leads")
    .update({ stage, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) console.error("updateLeadStage", error.message);
}

export async function updateLeadNotes(id: string, notes: string) {
  const { error } = await supabase
    .from("pn_leads")
    .update({ notes, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) console.error("updateLeadNotes", error.message);
}

export async function deleteLead(id: string) {
  const { error } = await supabase.from("pn_leads").delete().eq("id", id);
  if (error) console.error("deleteLead", error.message);
}

// ── Messages ──────────────────────────────────────────────────────────────────

export async function fetchMessages(leadId: string) {
  const { data, error } = await supabase
    .from("pn_mensagens")
    .select("*")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: true });
  if (error) console.error("fetchMessages", error.message);
  return data || [];
}

export async function sendMessage(leadId: string, phone: string, text: string, senderNome: string) {
  const baseUrl = import.meta.env.VITE_UAZAPI_URL as string;
  const token   = import.meta.env.VITE_UAZAPI_TOKEN as string;
  try {
    const res = await fetch(`${baseUrl}/send/text`, {
      method: "POST",
      headers: { "Content-Type": "application/json", token },
      body: JSON.stringify({ number: phone, text: senderNome ? `*${senderNome}:*\n${text}` : text }),
    });
    if (res.ok) {
      await supabase.from("pn_mensagens").insert({
        lead_id: leadId,
        body: text,
        direction: "out",
        sender_nome: senderNome,
        created_at: new Date().toISOString(),
      });
    }
    return res.ok;
  } catch (e) {
    console.error("sendMessage", e);
    return false;
  }
}

// ── Medicos ───────────────────────────────────────────────────────────────────

export async function fetchMedicos() {
  const { data, error } = await supabase.from("pn_medicos").select("*").eq("ativo", true).order("nome");
  if (error) console.error("fetchMedicos", error.message);
  return data || [];
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
  name: string; phone: string; stage?: string; ai_mode?: boolean; first_message?: string;
}): Promise<boolean> {
  const { error } = await supabase.from("pn_leads").insert({
    name: data.name,
    phone: data.phone.replace(/\D/g, ""),
    stage: data.stage || "novo_lead",
    ai_mode: data.ai_mode ?? false,
    first_message: data.first_message || null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  return !error;
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

export async function fetchAgendamentos(from?: string, to?: string) {
  let q = supabase
    .from("pn_agendamentos")
    .select("*, medico:pn_medicos(id, nome, especialidade, valor, aceita_convenio, cor), lead:pn_leads(id, name, whatsapp_name, phone)")
    .eq("status", "confirmado")
    .order("data_hora", { ascending: true });
  if (from) q = q.gte("data_hora", from);
  if (to)   q = q.lte("data_hora", to);
  const { data, error } = await q;
  if (error) console.error("fetchAgendamentos", error.message);
  return data || [];
}

export async function createAgendamento(payload: {
  lead_id: string;
  medico_id: string;
  data_hora: string;
  duracao_min?: number;
  tipo_consulta?: string;
  observacoes?: string;
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
      .not("stage", "in", '("agendado","perdido")');
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
  medico_id?: string;
  nome_paciente?: string;
  medico_nome?: string;
  valor: number;
  forma_pagamento?: string;
  bandeira?: string;
  parcelas?: number;
  data_pagamento?: string;
  observacoes?: string;
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
