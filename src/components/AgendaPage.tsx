import { useEffect, useState, useRef } from "react";
import { fetchAgendamentos, fetchMedicos, fetchBancos, cancelAgendamento, updateAgendamento, insertFinanceiro, fetchLeads, createAgendamento, checkSmartCancel, type SmartCancelCandidate } from "../lib/api";
import { supabase } from "../lib/supabase";
import { ChevronLeft, ChevronRight, X, Clock, CheckCircle2, XCircle, RefreshCw, Zap, DollarSign, ExternalLink, Stethoscope, AlertCircle, Plus } from "lucide-react";

const FALLBACK_COLORS = ["#7c3aed","#0284c7","#059669","#d97706","#dc2626","#0891b2","#db2777","#0d9488"];
const MONTHS_PT = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
const DAYS_PT_MINI = ["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"];
const FORMAS = ["PIX","Dinheiro","Cartão Débito","Cartão Crédito","Convênio","Transferência"];
const TIPOS = [
  { key: "consulta", label: "Consulta", color: "#0284c7" },
  { key: "retorno",  label: "Retorno",  color: "#7c3aed" },
  { key: "encaixe",  label: "Encaixe",  color: "#d97706" },
];

const SLOT_H = 56;       // px per 30min slot
const DAY_START = 7;     // 07:00
const DAY_END   = 20;    // 20:00
const TOTAL_SLOTS = (DAY_END - DAY_START) * 2;

function localStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function formatBRL(v: number | null) {
  if (!v) return "—";
  return new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(v);
}
function hex(color: string, a: number) {
  if (!color || color.length < 6) return `rgba(100,100,100,${a})`;
  const r=parseInt(color.slice(1,3),16), g=parseInt(color.slice(3,5),16), b=parseInt(color.slice(5,7),16);
  return `rgba(${r},${g},${b},${a})`;
}
function timeToSlot(iso: string): number {
  const h = parseInt(iso.slice(11,13)), m = parseInt(iso.slice(14,16));
  return (h - DAY_START) * 2 + Math.floor(m / 30);
}
function slotToLabel(slot: number): string {
  const totalMin = DAY_START * 60 + slot * 30;
  const hh = Math.floor(totalMin / 60);
  const mm = totalMin % 60;
  return `${String(hh).padStart(2,"0")}:${String(mm).padStart(2,"0")}`;
}

const STATUS_META: Record<string,{label:string;icon:any;color:string}> = {
  confirmado: { label:"Confirmado", icon:Clock,        color:"#f59e0b" },
  realizado:  { label:"Realizado",  icon:CheckCircle2, color:"#10b981" },
  cancelado:  { label:"Cancelado",  icon:XCircle,      color:"#ef4444" },
};

