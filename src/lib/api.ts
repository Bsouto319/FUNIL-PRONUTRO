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
    .select("*, responsavel:pn_usuarios(id, nome, role), medico:pn_medicos(id, nome)")
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
      body: JSON.stringify({ number: phone, text }),
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

// ── Agendamentos ──────────────────────────────────────────────────────────────

export async function fetchAgendamentos(from?: string, to?: string) {
  let q = supabase
    .from("pn_agendamentos")
    .select("*, medico:pn_medicos(id, nome), lead:pn_leads(id, name, phone)")
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