export default function AgendaPage({
  onSelectLead,
  currentUser,
}: {
  onSelectLead?: (lead: any) => void;
  currentUser?: any;
}) {
  const today    = new Date();
  const todayStr = localStr(today);

  const [selectedDay, setSelectedDay] = useState(todayStr);
  const [calYear,  setCalYear]   = useState(today.getFullYear());
  const [calMonth, setCalMonth]  = useState(today.getMonth());
  const [agendamentos, setAgendamentos] = useState<any[]>([]);
  const [medicos,  setMedicos]  = useState<any[]>([]);
  const [bancos,   setBancos]   = useState<any[]>([]);
  const [medicoFiltro, setMedicoFiltro] = useState("");
  const [expandedId, setExpandedId]     = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [editTipo,  setEditTipo]  = useState<Record<string,string>>({});
  const [editValor, setEditValor] = useState<Record<string,string>>({});
  const [editForma, setEditForma] = useState<Record<string,string>>({});
  const [editBanco, setEditBanco] = useState<Record<string,string>>({});
  const [editObs,   setEditObs]   = useState<Record<string,string>>({});
  const [saving,    setSaving]    = useState<string | null>(null);

  const [smartCancelLoading, setSmartCancelLoading] = useState<string | null>(null);
  const [smartCancelModal, setSmartCancelModal] = useState<{
    appt: any;
    candidates: SmartCancelCandidate[];
  } | null>(null);

  const gridRef = useRef<HTMLDivElement>(null);

  // New appointment mini-modal
  const [newAppt, setNewAppt] = useState<{ medicoId: string; medicoNome: string; dataHora: string } | null>(null);
  const [apptSearch,  setApptSearch]  = useState("");
  const [apptLeads,   setApptLeads]   = useState<any[]>([]);
  const [apptLead,    setApptLead]    = useState<any | null>(null);
  const [apptDuracao,    setApptDuracao]    = useState("30");
  const [apptIndicacao,  setApptIndicacao]  = useState("");
  const [apptTipo,       setApptTipo]       = useState("");
  const [apptValor,      setApptValor]      = useState("");
  const [apptSaving,     setApptSaving]     = useState(false);
  const apptSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function load() {
    setLoading(true);
    const year  = parseInt(selectedDay.slice(0,4));
    const month = parseInt(selectedDay.slice(5,7)) - 1;
    // Load 3 months window to avoid re-fetching on small navigation
    const from = `${year}-${String(month).padStart(2,"0")}-01T00:00:00`;
    const to   = `${year}-${String(month+2).padStart(2,"0")}-28T23:59:59`;
    const [ag, med, ban] = await Promise.all([fetchAgendamentos(from, to), fetchMedicos(), fetchBancos()]);
    setAgendamentos(ag);
    setMedicos(med);
    setBancos(ban);
    const tipos: Record<string,string> = {};
    const obs:   Record<string,string> = {};
    ag.forEach((a:any) => { tipos[a.id] = a.tipo_consulta || "consulta"; obs[a.id] = a.observacoes || ""; });
    setEditTipo(tipos);
    setEditObs(obs);
    setLoading(false);
  }

  useEffect(() => { load(); }, [selectedDay.slice(0,7)]);

  useEffect(() => {
    const ch = supabase
      .channel("pn_agendamentos_rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "pn_agendamentos" }, () => load())
      .subscribe();
    const interval = setInterval(() => load(), 30000);
    return () => { supabase.removeChannel(ch); clearInterval(interval); };
  }, [selectedDay.slice(0,7)]);

  // Auto-filter medico if role is medico
  useEffect(() => {
    if (currentUser?.role === "medico" && medicos.length > 0) {
      const me = medicos.find((m: any) => m.user_id === currentUser.id);
      if (me) setMedicoFiltro(me.id);
    }
  }, [medicos, currentUser]);

  const medicoColorMap: Record<string,string> = {};
  medicos.forEach((m,i) => { medicoColorMap[m.id] = m.cor || FALLBACK_COLORS[i % FALLBACK_COLORS.length]; });

  const isMedico = currentUser?.role === "medico";

  // Doctors to show as columns
  const visibleMedicos = medicoFiltro
    ? medicos.filter(m => m.id === medicoFiltro)
    : medicos;

  // Day appointments (all statuses)
  const dayAgAll = agendamentos.filter(a => a.data_hora.slice(0,10) === selectedDay);
  const dayAg = medicoFiltro ? dayAgAll.filter(a => a.medico_id === medicoFiltro) : dayAgAll;

  // Calendar month data
  const firstDay    = new Date(calYear, calMonth, 1);
  const lastDay     = new Date(calYear, calMonth+1, 0);
  const startOffset = firstDay.getDay();
  const calDays: (number|null)[] = [];
  for (let i = 0; i < startOffset; i++) calDays.push(null);
  for (let d = 1; d <= lastDay.getDate(); d++) calDays.push(d);

  function prevDay() {
    const d = new Date(selectedDay + "T12:00:00"); d.setDate(d.getDate() - 1);
    const s = localStr(d); setSelectedDay(s);
    setCalYear(d.getFullYear()); setCalMonth(d.getMonth());
  }
  function nextDay() {
    const d = new Date(selectedDay + "T12:00:00"); d.setDate(d.getDate() + 1);
    const s = localStr(d); setSelectedDay(s);
    setCalYear(d.getFullYear()); setCalMonth(d.getMonth());
  }
  function goToday() {
    setSelectedDay(todayStr);
    setCalYear(today.getFullYear()); setCalMonth(today.getMonth());
  }

  async function handleCancel(appt: any) {
    setSmartCancelLoading(appt.id);
    const candidates = await checkSmartCancel({
      agendamento_id: appt.id,
      data_hora: appt.data_hora,
      medico_id: appt.medico_id,
      medico_nome: appt.medico?.nome || "",
    });
    setSmartCancelLoading(null);

    if (candidates.length > 0) {
      setSmartCancelModal({ appt, candidates });
    } else {
      setSaving(appt.id);
      await cancelAgendamento(appt.id);
      setExpandedId(null);
      await load();
      setSaving(null);
    }
  }

  async function confirmCancel() {
    if (!smartCancelModal) return;
    setSaving(smartCancelModal.appt.id);
    await cancelAgendamento(smartCancelModal.appt.id);
    setSmartCancelModal(null);
    setExpandedId(null);
    await load();
    setSaving(null);
  }
  async function handleRealizado(a: any) {
    setSaving(a.id);
    await updateAgendamento(a.id, { status:"realizado", tipo_consulta: editTipo[a.id]||"consulta", observacoes: editObs[a.id]||undefined });
    const valorStr = editValor[a.id];
    if (valorStr) {
      await insertFinanceiro({
        lead_id: a.lead_id, medico_id: a.medico_id,
        nome_paciente: a.lead?.name||a.lead?.whatsapp_name||"",
        medico_nome: a.medico?.nome||"",
        valor: parseFloat(valorStr.replace(",",".")),
        forma_pagamento: editForma[a.id]||"PIX",
        banco_id: editBanco[a.id]||undefined,
        data_pagamento: new Date().toISOString(),
      });
    }
    setExpandedId(null);
    await load();
    setSaving(null);
  }
  async function handleRegistrarPagamento(a: any) {
    const valorStr = editValor[a.id];
    if (!valorStr) return;
    setSaving(a.id + "_pay");
    await insertFinanceiro({
      lead_id: a.lead_id, medico_id: a.medico_id,
      nome_paciente: a.lead?.name||a.lead?.whatsapp_name||"",
      medico_nome: a.medico?.nome||"",
      valor: parseFloat(valorStr.replace(",",".")),
      forma_pagamento: editForma[a.id]||"PIX",
      banco_id: editBanco[a.id]||undefined,
      data_pagamento: new Date().toISOString(),
    });
    setEditValor(p => ({...p,[a.id]:""}));
    setSaving(null);
  }

  async function handleCreateAppt() {
    if (!newAppt || !apptLead) return;
    setApptSaving(true);
    await createAgendamento({
      lead_id:          apptLead.id,
      medico_id:        newAppt.medicoId,
      data_hora:        newAppt.dataHora,
      duracao_min:      parseInt(apptDuracao),
      indicacao:        apptIndicacao || undefined,
      tipo_procedimento: apptTipo || undefined,
      valor_procedimento: apptValor ? parseFloat(apptValor.replace(",", ".")) : undefined,
    });
    setApptSaving(false);
    setNewAppt(null);
    setApptIndicacao(""); setApptTipo(""); setApptValor("");
    load();
  }

  function openNewAppt(medicoId: string, medicoNome: string, slot: number) {
    const slotLabel = slotToLabel(slot);
    const dataHora  = `${selectedDay}T${slotLabel}:00`;
    setNewAppt({ medicoId, medicoNome, dataHora });
    setApptSearch(""); setApptLeads([]); setApptLead(null); setApptDuracao("30");
  }

  function handleApptSearchChange(text: string) {
    setApptSearch(text);
    setApptLead(null);
    if (apptSearchTimer.current) clearTimeout(apptSearchTimer.current);
    if (text.trim().length >= 2) {
      apptSearchTimer.current = setTimeout(() => fetchLeads(text).then(setApptLeads), 250);
    } else {
      setApptLeads([]);
    }
  }

  const selectedDateObj = new Date(selectedDay + "T12:00:00");
  const dayLabel = selectedDateObj.toLocaleDateString("pt-BR", { weekday:"long", day:"numeric", month:"long" });

  return (
    <div className="h-full flex flex-col overflow-hidden" style={{ background:"linear-gradient(160deg,#0a1628 0%,#0f2240 35%,#071830 100%)" }}>

      {/* Top bar */}
      <div className="flex-shrink-0 px-4 py-3 border-b border-white/8 flex items-center gap-3 flex-wrap" style={{ background:"rgba(255,255,255,0.02)" }}>
        {/* Date navigation */}
        <div className="flex items-center gap-1.5">
          <button onClick={prevDay} className="p-1.5 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 transition">
            <ChevronLeft size={14} className="text-white/60" />
          </button>
          <div className="min-w-[200px] text-center">
            <p className="text-white font-black text-sm capitalize leading-tight">{dayLabel}</p>
            {selectedDay === todayStr && <p className="text-emerald-400 text-[9px] font-black uppercase tracking-wider">Hoje</p>}
          </div>
          <button onClick={nextDay} className="p-1.5 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 transition">
            <ChevronRight size={14} className="text-white/60" />
          </button>
          <button onClick={goToday}
            className="ml-1 text-[10px] text-emerald-400 hover:text-emerald-300 font-black px-2 py-1 rounded-lg hover:bg-emerald-500/10 transition">
            Hoje
          </button>
        </div>

        {/* Doctor tabs */}
        {!isMedico && (
          <div className="flex items-center gap-1 flex-wrap">
            <button onClick={() => setMedicoFiltro("")}
              className={`text-[10px] font-black px-2.5 py-1 rounded-full border transition ${!medicoFiltro ? "bg-white/15 border-white/25 text-white" : "border-white/8 text-white/35 hover:text-white/60"}`}>
              Todos
            </button>
            {medicos.map(m => {
              const color = medicoColorMap[m.id];
              const active = medicoFiltro === m.id;
              return (
                <button key={m.id} onClick={() => setMedicoFiltro(f => f === m.id ? "" : m.id)}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border transition text-[10px] font-black"
                  style={{ borderColor:active?color:`${color}40`, background:active?hex(color,0.2):hex(color,0.06), color:active?"#fff":`${color}cc` }}>
                  <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor:color }} />
                  {m.nome.replace(/^(Dr\.|Dra\.) /,"").split(" ")[0]}
                </button>
              );
            })}
          </div>
        )}

        {/* Stats pill */}
        <div className="ml-auto flex items-center gap-2">
          <span className="text-white/25 text-xs">
            {dayAg.filter(a => a.status !== "cancelado").length} consulta{dayAg.filter(a => a.status !== "cancelado").length !== 1 ? "s" : ""}
          </span>
          {dayAg.filter(a => a.status === "realizado").length > 0 && (
            <span className="text-emerald-400/70 text-[10px] font-bold">
              {dayAg.filter(a => a.status === "realizado").length} realizada{dayAg.filter(a => a.status === "realizado").length !== 1 ? "s" : ""}
            </span>
          )}
        </div>
      </div>

      {/* Main layout */}
      <div className="flex-1 min-h-0 flex gap-0">

        {/* Time-slot grid */}
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
          {/* Doctor column headers */}
          <div className="flex-shrink-0 flex border-b border-white/8" style={{ background:"rgba(255,255,255,0.02)" }}>
            <div className="w-14 shrink-0 border-r border-white/8" />
            {visibleMedicos.length === 0 ? (
              <div className="flex-1 px-4 py-2 text-white/20 text-xs">Nenhum médico cadastrado</div>
            ) : visibleMedicos.map(m => {
              const color = medicoColorMap[m.id];
              const count = dayAg.filter(a => a.medico_id === m.id && a.status !== "cancelado").length;
              return (
                <div key={m.id} className="flex-1 min-w-[160px] px-3 py-2 border-r border-white/5 flex items-center justify-between"
                  style={{ borderBottom: `2px solid ${color}` }}>
                  <div>
                    <p className="font-black text-xs leading-tight" style={{ color }}>{m.nome.replace(/^(Dr\.|Dra\.) /,"")}</p>
                    <p className="text-white/30 text-[9px] mt-0.5">{m.especialidade || "—"}</p>
                  </div>
                  {count > 0 && (
                    <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full" style={{ background: hex(color, 0.2), color }}>
                      {count}
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          {/* Scrollable time grid */}
          <div ref={gridRef} className="flex-1 overflow-y-auto overflow-x-auto [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-white/10 [&::-webkit-scrollbar-thumb]:rounded-full">
            {loading ? (
              <div className="flex items-center justify-center h-40 text-white/20 text-sm">Carregando...</div>
            ) : (
              <div className="flex" style={{ minHeight: TOTAL_SLOTS * SLOT_H }}>
                {/* Time axis */}
                <div className="w-14 shrink-0 relative border-r border-white/8">
                  {Array.from({ length: TOTAL_SLOTS }, (_, i) => (
                    <div key={i} className="absolute w-full flex items-start justify-end pr-2"
                      style={{ top: i * SLOT_H, height: SLOT_H }}>
                      {i % 2 === 0 && (
                        <span className="text-[9px] font-black text-white/20 -translate-y-1">{slotToLabel(i)}</span>
                      )}
                    </div>
                  ))}
                </div>

                {/* Doctor columns */}
                {visibleMedicos.length === 0 ? (
                  <div className="flex-1 flex items-center justify-center text-white/15 text-sm">
                    <div className="text-center">
                      <Stethoscope size={32} className="mx-auto mb-2 opacity-30" />
                      <p>Cadastre médicos no painel Admin</p>
                    </div>
                  </div>
                ) : visibleMedicos.map(m => {
                  const color    = medicoColorMap[m.id];
                  const medAg    = dayAg.filter(a => a.medico_id === m.id);
                  return (
                    <div key={m.id} className="flex-1 min-w-[160px] relative border-r border-white/5"
                      style={{ background: hex(color, 0.02) }}>
                      {/* Horizontal slot lines */}
                      {Array.from({ length: TOTAL_SLOTS }, (_, i) => (
                        <div key={i} className="absolute w-full border-t"
                          style={{ top: i * SLOT_H, borderColor: i % 2 === 0 ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.02)" }} />
                      ))}

                      {/* Clickable empty slot areas (z-1, behind appointments at z-10) */}
                      {Array.from({ length: TOTAL_SLOTS }, (_, i) => (
                        <div key={`c${i}`}
                          className="absolute w-full group z-[1] cursor-pointer"
                          style={{ top: i * SLOT_H, height: SLOT_H }}
                          onClick={() => openNewAppt(m.id, m.nome, i)}>
                          <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                            style={{ background: hex(color, 0.08) }}>
                            <Plus size={12} style={{ color: `${color}90` }} />
                          </div>
                        </div>
                      ))}

                      {/* Appointments */}
                      {medAg.map(a => {
                        const slot      = timeToSlot(a.data_hora);
                        if (slot < 0 || slot >= TOTAL_SLOTS) return null;
                        const dur       = a.duracao_min || 30;
                        const heightSlots = Math.max(1, dur / 30);
                        const topPx     = slot * SLOT_H + 2;
                        const heightPx  = heightSlots * SLOT_H - 4;
                        const nome      = (a.lead?.name || a.lead?.whatsapp_name || "Paciente").split(" ")[0];
                        const isCancelled  = a.status === "cancelado";
                        const isRealizado  = a.status === "realizado";
                        const isExp        = expandedId === a.id;
                        const tipoAtual    = editTipo[a.id] || "consulta";
                        const tipoMeta     = TIPOS.find(t => t.key === tipoAtual) || TIPOS[0];
                        const statusM      = STATUS_META[a.status] || STATUS_META.confirmado;
                        const StatusIcon   = statusM.icon;
                        const borderColor  = isCancelled ? "#ef444460" : isRealizado ? "#10b981" : color;
                        const bgColor      = isCancelled ? "rgba(239,68,68,0.08)" : isRealizado ? "rgba(16,185,129,0.1)" : hex(color, 0.18);

                        return (
                          <div key={a.id}
                            className="absolute left-1 right-1 rounded-lg overflow-hidden cursor-pointer transition-all select-none z-10"
                            style={{ top: topPx, height: isExp ? "auto" : heightPx, minHeight: heightPx,
                              background: bgColor, border: `1.5px solid ${borderColor}`, opacity: isCancelled ? 0.5 : 1 }}
                            onClick={() => !isCancelled && setExpandedId(isExp ? null : a.id)}>

                            <div className="px-2 py-1.5">
                              <div className="flex items-center justify-between gap-1 mb-0.5">
                                <span className="font-black text-[10px] leading-none" style={{ color: isCancelled?"#ef4444":isRealizado?"#10b981":color }}>
                                  {a.data_hora.slice(11,16)}
                                </span>
                                <StatusIcon size={9} style={{ color: statusM.color }} className="shrink-0" />
                              </div>
                              <p className="text-white font-black text-xs leading-tight truncate">{nome}</p>
                              {heightPx >= 56 && (
                                <span className="text-[8px] font-bold mt-0.5 block" style={{ color: tipoMeta.color }}>{tipoMeta.label}</span>
                              )}
                            </div>

                            {/* Expanded panel */}
                            {isExp && (
                              <div className="border-t px-3 py-3 space-y-3" style={{ borderColor: `${color}30` }}>
                                {/* Full name + phone */}
                                <div>
                                  <p className="text-white font-black text-sm">{a.lead?.name||a.lead?.whatsapp_name||"Paciente"}</p>
                                  {a.lead?.phone && <p className="text-white/30 text-[10px] font-mono">+{a.lead.phone}</p>}
                                  {a.medico?.especialidade && <p className="text-[10px] mt-0.5" style={{ color }}>{a.medico.especialidade}</p>}
                                  {a.indicacao && <p className="text-white/45 text-[10px] mt-0.5">📣 Indicação: {a.indicacao}</p>}
                                  {a.tipo_procedimento && <p className="text-white/45 text-[10px]">🔬 {a.tipo_procedimento}{a.valor_procedimento ? ` — ${formatBRL(a.valor_procedimento)}` : ""}</p>}
                                </div>

                                {/* Tipo */}
                                <div>
                                  <p className="text-white/30 text-[9px] font-black uppercase mb-1.5">Tipo</p>
                                  <div className="flex gap-1.5">
                                    {TIPOS.map(t => (
                                      <button key={t.key}
                                        onClick={e => { e.stopPropagation(); updateAgendamento(a.id,{tipo_consulta:t.key}); setEditTipo(p=>({...p,[a.id]:t.key})); }}
                                        className="flex-1 py-1.5 rounded-lg text-[9px] font-black transition"
                                        style={{ background: tipoAtual===t.key?hex(t.color,0.25):"rgba(255,255,255,0.05)",
                                          color: tipoAtual===t.key?t.color:"rgba(255,255,255,0.35)",
                                          border: `1.5px solid ${tipoAtual===t.key?t.color+"80":"rgba(255,255,255,0.08)"}` }}>
                                        {t.label}
                                      </button>
                                    ))}
                                  </div>
                                </div>

                                {/* Payment */}
                                {!isRealizado && (
                                  <div onClick={e => e.stopPropagation()}>
                                    <p className="text-white/30 text-[9px] font-black uppercase mb-1.5">Pagamento</p>
                                    <div className="flex gap-1.5 mb-1.5">
                                      <div className="relative flex-1">
                                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-white/30 text-xs font-bold">R$</span>
                                        <input value={editValor[a.id]||""} onChange={e=>setEditValor(p=>({...p,[a.id]:e.target.value}))}
                                          placeholder="0,00" onClick={e=>e.stopPropagation()}
                                          className="w-full pl-7 pr-2 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white text-xs placeholder-white/20 focus:outline-none" />
                                      </div>
                                      <select value={editForma[a.id]||"PIX"} onChange={e=>setEditForma(p=>({...p,[a.id]:e.target.value}))} onClick={e=>e.stopPropagation()}
                                        className="px-1.5 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white text-xs focus:outline-none">
                                        {FORMAS.map(f=><option key={f} value={f}>{f}</option>)}
                                      </select>
                                    </div>
                                    {bancos.length > 0 && (
                                      <select value={editBanco[a.id]||""} onChange={e=>setEditBanco(p=>({...p,[a.id]:e.target.value}))} onClick={e=>e.stopPropagation()}
                                        className="w-full px-2 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white text-xs focus:outline-none mb-1.5">
                                        <option value="">— Banco (opcional) —</option>
                                        {bancos.map(b=><option key={b.id} value={b.id}>{b.nome}</option>)}
                                      </select>
                                    )}
                                    <button onClick={e=>{e.stopPropagation();handleRegistrarPagamento(a);}}
                                      disabled={!editValor[a.id]||saving===a.id+"_pay"}
                                      className="w-full flex items-center justify-center gap-1 py-1.5 rounded-lg text-[9px] font-black disabled:opacity-40"
                                      style={{ background:"rgba(16,185,129,0.15)",color:"#10b981",border:"1.5px solid rgba(16,185,129,0.3)" }}>
                                      <DollarSign size={10}/>
                                      {saving===a.id+"_pay"?"Registrando...":"Registrar Pagamento"}
                                    </button>
                                  </div>
                                )}

                                {/* Obs */}
                                <textarea value={editObs[a.id]||""} onChange={e=>setEditObs(p=>({...p,[a.id]:e.target.value}))} onClick={e=>e.stopPropagation()}
                                  onBlur={()=>updateAgendamento(a.id,{observacoes:editObs[a.id]||null})}
                                  placeholder="Observações..." rows={2}
                                  className="w-full px-2 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white text-xs placeholder-white/20 focus:outline-none resize-none" />

                                {/* Actions */}
                                <div className="grid grid-cols-2 gap-1.5" onClick={e=>e.stopPropagation()}>
                                  {!isRealizado && !isCancelled && (
                                    <button onClick={e=>{e.stopPropagation();handleRealizado(a);}} disabled={saving===a.id}
                                      className="flex items-center justify-center gap-1 py-2 rounded-lg text-[9px] font-black"
                                      style={{ background:"rgba(16,185,129,0.2)",color:"#10b981",border:"1.5px solid rgba(16,185,129,0.4)" }}>
                                      <CheckCircle2 size={11}/>{saving===a.id?"...":"Realizado"}
                                    </button>
                                  )}
                                  {onSelectLead && a.lead && (
                                    <button onClick={e=>{e.stopPropagation();onSelectLead(a.lead);}}
                                      className="flex items-center justify-center gap-1 py-2 rounded-lg text-[9px] font-black"
                                      style={{ background:"rgba(255,255,255,0.06)",color:"rgba(255,255,255,0.6)",border:"1.5px solid rgba(255,255,255,0.1)" }}>
                                      <ExternalLink size={10}/>Ficha
                                    </button>
                                  )}
                                  {!isCancelled && (
                                    <button onClick={e=>{e.stopPropagation();handleCancel(a);}}
                                      disabled={saving===a.id || smartCancelLoading===a.id}
                                      className="col-span-2 flex items-center justify-center gap-1 py-2 rounded-lg text-[9px] font-black"
                                      style={{ background:"rgba(239,68,68,0.08)",color:"rgba(239,68,68,0.6)",border:"1.5px solid rgba(239,68,68,0.2)" }}>
                                      <AlertCircle size={10}/>
                                      {smartCancelLoading===a.id ? "Verificando vagas..." : "Cancelar Consulta"}
                                    </button>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}

                      {/* Empty state */}
                      {medAg.filter(a => a.status !== "cancelado").length === 0 && (
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                          <p className="text-[9px] font-bold" style={{ color: hex(color, 0.3) }}>sem consultas</p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* New appointment mini-modal */}
        {newAppt && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ background:"rgba(0,0,10,0.75)", backdropFilter:"blur(6px)" }}
            onClick={e => { if (e.target === e.currentTarget) setNewAppt(null); }}>
            <div className="w-full max-w-sm rounded-2xl border border-white/10 overflow-hidden"
              style={{ background:"rgba(10,18,48,0.98)" }}>

              {/* Header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-white/8">
                <div className="flex items-center gap-2">
                  <Plus size={14} className="text-emerald-400" />
                  <p className="text-white font-black text-sm">Novo Agendamento</p>
                </div>
                <button onClick={() => setNewAppt(null)} className="p-1.5 rounded-lg hover:bg-white/10 text-white/40 transition">
                  <X size={15}/>
                </button>
              </div>

              {/* Info row */}
              <div className="px-4 pt-3 pb-2 flex items-center gap-3">
                <div className="text-center shrink-0">
                  <p className="text-white font-black text-2xl leading-none">{newAppt.dataHora.slice(11,16)}</p>
                  <p className="text-white/30 text-[10px] mt-0.5">
                    {new Date(newAppt.dataHora.slice(0,10)+"T12:00:00").toLocaleDateString("pt-BR",{weekday:"short",day:"2-digit",month:"short"})}
                  </p>
                </div>
                <div className="w-px h-10 bg-white/10 shrink-0"/>
                <div className="min-w-0">
                  <p className="text-white/80 text-xs font-bold truncate">{newAppt.medicoNome}</p>
                  <p className="text-white/30 text-[10px]">Médico / Nutricionista</p>
                </div>
              </div>

              <div className="px-4 pb-4 space-y-3">
                {/* Patient search */}
                <div className="space-y-1.5">
                  <p className="text-white/40 text-[10px] font-bold uppercase">Paciente</p>
                  {apptLead ? (
                    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30">
                      <div className="w-6 h-6 rounded-full bg-emerald-500/30 flex items-center justify-center text-emerald-300 font-black text-[10px] shrink-0">
                        {(apptLead.name || "?")[0].toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-emerald-300 text-xs font-bold truncate">{apptLead.name || apptLead.whatsapp_name}</p>
                        {apptLead.phone && <p className="text-emerald-400/40 text-[10px] font-mono">+{apptLead.phone}</p>}
                      </div>
                      <button onClick={() => { setApptLead(null); setApptSearch(""); setApptLeads([]); }}
                        className="text-emerald-400/50 hover:text-emerald-300 transition shrink-0">
                        <X size={12}/>
                      </button>
                    </div>
                  ) : (
                    <div className="relative">
                      <input
                        value={apptSearch}
                        onChange={e => handleApptSearchChange(e.target.value)}
                        placeholder="Digite o nome do paciente..."
                        autoFocus
                        className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-xs placeholder-white/25 focus:outline-none focus:ring-1 focus:ring-emerald-500/40"
                      />
                      {apptLeads.length > 0 && (
                        <div className="absolute top-full left-0 right-0 mt-1 rounded-xl border border-white/10 overflow-hidden z-10 shadow-xl"
                          style={{ background:"rgba(10,18,60,0.98)" }}>
                          {apptLeads.slice(0, 6).map(l => (
                            <button key={l.id}
                              onClick={() => { setApptLead(l); setApptSearch(l.name || l.whatsapp_name || ""); setApptLeads([]); }}
                              className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-white/10 transition text-left border-b border-white/5 last:border-0">
                              <div className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center text-white/60 font-black text-[10px] shrink-0">
                                {(l.name || "?")[0].toUpperCase()}
                              </div>
                              <div className="min-w-0">
                                <p className="text-white/80 text-xs font-bold truncate">{l.name || l.whatsapp_name || "—"}</p>
                                <p className="text-white/30 text-[10px] font-mono">+{l.phone}</p>
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                      {apptSearch.length >= 2 && apptLeads.length === 0 && (
                        <p className="text-white/20 text-[10px] mt-1.5 pl-1">Nenhum paciente encontrado</p>
                      )}
                    </div>
                  )}
                </div>

                {/* Duration */}
                <div>
                  <p className="text-white/40 text-[10px] font-bold uppercase mb-1.5">Duração</p>
                  <div className="flex gap-1.5">
                    {["15","30","45","60","90"].map(d => (
                      <button key={d} onClick={() => setApptDuracao(d)}
                        className={`flex-1 py-1.5 rounded-lg text-xs font-bold border transition ${apptDuracao===d?"bg-emerald-600/80 border-emerald-500 text-white":"bg-white/5 border-white/10 text-white/50 hover:bg-white/10"}`}>
                        {d}min
                      </button>
                    ))}
                  </div>
                </div>

                {/* Indicação */}
                <div>
                  <p className="text-white/40 text-[10px] font-bold uppercase mb-1.5">📣 Indicação / Captação</p>
                  <input value={apptIndicacao} onChange={e => setApptIndicacao(e.target.value)}
                    placeholder="Ex: Dra. Vanessa, Instagram, indicação..."
                    className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-xs placeholder-white/25 focus:outline-none" />
                </div>

                {/* Tipo de procedimento + valor */}
                <div>
                  <p className="text-white/40 text-[10px] font-bold uppercase mb-1.5">🔬 Procedimento</p>
                  <div className="flex gap-2">
                    <input value={apptTipo} onChange={e => setApptTipo(e.target.value)}
                      placeholder="Tipo de procedimento"
                      className="flex-1 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-xs placeholder-white/25 focus:outline-none" />
                    <div className="relative w-28">
                      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-white/30 text-xs">R$</span>
                      <input value={apptValor} onChange={e => setApptValor(e.target.value)}
                        placeholder="0,00"
                        className="w-full pl-7 pr-2 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-xs placeholder-white/25 focus:outline-none" />
                    </div>
                  </div>
                </div>

                <button onClick={handleCreateAppt} disabled={!apptLead || apptSaving}
                  className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-black transition disabled:opacity-40 shadow-lg shadow-emerald-500/20">
                  {apptSaving ? "Agendando..." : "Confirmar Agendamento"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Smart Cancel Modal */}
        {smartCancelModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ background:"rgba(0,0,10,0.80)", backdropFilter:"blur(8px)" }}>
            <div className="w-full max-w-md rounded-2xl border border-amber-500/30 overflow-hidden shadow-2xl"
              style={{ background:"rgba(10,18,48,0.99)" }}>

              {/* Header */}
              <div className="px-5 py-4 border-b border-white/8"
                style={{ background:"rgba(251,191,36,0.08)" }}>
                <div className="flex items-center gap-2.5">
                  <span className="text-xl">🧠</span>
                  <div>
                    <p className="text-amber-300 font-black text-sm">Agenda Inteligente</p>
                    <p className="text-white/40 text-[10px] mt-0.5">
                      Pacientes que podem querer este horário
                    </p>
                  </div>
                </div>
              </div>

              {/* Freed slot info */}
              <div className="px-5 py-3 border-b border-white/6"
                style={{ background:"rgba(255,255,255,0.02)" }}>
                <p className="text-white/30 text-[9px] font-black uppercase tracking-wider mb-1">Horário que está sendo cancelado</p>
                <p className="text-white font-bold text-sm">
                  {new Date(smartCancelModal.appt.data_hora).toLocaleDateString("pt-BR", {
                    weekday: "long", day: "2-digit", month: "2-digit",
                    timeZone: "America/Sao_Paulo"
                  })} às {smartCancelModal.appt.data_hora.slice(11, 16)}
                </p>
                <p className="text-white/40 text-xs mt-0.5">{smartCancelModal.appt.medico?.nome || ""}</p>
              </div>

              {/* Candidates */}
              <div className="px-5 py-3 space-y-2.5 max-h-72 overflow-y-auto">
                <p className="text-white/30 text-[9px] font-black uppercase tracking-wider">
                  {smartCancelModal.candidates.length} paciente{smartCancelModal.candidates.length !== 1 ? "s" : ""} com possível interesse
                </p>
                {smartCancelModal.candidates.map((c, i) => (
                  <div key={c.lead_id}
                    className="rounded-xl p-3 border border-amber-500/20"
                    style={{ background:"rgba(251,191,36,0.06)" }}>
                    <div className="flex items-start gap-2.5">
                      <div className="w-7 h-7 rounded-full bg-amber-500/20 flex items-center justify-center text-amber-300 font-black text-xs shrink-0">
                        {i + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-white font-black text-xs">{c.lead_name}</p>
                          {c.phone && (
                            <a
                              href={`https://wa.me/55${c.phone}?text=Ol%C3%A1%20${encodeURIComponent(c.lead_name.split(" ")[0])}%2C%20abriu%20um%20hor%C3%A1rio%20no%20dia%20${encodeURIComponent(smartCancelModal.appt.data_hora.slice(0,10))}%20%C3%A0s%20${encodeURIComponent(smartCancelModal.appt.data_hora.slice(11,16))}%20com%20${encodeURIComponent(smartCancelModal.appt.medico?.nome || "a nutricionista")}%2C%20tem%20interesse%3F`}
                              target="_blank" rel="noopener noreferrer"
                              onClick={e => e.stopPropagation()}
                              className="shrink-0 flex items-center gap-1 px-2 py-1 rounded-lg text-[9px] font-black transition"
                              style={{ background:"rgba(37,211,102,0.15)", color:"#25d366", border:"1px solid rgba(37,211,102,0.3)" }}>
                              WhatsApp
                            </a>
                          )}
                        </div>
                        <p className="text-amber-400/80 text-[10px] font-bold mt-0.5">{c.reason}</p>
                        <p className="text-white/35 text-[10px] mt-1 italic leading-snug">"{c.message_snippet}"</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Actions */}
              <div className="px-5 py-4 border-t border-white/8 flex gap-2.5">
                <button onClick={() => setSmartCancelModal(null)}
                  className="flex-1 py-2.5 rounded-xl text-xs font-black transition"
                  style={{ background:"rgba(251,191,36,0.15)", color:"#fbbf24", border:"1.5px solid rgba(251,191,36,0.35)" }}>
                  Fechar e contatar
                </button>
                <button onClick={confirmCancel} disabled={!!saving}
                  className="flex-1 py-2.5 rounded-xl text-xs font-black transition disabled:opacity-50"
                  style={{ background:"rgba(239,68,68,0.12)", color:"rgba(239,68,68,0.8)", border:"1.5px solid rgba(239,68,68,0.25)" }}>
                  {saving ? "Cancelando..." : "Cancelar mesmo assim"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Right panel: mini calendar + summary */}
        <div className="w-56 shrink-0 flex flex-col border-l border-white/8 overflow-y-auto" style={{ background:"rgba(255,255,255,0.02)" }}>
          {/* Mini calendar */}
          <div className="px-3 pt-3 pb-2">
            <div className="flex items-center justify-between mb-2">
              <button onClick={() => { if(calMonth===0){setCalYear(y=>y-1);setCalMonth(11);}else setCalMonth(m=>m-1); }}
                className="p-1 rounded hover:bg-white/10 text-white/40 transition"><ChevronLeft size={12} /></button>
              <span className="text-white/70 text-[10px] font-black">{MONTHS_PT[calMonth].slice(0,3)} {calYear}</span>
              <button onClick={() => { if(calMonth===11){setCalYear(y=>y+1);setCalMonth(0);}else setCalMonth(m=>m+1); }}
                className="p-1 rounded hover:bg-white/10 text-white/40 transition"><ChevronRight size={12} /></button>
            </div>
            <div className="grid grid-cols-7 mb-1">
              {DAYS_PT_MINI.map(d => (
                <div key={d} className="text-center text-white/20 text-[8px] font-black">{d[0]}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-px">
              {calDays.map((day, i) => {
                if (!day) return <div key={`e${i}`} />;
                const dateStr = `${calYear}-${String(calMonth+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
                const isToday    = dateStr === todayStr;
                const isSelected = dateStr === selectedDay;
                const hasAg      = agendamentos.some(a => a.data_hora.slice(0,10) === dateStr && a.status !== "cancelado");
                return (
                  <button key={dateStr} onClick={() => setSelectedDay(dateStr)}
                    className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-black transition relative mx-auto"
                    style={{
                      background: isSelected ? "#059669" : isToday ? "rgba(5,150,105,0.2)" : "transparent",
                      color: isSelected ? "#fff" : isToday ? "#6ee7b7" : "rgba(255,255,255,0.5)",
                    }}>
                    {day}
                    {hasAg && !isSelected && (
                      <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-emerald-400/60" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="border-t border-white/8 mx-3" />

          {/* Day summary */}
          <div className="px-3 py-3 space-y-2">
            <p className="text-white/30 text-[9px] font-black uppercase tracking-widest">Resumo do Dia</p>
            {visibleMedicos.map(m => {
              const color   = medicoColorMap[m.id];
              const medAg   = dayAg.filter(a => a.medico_id === m.id && a.status !== "cancelado");
              const realizados = medAg.filter(a => a.status === "realizado").length;
              if (medAg.length === 0) return null;
              return (
                <div key={m.id} className="rounded-xl p-2.5 border" style={{ background:hex(color,0.08), borderColor:`${color}25` }}>
                  <p className="font-black text-xs truncate" style={{ color }}>{m.nome.replace(/^(Dr\.|Dra\.) /,"")}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="font-black text-base" style={{ color }}>{medAg.length}</span>
                    {realizados > 0 && <span className="text-emerald-400/70 text-[9px] font-bold">{realizados} realiz.</span>}
                  </div>
                  {m.valor && <p className="text-white/25 text-[9px] mt-0.5">{formatBRL(m.valor)}</p>}
                </div>
              );
            })}
            {dayAg.filter(a => a.status !== "cancelado").length === 0 && (
              <p className="text-white/15 text-[10px] text-center py-4">Sem consultas neste dia</p>
            )}
          </div>

          {/* Appointment list */}
          {dayAg.filter(a => a.status !== "cancelado").length > 0 && (
            <>
              <div className="border-t border-white/8 mx-3" />
              <div className="px-3 py-3 space-y-1.5">
                <p className="text-white/30 text-[9px] font-black uppercase tracking-widest mb-2">Ordem do Dia</p>
                {[...dayAg].filter(a => a.status !== "cancelado")
                  .sort((a,b) => a.data_hora.localeCompare(b.data_hora))
                  .map(a => {
                    const color = medicoColorMap[a.medico_id] || "#666";
                    const nome  = (a.lead?.name||a.lead?.whatsapp_name||"Paciente").split(" ")[0];
                    return (
                      <button key={a.id} onClick={() => {
                        setExpandedId(p => p === a.id ? null : a.id);
                        setTimeout(() => {
                          const slot = timeToSlot(a.data_hora);
                          if (gridRef.current) gridRef.current.scrollTop = slot * SLOT_H - 80;
                        }, 50);
                      }}
                        className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-white/5 transition text-left"
                        style={{ borderLeft: `2px solid ${color}` }}>
                        <span className="text-[9px] font-black shrink-0" style={{ color }}>{a.data_hora.slice(11,16)}</span>
                        <span className="text-white/60 text-[10px] font-bold truncate">{nome}</span>
                        {a.status === "realizado" && <CheckCircle2 size={9} className="text-emerald-400 shrink-0 ml-auto" />}
                      </button>
                    );
                  })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
