import { useEffect, useState, useCallback, useRef } from "react";
import { Search, RefreshCw, Users, Calendar, BarChart3, LogOut, Bot, UserPlus, X, TrendingDown, Zap, Brain, Filter, Bell } from "lucide-react";
import Pipeline from "./Pipeline";
import LeadModal from "./LeadModal";
import AgendaPage from "./AgendaPage";
import AdminPanel from "./AdminPanel";
import FinanceiroPage from "./FinanceiroPage";
import RelatorioPage from "./RelatorioPage";
import ProntuarioPage from "./ProntuarioPage";
import { fetchLeads, fetchStats, fetchMariaGlobalMode, setMariaGlobalMode, updateLeadAiMode, signOut, createLead, STAGES, fetchLatestInsight } from "../lib/api";
import { supabase } from "../lib/supabase";

type Page = "kanban" | "agenda" | "financeiro" | "relatorio" | "prontuario" | "admin";

export default function Dashboard({ user }: { user: any }) {
  const [leads, setLeads]         = useState<any[]>([]);
  const [stats, setStats]         = useState({ hoje: 0, maria: 0, agendados: 0, total: 0 });
  const [search, setSearch]       = useState("");
  const [selected, setSelected]   = useState<any>(null);
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [mariaActive, setMariaActive] = useState(false);
  const [mariaLoading, setMariaLoading] = useState(false);
  const [page, setPage]           = useState<Page>("kanban");
  const [showNewLead, setShowNewLead] = useState(false);
  const [newLeadForm, setNewLeadForm] = useState({
    name: "", phone: "", email: "", cpf: "", data_nascimento: "", sexo: "",
    stage: "novo_lead", ai_mode: false, first_message: "",
    origem: "",
    cep: "", endereco: "", numero: "", complemento: "", bairro: "", cidade: "", estado: "",
    convenio: "",
  });
  const [savingLead, setSavingLead]   = useState(false);
  const [newLeadMsg, setNewLeadMsg]   = useState("");
  const [briefing, setBriefing]       = useState<any>(null);

  const [newLeadAlert, setNewLeadAlert]   = useState(false);
  const [newMsgAlert,  setNewMsgAlert]    = useState(false);
  const [filterHoje, setFilterHoje]       = useState(false);
  const [showPriorityQueue, setShowPriorityQueue] = useState(false);
  const [showFollowUp, setShowFollowUp]           = useState(false);
  const [sendingFollowUp, setSendingFollowUp]     = useState<string | null>(null);
  const [organizeModal, setOrganizeModal] = useState<{
    open: boolean; total: number; current: number; done: boolean;
    results: { name: string; from: string; to: string; changed: boolean; motivo?: string }[];
  } | null>(null);
  const [notifications, setNotifications]   = useState<any[]>([]);
  const [toasts, setToasts]                 = useState<any[]>([]);
  const [showNotifPanel, setShowNotifPanel] = useState(false);

  const searchRef = useRef(search);
  searchRef.current = search;
  const pageRef = useRef(page);
  pageRef.current = page;

  function playNewLeadSound() {
    try {
      const ctx = new AudioContext();
      [[880, 0], [1100, 0.18]].forEach(([freq, delay]) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0, ctx.currentTime + delay);
        gain.gain.linearRampToValueAtTime(0.35, ctx.currentTime + delay + 0.04);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + 0.45);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime + delay);
        osc.stop(ctx.currentTime + delay + 0.5);
      });
    } catch {}
  }

  function playNewMessageSound() {
    try {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(660, ctx.currentTime);
      osc.frequency.linearRampToValueAtTime(500, ctx.currentTime + 0.25);
      gain.gain.setValueAtTime(0.22, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.45);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.5);
    } catch {}
  }

  const load = useCallback(async (q?: string) => {
    const query = q !== undefined ? q : searchRef.current;
    const [l, s] = await Promise.all([fetchLeads(query), fetchStats()]);
    // Dedup por ID — evita card duplicado quando realtime + polling disparam juntos
    const unique = Array.from(new Map(l.map((x: any) => [x.id, x])).values());
    setLeads(unique);
    setStats(s);
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    load();
    fetchMariaGlobalMode().then(setMariaActive);
    fetchLatestInsight().then(setBriefing);

    // Carrega notificações não lidas
    supabase.from("pn_notifications").select("*").eq("read", false)
      .order("created_at", { ascending: false }).limit(30)
      .then(({ data }) => setNotifications(data || []));

    // Realtime: nova notificação da IA
    const notifChannel = supabase
      .channel("pn_notifications_rt")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "pn_notifications" }, (payload) => {
        const n = payload.new as any;
        setNotifications(prev => [n, ...prev]);
        // Toast por 10 segundos
        setToasts(prev => [...prev, n]);
        setTimeout(() => setToasts(prev => prev.filter(t => t.id !== n.id)), 10000);
        // Som de alerta
        try {
          const ctx = new AudioContext();
          [880, 1100, 1320].forEach((freq, i) => {
            const osc = ctx.createOscillator(); const gain = ctx.createGain();
            osc.type = "sine"; osc.frequency.value = freq;
            gain.gain.setValueAtTime(0, ctx.currentTime + i * 0.12);
            gain.gain.linearRampToValueAtTime(0.2, ctx.currentTime + i * 0.12 + 0.04);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.12 + 0.35);
            osc.connect(gain); gain.connect(ctx.destination);
            osc.start(ctx.currentTime + i * 0.12); osc.stop(ctx.currentTime + i * 0.12 + 0.4);
          });
        } catch {}
      })
      .subscribe();

    return () => { supabase.removeChannel(notifChannel); };
  }, []);

  useEffect(() => {
    const leadsChannel = supabase
      .channel("pn_leads_rt")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "pn_leads" }, () => {
        playNewLeadSound();
        if (pageRef.current !== "kanban") setNewLeadAlert(true);
        load();
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "pn_leads" }, () => load())
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "pn_leads" }, () => load())
      .subscribe();

    const msgChannel = supabase
      .channel("pn_mensagens_rt")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "pn_mensagens" }, (payload) => {
        const msg = payload.new as any;
        if (msg?.direction === "in") {
          playNewMessageSound();
          if (pageRef.current !== "kanban") setNewMsgAlert(true);
        }
        // Atualiza o Kanban para refletir last_sender_nome e last_message_at
        // tanto para mensagem da Monica quanto da Maria ou do paciente
        load();
      })
      .subscribe();

    const interval = setInterval(() => load(), 15000);
    return () => {
      supabase.removeChannel(leadsChannel);
      supabase.removeChannel(msgChannel);
      clearInterval(interval);
    };
  }, [load]);

  async function handleToggleMaria() {
    const next = !mariaActive;
    setMariaActive(next);
    setMariaLoading(true);
    await setMariaGlobalMode(next);
    await load();
    setMariaLoading(false);
  }

  async function handleToggleAi(id: string, newMode: boolean) {
    setLeads(prev => prev.map(l => l.id === id ? { ...l, ai_mode: newMode } : l));
    await updateLeadAiMode(id, newMode);
  }

  function handleSearch(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value;
    setSearch(v);
    fetchLeads(v).then(setLeads);
  }

  async function handleOrganize() {
    const toProcess = leads.filter(l => !["agendado", "resolvido", "perdido"].includes(l.stage));
    setOrganizeModal({ open: true, total: toProcess.length, current: 0, done: false, results: [] });

    for (let i = 0; i < toProcess.length; i += 5) {
      const batch = toProcess.slice(i, i + 5);
      const batchResults = await Promise.all(batch.map(async (l) => {
        try {
          const res = await fetch("https://pvphgusjofufwtyiyviu.supabase.co/functions/v1/pn-auto-stage", {
            method: "POST",
            headers: { "Content-Type": "application/json", "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB2cGhndXNqb2Z1Znd0eWl5dml1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDI0MTM2NjMsImV4cCI6MjA1Nzk4OTY2M30.TLBbLCx08gkD_RWnMpZ4dBKxnb4wZgm6vTbAFaGRZ3A" },
            body: JSON.stringify({ lead_id: l.id }),
          });
          const data = await res.json();
          return {
            name:    l.name || l.whatsapp_name || `+${l.phone}`,
            from:    l.stage,
            to:      data.new_stage || l.stage,
            changed: !!data.changed,
            motivo:  data.motivo || "",
          };
        } catch {
          return null;
        }
      }));

      const valid = batchResults.filter(Boolean) as { name: string; from: string; to: string; changed: boolean; motivo?: string }[];
      setOrganizeModal(prev => prev ? {
        ...prev,
        current: Math.min(prev.current + batch.length, prev.total),
        results: [...prev.results, ...valid],
      } : null);
    }

    await load();
    setOrganizeModal(prev => prev ? { ...prev, current: prev.total, done: true } : null);
  }

  function handleNotifClick(n: any) {
    const lead = leads.find(l => l.id === n.lead_id);
    if (lead) setSelected(lead);
    setShowNotifPanel(false);
    if (!n.read) {
      supabase.from("pn_notifications").update({ read: true }).eq("id", n.id);
      setNotifications(prev => prev.map(x => x.id === n.id ? { ...x, read: true } : x));
    }
  }

  function markAllRead() {
    const ids = notifications.filter(n => !n.read).map(n => n.id);
    if (!ids.length) return;
    supabase.from("pn_notifications").update({ read: true }).in("id", ids);
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  }

  // ── Computed: fila de prioridades ─────────────────────────────────────────
  const priorityQueue = leads
    .filter(l => !["resolvido", "perdido", "agendado"].includes(l.stage))
    .map(l => {
      const lastMsg = l.last_message_at || l.created_at;
      const mins = Math.floor((Date.now() - new Date(lastMsg).getTime()) / 60000);
      const nomeLead = l.name || l.whatsapp_name || `+${l.phone}`;
      const semRespostaHumana = !l.ai_mode;

      let urgency: "alta" | "media" | "baixa";
      let motivo: string;
      let emoji: string;

      if (semRespostaHumana && mins > 120) {
        urgency = "alta"; emoji = "🔴";
        motivo = `Paciente aguardando ${mins >= 60 ? `${Math.floor(mins/60)}h` : `${mins}min`} sem resposta humana`;
      } else if (l.stage === "interesse_real" && mins > 60) {
        urgency = "alta"; emoji = "🔥";
        motivo = "Lead quente em Interesse Real — não perdê-lo de vista";
      } else if (semRespostaHumana && mins > 30) {
        urgency = "media"; emoji = "🟡";
        motivo = `Aguardando resposta há ${mins}min`;
      } else if (l.stage === "novo_lead" && mins > 30) {
        urgency = "media"; emoji = "👋";
        motivo = "Novo lead sem primeiro contato humano";
      } else {
        urgency = "baixa"; emoji = "🟢";
        motivo = l.ai_mode ? "Maria IA está cuidando" : "Em atendimento normal";
      }

      return { ...l, urgency, motivo, emoji, nomeLead, minsSince: mins };
    })
    .sort((a, b) => {
      const order = { alta: 0, media: 1, baixa: 2 };
      return order[a.urgency] - order[b.urgency] || b.minsSince - a.minsSince;
    });

  // ── Computed: follow-ups necessários ─────────────────────────────────────
  const FOLLOWUP_TEMPLATES = [
    (nome: string) => `Oi ${nome}! 😊 Tudo bem? Ainda tem interesse em agendar sua consulta de nutrição?`,
    (nome: string) => `Olá ${nome}! Passando para saber se ainda posso te ajudar com alguma informação sobre a consulta. 🌿`,
    (nome: string) => `Oi ${nome}! A clínica ProNutro aqui. Você ainda está interessado(a) em agendar? Temos horários disponíveis esta semana! 📅`,
  ];
  const followUpLeads = leads
    .filter(l => {
      if (["resolvido", "perdido", "agendado"].includes(l.stage)) return false;
      if (l.ai_mode) return false;
      const mins = Math.floor((Date.now() - new Date(l.last_message_at || l.created_at).getTime()) / 60000);
      return mins > 60 * 24;
    })
    .map((l, i) => ({
      ...l,
      nomeLead: l.name || l.whatsapp_name || `+${l.phone}`,
      template: FOLLOWUP_TEMPLATES[i % FOLLOWUP_TEMPLATES.length](l.name || l.whatsapp_name || ""),
      diasSem: Math.floor((Date.now() - new Date(l.last_message_at || l.created_at).getTime()) / (1000 * 60 * 60 * 24)),
    }));

  async function handleSendFollowUp(lead: any, text: string) {
    setSendingFollowUp(lead.id);
    await (await import("../lib/api")).sendMessage(lead.id, lead.phone, text, currentUser.nome);
    setSendingFollowUp(null);
    load();
  }

  async function handleCreateLead(e: React.FormEvent) {
    e.preventDefault();
    setSavingLead(true);
    setNewLeadMsg("");
    const ok = await createLead(newLeadForm);
    setSavingLead(false);
    if (ok) {
      setNewLeadMsg("✅ Paciente criado!");
      setNewLeadForm({
        name: "", phone: "", email: "", cpf: "", data_nascimento: "", sexo: "",
        stage: "novo_lead", ai_mode: false, first_message: "",
        origem: "",
        cep: "", endereco: "", numero: "", complemento: "", bairro: "", cidade: "", estado: "",
        convenio: "",
      });
      load();
      setTimeout(() => { setShowNewLead(false); setNewLeadMsg(""); }, 1200);
    } else {
      setNewLeadMsg("❌ Erro — verifique se o telefone já existe.");
    }
  }

  const statCards = [
    { label: "Leads Hoje",  value: stats.hoje,      icon: Users,    gradient: "from-sky-500 to-blue-600",       glow: "shadow-sky-500/30"     },
    { label: "Maria IA",    value: stats.maria,     icon: Bot,      gradient: "from-violet-500 to-purple-600",  glow: "shadow-violet-500/30"  },
    { label: "Agendados",   value: stats.agendados, icon: Calendar, gradient: "from-emerald-500 to-teal-600",   glow: "shadow-emerald-500/30" },
    { label: "Total",       value: stats.total,     icon: BarChart3, gradient: "from-amber-500 to-orange-500", glow: "shadow-amber-500/30"   },
  ];

  const roleLabel: Record<string, string> = { gerente: "GERENTE", secretaria: "SECRETÁRIA", medico: "MÉDICO", admin: "ADMIN" };

  // "Hoje em Brasília" começa às 03:00 UTC (UTC-3)
  const brasiliaToday = (() => {
    const d = new Date();
    const br = new Date(d.getTime() - 3 * 3600000);
    br.setUTCHours(0, 0, 0, 0);
    return new Date(br.getTime() + 3 * 3600000);
  })();
  const filteredLeads = filterHoje
    ? leads.filter(l => new Date(l.created_at) >= brasiliaToday)
    : leads;

  const firstName = (user.nome || "").split(" ")[0];
  const brHour    = new Date(Date.now() - 3 * 60 * 60 * 1000).getUTCHours();
  const saudacao  = brHour < 12 ? "Bom dia" : brHour < 18 ? "Boa tarde" : "Boa noite";

  return (
    <div className="h-screen flex flex-col overflow-hidden" style={{ background: "linear-gradient(160deg, #0e1f4a 0%, #162d6b 40%, #0f2057 100%)" }}>

      {/* Header */}
      <header className="flex-shrink-0 border-b border-white/10" style={{ background: "rgba(10,20,60,0.7)", backdropFilter: "blur(12px)" }}>
        <div className="px-4 sm:px-6 py-3 flex items-center gap-3">

          {/* Logo */}
          <div className="flex items-center gap-2.5 shrink-0">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-emerald-400 to-teal-600 flex items-center justify-center shadow-lg shadow-emerald-500/40">
              <span className="text-white font-black text-sm">P</span>
            </div>
            <div>
              <p className="text-white font-black text-lg leading-none tracking-tight">ProNutro</p>
              <p className="text-blue-200/50 text-[10px] font-bold tracking-wide">CRM CLÍNICA</p>
            </div>
          </div>

          {/* User badge + saudação */}
          <div className="hidden sm:flex items-center gap-2 ml-2 px-3 py-1.5 rounded-xl border border-emerald-500/25 bg-emerald-500/10">
            <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-emerald-400 to-teal-600 flex items-center justify-center">
              <span className="text-white font-black text-[10px]">{(user.nome || "U")[0].toUpperCase()}</span>
            </div>
            <div className="leading-tight">
              <p className="text-emerald-300 font-black text-xs leading-none">{saudacao}, {firstName}! 👋</p>
              <p className="text-emerald-500/60 text-[9px] font-bold">{roleLabel[user.role] || user.role?.toUpperCase()}</p>
            </div>
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          </div>

          {/* Nav tabs */}
          <div className="flex items-center gap-1 ml-2">
            {(["kanban", "agenda", "financeiro", "relatorio", "prontuario", "admin"] as Page[]).map(p => {
              const isKanban = p === "kanban";
              const hasAlert = isKanban && (newLeadAlert || newMsgAlert);
              return (
                <button
                  key={p}
                  onClick={() => { setPage(p); if (isKanban) { setNewLeadAlert(false); setNewMsgAlert(false); } }}
                  className={`relative px-3 py-1.5 rounded-lg text-xs font-bold transition ${page === p ? "bg-white/15 text-white" : "text-white/40 hover:text-white/70 hover:bg-white/5"}`}
                >
                  {p === "kanban" ? "Kanban" : p === "agenda" ? "Agenda" : p === "financeiro" ? "Financeiro" : p === "relatorio" ? "Relatório" : p === "prontuario" ? "Prontuário" : "Admin"}
                  {hasAlert && (
                    <span className="absolute -top-0.5 -right-0.5 flex h-2.5 w-2.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75"
                        style={{ backgroundColor: newLeadAlert ? "#22c55e" : "#f59e0b" }} />
                      <span className="relative inline-flex rounded-full h-2.5 w-2.5"
                        style={{ backgroundColor: newLeadAlert ? "#22c55e" : "#f59e0b" }} />
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Search + Filtro Hoje */}
          {page === "kanban" && (
            <div className="flex items-center gap-2 ml-2">
              <div className="relative max-w-xs w-full hidden sm:block">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none" />
                <input
                  value={search}
                  onChange={handleSearch}
                  placeholder="Buscar paciente..."
                  className="w-full pl-9 pr-3 py-2 bg-white/5 border border-white/10 rounded-xl text-sm text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition"
                />
              </div>
              <button
                onClick={() => setFilterHoje(f => !f)}
                title={filterHoje ? "Mostrando só leads de hoje — clique para ver todos" : "Filtrar por leads de hoje"}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-black border transition whitespace-nowrap ${
                  filterHoje
                    ? "bg-sky-600 text-white border-sky-500/50 shadow-lg shadow-sky-500/20"
                    : "bg-white/5 text-white/40 border-white/10 hover:text-white/70"
                }`}
              >
                <Filter size={11} />
                <span className="hidden sm:inline">Hoje</span>
                {filterHoje && filteredLeads.length > 0 && (
                  <span className="bg-white/20 px-1.5 py-0.5 rounded-full text-[9px] font-black">{filteredLeads.length}</span>
                )}
              </button>
            </div>
          )}

          {/* Actions */}
          <div className="ml-auto flex items-center gap-2">
            {/* Organizar Kanban com IA */}
            {page === "kanban" && (
              <button
                onClick={handleOrganize}
                disabled={organizeModal?.open && !organizeModal?.done}
                title="Analisa todas as conversas e move cada lead para o stage correto automaticamente"
                className={`flex items-center gap-1.5 font-black px-3 py-2 rounded-xl text-xs border transition ${
                  organizeModal?.open && !organizeModal?.done
                    ? "bg-amber-500/20 border-amber-500/40 text-amber-300 cursor-wait"
                    : "bg-violet-600/20 hover:bg-violet-600/40 border-violet-500/30 text-violet-300"
                }`}
              >
                <Brain size={13} className={organizeModal?.open && !organizeModal?.done ? "animate-pulse" : ""} />
                <span className="hidden sm:inline">
                  {organizeModal?.open && !organizeModal?.done ? "Organizando..." : "🎯 Organizar IA"}
                </span>
              </button>
            )}
            {/* Fila de Prioridades */}
            {page === "kanban" && (
              <button
                onClick={() => setShowPriorityQueue(true)}
                title="Fila de prioridades — quem atender primeiro"
                className="relative flex items-center gap-1.5 font-black px-3 py-2 rounded-xl text-xs border bg-amber-500/15 hover:bg-amber-500/30 border-amber-500/30 text-amber-300 transition"
              >
                <span className="text-sm leading-none">📋</span>
                <span className="hidden sm:inline">Prioridades</span>
                {priorityQueue.filter(l => l.urgency === "alta").length > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 rounded-full bg-red-500 text-white text-[9px] font-black flex items-center justify-center px-1 shadow-lg animate-pulse">
                    {priorityQueue.filter(l => l.urgency === "alta").length}
                  </span>
                )}
              </button>
            )}
            {/* Follow-ups */}
            {page === "kanban" && followUpLeads.length > 0 && (
              <button
                onClick={() => setShowFollowUp(true)}
                title="Leads precisando de follow-up — mais de 24h sem contato"
                className="relative flex items-center gap-1.5 font-black px-3 py-2 rounded-xl text-xs border bg-rose-500/15 hover:bg-rose-500/30 border-rose-500/30 text-rose-300 transition"
              >
                <span className="text-sm leading-none">🔔</span>
                <span className="hidden sm:inline">Follow-up</span>
                <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 rounded-full bg-rose-500 text-white text-[9px] font-black flex items-center justify-center px-1 shadow-lg">
                  {followUpLeads.length}
                </span>
              </button>
            )}
            {/* Novo Paciente */}
            {page === "kanban" && (
              <button
                onClick={() => setShowNewLead(true)}
                className="flex items-center gap-1.5 font-black px-3 py-2 rounded-xl text-xs border bg-emerald-600/20 hover:bg-emerald-600/40 border-emerald-500/30 text-emerald-300 transition"
                title="Criar paciente manualmente"
              >
                <UserPlus size={13} />
                <span className="hidden sm:inline">Novo Paciente</span>
              </button>
            )}

            {/* Maria toggle */}
            <button
              onClick={handleToggleMaria}
              disabled={mariaLoading}
              title={mariaActive ? "Maria ativa — clique para desligar" : "Maria inativa — clique para ligar"}
              className={`flex items-center gap-1.5 font-black px-3 py-2 rounded-xl text-xs border transition-all shadow-lg ${
                mariaActive
                  ? "bg-violet-600 hover:bg-violet-700 border-violet-500/50 text-white shadow-violet-500/30"
                  : "bg-white/5 hover:bg-white/10 border-white/15 text-white/50"
              } ${mariaLoading ? "opacity-60 cursor-wait" : ""}`}
            >
              <span className="text-sm leading-none">🤖</span>
              <span className="hidden sm:inline">{mariaActive ? "MARIA ON" : "MARIA OFF"}</span>
            </button>

            <button
              onClick={() => { setRefreshing(true); load(); }}
              className="p-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 transition"
              title="Atualizar"
            >
              <RefreshCw size={14} className={`text-white/60 ${refreshing ? "animate-spin" : ""}`} />
            </button>

            {/* Sino de notificações */}
            <div className="relative">
              <button
                onClick={() => setShowNotifPanel(s => !s)}
                className={`relative p-2 rounded-xl border transition ${showNotifPanel ? "bg-violet-600/30 border-violet-500/40" : "bg-white/5 hover:bg-white/10 border-white/10"}`}
                title="Notificações da IA"
              >
                <Bell size={14} className={notifications.some(n => !n.read) ? "text-violet-300" : "text-white/50"} />
                {notifications.some(n => !n.read) && (
                  <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 rounded-full bg-violet-500 text-white text-[9px] font-black flex items-center justify-center px-1 shadow-lg shadow-violet-500/40">
                    {notifications.filter(n => !n.read).length > 9 ? "9+" : notifications.filter(n => !n.read).length}
                  </span>
                )}
              </button>

              {showNotifPanel && (
                <div className="absolute right-0 top-11 w-80 rounded-2xl border border-white/10 shadow-2xl z-50 overflow-hidden"
                  style={{ background: "rgba(10,20,60,0.97)", backdropFilter: "blur(16px)" }}>
                  <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Brain size={13} className="text-violet-400" />
                      <span className="text-white font-black text-sm">Insights da IA</span>
                    </div>
                    {notifications.some(n => !n.read) && (
                      <button onClick={markAllRead} className="text-white/35 text-[10px] hover:text-white/60 transition font-bold">
                        marcar lidas
                      </button>
                    )}
                  </div>
                  {notifications.length === 0 ? (
                    <div className="px-4 py-10 text-center">
                      <Bell size={24} className="text-white/15 mx-auto mb-2" />
                      <p className="text-white/25 text-xs">Nenhuma notificação ainda</p>
                    </div>
                  ) : (
                    <div className="divide-y divide-white/5 max-h-80 overflow-y-auto">
                      {notifications.map(n => (
                        <button key={n.id} onClick={() => handleNotifClick(n)}
                          className={`w-full px-4 py-3 text-left hover:bg-white/5 transition group ${n.read ? "opacity-40" : ""}`}>
                          <div className="flex items-start gap-2">
                            <span className="text-base leading-none shrink-0 mt-0.5">
                              {n.type === "retorno" ? "🔄" : n.type === "urgente" ? "🔴" : "🎯"}
                            </span>
                            <div className="flex-1 min-w-0">
                              <p className="text-white font-black text-xs truncate">{n.lead_name}</p>
                              <p className="text-white/65 text-[11px] leading-relaxed mt-0.5">{n.message}</p>
                              <p className="text-white/20 text-[9px] mt-1">{new Date(n.created_at).toLocaleString("pt-BR")}</p>
                            </div>
                            {!n.read && <div className="w-1.5 h-1.5 rounded-full bg-violet-400 shrink-0 mt-1 animate-pulse" />}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <button
              onClick={() => signOut()}
              className="p-2 rounded-xl bg-white/5 hover:bg-rose-500/20 border border-white/10 hover:border-rose-500/30 transition"
              title="Sair"
            >
              <LogOut size={14} className="text-white/50 hover:text-rose-400" />
            </button>
          </div>
        </div>
      </header>

      {/* Stats */}
      {page === "kanban" && (
        <div className="flex-shrink-0 px-4 sm:px-6 py-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
          {statCards.map(({ label, value, icon: Icon, gradient, glow }) => (
            <div key={label} className="border border-white/10 rounded-xl p-3 flex items-center gap-3 hover:bg-white/[0.06] transition" style={{ background: "rgba(255,255,255,0.05)" }}>
              <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${gradient} flex items-center justify-center shadow-lg ${glow} flex-shrink-0`}>
                <Icon size={20} className="text-white" />
              </div>
              <div>
                <p className="text-4xl font-black text-white leading-none">{loading ? "–" : value}</p>
                <p className="text-blue-200/60 text-[10px] font-black tracking-widest uppercase mt-0.5">{label}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Briefing Matinal — sempre visível no kanban */}
      {page === "kanban" && !loading && (
        <div className="flex-shrink-0 px-4 sm:px-6 pb-1">
          <div className="rounded-xl border border-white/10 overflow-hidden" style={{ background: "rgba(255,255,255,0.03)" }}>
            {/* Linha superior: resumo rápido */}
            <div className="px-4 py-2.5 flex items-center gap-3 flex-wrap border-b border-white/8">
              <div className="flex items-center gap-1.5 shrink-0">
                <Brain size={12} className="text-violet-400" />
                <span className="text-violet-300 text-[10px] font-black uppercase tracking-wider">Briefing IA</span>
              </div>
              <div className="w-px h-3 bg-white/15 shrink-0" />
              {/* Urgentes */}
              {priorityQueue.filter(l => l.urgency === "alta").length > 0 ? (
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="text-[10px] font-black text-red-300">
                    🔴 {priorityQueue.filter(l => l.urgency === "alta").length} urgente{priorityQueue.filter(l => l.urgency === "alta").length !== 1 ? "s" : ""}
                  </span>
                  <span className="text-white/25 text-[10px]">
                    — {priorityQueue.filter(l => l.urgency === "alta").slice(0, 2).map(l => l.nomeLead.split(" ")[0]).join(", ")}
                  </span>
                </div>
              ) : (
                <span className="text-emerald-300 text-[10px] font-black">✅ Sem urgências</span>
              )}
              <div className="w-px h-3 bg-white/15 shrink-0" />
              {/* Follow-ups */}
              {followUpLeads.length > 0 ? (
                <button onClick={() => setShowFollowUp(true)} className="flex items-center gap-1 text-[10px] font-black text-rose-300 hover:text-rose-200 transition shrink-0">
                  🔔 {followUpLeads.length} follow-up{followUpLeads.length !== 1 ? "s" : ""} pendente{followUpLeads.length !== 1 ? "s" : ""}
                </button>
              ) : (
                <span className="text-white/30 text-[10px]">✓ Follow-ups em dia</span>
              )}
              {/* Leads quentes */}
              {priorityQueue.filter(l => l.stage === "interesse_real").length > 0 && (
                <>
                  <div className="w-px h-3 bg-white/15 shrink-0" />
                  <span className="text-amber-300 text-[10px] font-black shrink-0">
                    🔥 {priorityQueue.filter(l => l.stage === "interesse_real").length} lead{priorityQueue.filter(l => l.stage === "interesse_real").length !== 1 ? "s" : ""} quente{priorityQueue.filter(l => l.stage === "interesse_real").length !== 1 ? "s" : ""}
                  </span>
                </>
              )}
              <button onClick={() => setShowPriorityQueue(true)}
                className="ml-auto shrink-0 text-[10px] font-black text-amber-400 hover:text-amber-300 transition underline underline-offset-2">
                Ver fila →
              </button>
            </div>
            {/* Linha inferior: briefing GPT se existir */}
            {briefing && (
              <div className="px-4 py-2 flex items-center gap-3 flex-wrap">
                {briefing.score_saude != null && (
                  <>
                    <span className={`text-[10px] font-black ${briefing.score_saude >= 70 ? "text-emerald-400" : briefing.score_saude >= 45 ? "text-amber-400" : "text-rose-400"}`}>
                      {briefing.score_saude}pts
                    </span>
                    <div className="w-px h-3 bg-white/15 shrink-0" />
                  </>
                )}
                <p className="text-white/45 text-[10px] leading-relaxed flex-1 min-w-0 truncate">{briefing.briefing}</p>
                {briefing.metricas?.totalOportunidadePerdida > 0 && (
                  <div className="flex items-center gap-1 shrink-0">
                    <TrendingDown size={10} className="text-rose-400" />
                    <span className="text-rose-300 text-[10px] font-black">
                      -{briefing.metricas.totalOportunidadePerdida.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 })}
                    </span>
                  </div>
                )}
                <button onClick={() => setPage("relatorio")}
                  className="shrink-0 text-[10px] font-black text-violet-400 hover:text-violet-300 transition underline underline-offset-2">
                  Relatório →
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Main content */}
      <main className="flex-1 overflow-hidden min-h-0">
        {page === "kanban" && (
          loading ? (
            <div className="flex items-center justify-center h-full text-white/30 text-sm">Carregando leads...</div>
          ) : (
            <div className="h-full px-4 sm:px-6 pb-6">
              <Pipeline leads={filteredLeads} onSelect={setSelected} onToggleAi={handleToggleAi} currentUser={user} />
            </div>
          )
        )}
        {page === "agenda" && <AgendaPage />}
        {page === "financeiro" && <FinanceiroPage />}
        {page === "relatorio" && <RelatorioPage />}
        {page === "prontuario" && <ProntuarioPage />}
        {page === "admin" && <AdminPanel user={user} />}
      </main>

      {/* Modal: Fila de Prioridades */}
      {showPriorityQueue && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(6px)" }}>
          <div className="w-full max-w-lg max-h-[85vh] flex flex-col rounded-t-2xl sm:rounded-2xl border border-white/10 shadow-2xl overflow-hidden" style={{ background: "rgba(10,20,55,0.98)" }}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 flex-shrink-0">
              <div>
                <p className="text-white font-black text-sm">📋 Fila de Prioridades</p>
                <p className="text-white/35 text-[10px] mt-0.5">Quem atender primeiro hoje</p>
              </div>
              <button onClick={() => setShowPriorityQueue(false)} className="p-1.5 rounded-lg hover:bg-white/10 transition">
                <X size={16} className="text-white/50" />
              </button>
            </div>

            {/* Resumo */}
            <div className="flex gap-2 px-5 py-3 border-b border-white/8 flex-shrink-0">
              {[
                { label: "Urgente", count: priorityQueue.filter(l => l.urgency === "alta").length, color: "bg-red-500/20 text-red-300 border-red-500/30" },
                { label: "Atenção", count: priorityQueue.filter(l => l.urgency === "media").length, color: "bg-amber-500/20 text-amber-300 border-amber-500/30" },
                { label: "Em dia",  count: priorityQueue.filter(l => l.urgency === "baixa").length, color: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30" },
              ].map(({ label, count, color }) => (
                <div key={label} className={`flex-1 text-center px-2 py-1.5 rounded-xl border text-[10px] font-black ${color}`}>
                  <p className="text-lg leading-tight">{count}</p>
                  <p>{label}</p>
                </div>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-white/5">
              {priorityQueue.length === 0 && (
                <p className="text-white/25 text-xs text-center py-10">Todos os leads estão em dia! ✓</p>
              )}
              {priorityQueue.map(l => (
                <button key={l.id} onClick={() => { setSelected(l); setShowPriorityQueue(false); }}
                  className="w-full px-5 py-3.5 text-left hover:bg-white/5 transition flex items-start gap-3">
                  <span className="text-lg leading-none shrink-0 mt-0.5">{l.emoji}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-white font-black text-sm truncate">{l.nomeLead}</p>
                    <p className={`text-[11px] leading-relaxed mt-0.5 ${
                      l.urgency === "alta" ? "text-red-300" : l.urgency === "media" ? "text-amber-300" : "text-white/40"
                    }`}>{l.motivo}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-full border ${
                      l.urgency === "alta" ? "bg-red-500/20 text-red-300 border-red-500/30" :
                      l.urgency === "media" ? "bg-amber-500/20 text-amber-300 border-amber-500/30" :
                      "bg-white/10 text-white/40 border-white/15"
                    }`}>
                      {STAGES.find(s => s.key === l.stage)?.label || l.stage}
                    </span>
                    <p className="text-white/25 text-[10px] mt-1">Abrir →</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Modal: Follow-up Rápido */}
      {showFollowUp && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(6px)" }}>
          <div className="w-full max-w-lg max-h-[85vh] flex flex-col rounded-t-2xl sm:rounded-2xl border border-white/10 shadow-2xl overflow-hidden" style={{ background: "rgba(10,20,55,0.98)" }}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 flex-shrink-0">
              <div>
                <p className="text-white font-black text-sm">🔔 Follow-up Rápido</p>
                <p className="text-white/35 text-[10px] mt-0.5">{followUpLeads.length} lead{followUpLeads.length !== 1 ? "s" : ""} sem contato há mais de 24h</p>
              </div>
              <button onClick={() => setShowFollowUp(false)} className="p-1.5 rounded-lg hover:bg-white/10 transition">
                <X size={16} className="text-white/50" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-white/5">
              {followUpLeads.map(l => (
                <div key={l.id} className="px-5 py-4 space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-rose-500/60 to-orange-500/60 flex items-center justify-center text-white font-black text-[10px] shrink-0">
                      {l.nomeLead[0]?.toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-white font-black text-xs truncate">{l.nomeLead}</p>
                      <p className="text-rose-300/70 text-[10px]">Silêncio há {l.diasSem} dia{l.diasSem !== 1 ? "s" : ""}</p>
                    </div>
                    <button onClick={() => { setSelected(l); setShowFollowUp(false); }}
                      className="text-[10px] text-white/30 hover:text-white/60 transition shrink-0">
                      Ver chat →
                    </button>
                  </div>
                  <div className="rounded-xl border border-white/10 px-3 py-2.5" style={{ background: "rgba(255,255,255,0.03)" }}>
                    <p className="text-white/60 text-[10px] mb-1.5">Mensagem sugerida:</p>
                    <p className="text-white/80 text-xs leading-relaxed">{l.template}</p>
                  </div>
                  <button
                    onClick={() => handleSendFollowUp(l, l.template)}
                    disabled={sendingFollowUp === l.id}
                    className="w-full py-2 rounded-xl bg-emerald-600/80 hover:bg-emerald-600 text-white font-black text-xs transition disabled:opacity-50 flex items-center justify-center gap-1.5"
                  >
                    <span>{sendingFollowUp === l.id ? "Enviando..." : "📤 Enviar follow-up"}</span>
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Modal: novo paciente */}
      {showNewLead && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(6px)" }}>
          <div className="w-full max-w-2xl max-h-[92vh] flex flex-col rounded-2xl border border-white/10 shadow-2xl overflow-hidden" style={{ background: "rgba(10,20,55,0.98)" }}>

            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 flex-shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-emerald-400 to-teal-600 flex items-center justify-center">
                  <UserPlus size={15} className="text-white" />
                </div>
                <div>
                  <p className="text-white font-black text-base leading-none">Novo Paciente</p>
                  <p className="text-white/35 text-[10px] font-bold mt-0.5">Preencha os dados do cadastro</p>
                </div>
              </div>
              <button onClick={() => { setShowNewLead(false); setNewLeadMsg(""); }} className="p-1.5 rounded-lg hover:bg-white/10 transition">
                <X size={16} className="text-white/50" />
              </button>
            </div>

            {/* Form scrollável */}
            <form id="new-lead-form" onSubmit={handleCreateLead} className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

              {/* ── Identificação ── */}
              <section>
                <p className="text-white/40 text-[10px] font-black uppercase tracking-widest mb-3 flex items-center gap-1.5">
                  <span className="w-4 h-px bg-white/20" />Identificação<span className="flex-1 h-px bg-white/10" />
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <label className="block text-white/50 text-[10px] font-bold mb-1 uppercase">Nome completo *</label>
                    <input required value={newLeadForm.name} onChange={e => setNewLeadForm(p => ({ ...p, name: e.target.value }))}
                      placeholder="Maria da Silva Santos"
                      className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40" />
                  </div>
                  <div>
                    <label className="block text-white/50 text-[10px] font-bold mb-1 uppercase">CPF</label>
                    <input value={newLeadForm.cpf}
                      onChange={e => {
                        const v = e.target.value.replace(/\D/g, "").slice(0, 11);
                        const fmt = v.replace(/(\d{3})(\d{3})(\d{3})(\d{0,2})/, (_, a, b, c, d) => d ? `${a}.${b}.${c}-${d}` : c ? `${a}.${b}.${c}` : b ? `${a}.${b}` : a);
                        setNewLeadForm(p => ({ ...p, cpf: fmt }));
                      }}
                      placeholder="000.000.000-00" maxLength={14}
                      className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500/40" />
                  </div>
                  <div>
                    <label className="block text-white/50 text-[10px] font-bold mb-1 uppercase">Data de Nascimento</label>
                    <input type="date" value={newLeadForm.data_nascimento} onChange={e => setNewLeadForm(p => ({ ...p, data_nascimento: e.target.value }))}
                      className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40" />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-white/50 text-[10px] font-bold mb-1.5 uppercase">Sexo</label>
                    <div className="flex gap-2">
                      {[["M", "Masculino"], ["F", "Feminino"], ["O", "Outro"]].map(([v, l]) => (
                        <button key={v} type="button" onClick={() => setNewLeadForm(p => ({ ...p, sexo: p.sexo === v ? "" : v }))}
                          className={`flex-1 py-2 rounded-xl text-xs font-bold border transition ${newLeadForm.sexo === v ? "bg-emerald-600 text-white border-emerald-500" : "bg-white/5 text-white/50 border-white/10 hover:bg-white/10"}`}>
                          {l}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </section>

              {/* ── Contato ── */}
              <section>
                <p className="text-white/40 text-[10px] font-black uppercase tracking-widest mb-3 flex items-center gap-1.5">
                  <span className="w-4 h-px bg-white/20" />Contato<span className="flex-1 h-px bg-white/10" />
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-white/50 text-[10px] font-bold mb-1 uppercase">WhatsApp *</label>
                    <input required value={newLeadForm.phone} onChange={e => setNewLeadForm(p => ({ ...p, phone: e.target.value }))}
                      placeholder="5561999998888"
                      className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500/40" />
                    <p className="text-white/25 text-[10px] mt-0.5">55 + DDD + número</p>
                  </div>
                  <div>
                    <label className="block text-white/50 text-[10px] font-bold mb-1 uppercase">E-mail</label>
                    <input type="email" value={newLeadForm.email} onChange={e => setNewLeadForm(p => ({ ...p, email: e.target.value }))}
                      placeholder="paciente@email.com"
                      className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40" />
                  </div>
                  <div>
                    <label className="block text-white/50 text-[10px] font-bold mb-1 uppercase">Convênio</label>
                    <input value={newLeadForm.convenio} onChange={e => setNewLeadForm(p => ({ ...p, convenio: e.target.value }))}
                      placeholder="Unimed, Amil, Particular..."
                      className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40" />
                  </div>
                  <div>
                    <label className="block text-white/50 text-[10px] font-bold mb-1.5 uppercase">Por onde veio</label>
                    <select value={newLeadForm.origem} onChange={e => setNewLeadForm(p => ({ ...p, origem: e.target.value }))}
                      className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40">
                      <option value="">Selecionar...</option>
                      {["WhatsApp", "Google", "Instagram", "Facebook", "Indicação", "Doctoralia", "TikTok", "Outro"].map(o => (
                        <option key={o} value={o}>{o}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </section>

              {/* ── Endereço ── */}
              <section>
                <p className="text-white/40 text-[10px] font-black uppercase tracking-widest mb-3 flex items-center gap-1.5">
                  <span className="w-4 h-px bg-white/20" />Endereço<span className="flex-1 h-px bg-white/10" />
                </p>
                <div className="grid grid-cols-6 gap-3">
                  <div className="col-span-2">
                    <label className="block text-white/50 text-[10px] font-bold mb-1 uppercase">CEP</label>
                    <input value={newLeadForm.cep}
                      onChange={async e => {
                        const raw = e.target.value.replace(/\D/g, "").slice(0, 8);
                        const fmt = raw.length > 5 ? `${raw.slice(0,5)}-${raw.slice(5)}` : raw;
                        setNewLeadForm(p => ({ ...p, cep: fmt }));
                        if (raw.length === 8) {
                          try {
                            const r = await fetch(`https://viacep.com.br/ws/${raw}/json/`);
                            const d = await r.json();
                            if (!d.erro) setNewLeadForm(p => ({ ...p, cep: fmt, endereco: d.logradouro || p.endereco, bairro: d.bairro || p.bairro, cidade: d.localidade || p.cidade, estado: d.uf || p.estado }));
                          } catch {}
                        }
                      }}
                      placeholder="00000-000" maxLength={9}
                      className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500/40" />
                  </div>
                  <div className="col-span-4">
                    <label className="block text-white/50 text-[10px] font-bold mb-1 uppercase">Logradouro</label>
                    <input value={newLeadForm.endereco} onChange={e => setNewLeadForm(p => ({ ...p, endereco: e.target.value }))}
                      placeholder="Rua, Av., Quadra..."
                      className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40" />
                  </div>
                  <div className="col-span-1">
                    <label className="block text-white/50 text-[10px] font-bold mb-1 uppercase">Nº</label>
                    <input value={newLeadForm.numero} onChange={e => setNewLeadForm(p => ({ ...p, numero: e.target.value }))}
                      placeholder="123"
                      className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40" />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-white/50 text-[10px] font-bold mb-1 uppercase">Complemento</label>
                    <input value={newLeadForm.complemento} onChange={e => setNewLeadForm(p => ({ ...p, complemento: e.target.value }))}
                      placeholder="Apto, Sala..."
                      className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40" />
                  </div>
                  <div className="col-span-3">
                    <label className="block text-white/50 text-[10px] font-bold mb-1 uppercase">Bairro</label>
                    <input value={newLeadForm.bairro} onChange={e => setNewLeadForm(p => ({ ...p, bairro: e.target.value }))}
                      placeholder="Asa Norte..."
                      className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40" />
                  </div>
                  <div className="col-span-4">
                    <label className="block text-white/50 text-[10px] font-bold mb-1 uppercase">Cidade</label>
                    <input value={newLeadForm.cidade} onChange={e => setNewLeadForm(p => ({ ...p, cidade: e.target.value }))}
                      placeholder="Brasília"
                      className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40" />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-white/50 text-[10px] font-bold mb-1 uppercase">Estado</label>
                    <select value={newLeadForm.estado} onChange={e => setNewLeadForm(p => ({ ...p, estado: e.target.value }))}
                      className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40">
                      <option value="">UF</option>
                      {["AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"].map(uf => (
                        <option key={uf} value={uf}>{uf}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </section>

              {/* ── CRM ── */}
              <section>
                <p className="text-white/40 text-[10px] font-black uppercase tracking-widest mb-3 flex items-center gap-1.5">
                  <span className="w-4 h-px bg-white/20" />CRM<span className="flex-1 h-px bg-white/10" />
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-white/50 text-[10px] font-bold mb-1 uppercase">Stage inicial</label>
                    <select value={newLeadForm.stage} onChange={e => setNewLeadForm(p => ({ ...p, stage: e.target.value }))}
                      className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40">
                      {STAGES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                    </select>
                  </div>
                  <div className="flex items-end pb-0.5">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" id="ai_mode_new" checked={newLeadForm.ai_mode} onChange={e => setNewLeadForm(p => ({ ...p, ai_mode: e.target.checked }))}
                        className="w-4 h-4 rounded accent-violet-500" />
                      <span className="text-white/60 text-xs">Ativar Maria IA</span>
                    </label>
                  </div>
                  <div className="col-span-2">
                    <label className="block text-white/50 text-[10px] font-bold mb-1 uppercase">Observação inicial</label>
                    <textarea value={newLeadForm.first_message} onChange={e => setNewLeadForm(p => ({ ...p, first_message: e.target.value }))}
                      placeholder="Ex: Indicado pela Dra. Vanessa, quer consulta de retorno"
                      rows={2}
                      className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white text-sm resize-none focus:outline-none focus:ring-2 focus:ring-emerald-500/40" />
                  </div>
                </div>
              </section>

              {newLeadMsg && (
                <p className={`text-xs font-bold ${newLeadMsg.startsWith("✅") ? "text-emerald-300" : "text-rose-300"}`}>{newLeadMsg}</p>
              )}
            </form>

            {/* Footer fixo */}
            <div className="px-6 py-4 border-t border-white/10 flex-shrink-0 flex gap-3">
              <button type="button" onClick={() => { setShowNewLead(false); setNewLeadMsg(""); }}
                className="flex-1 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-white/60 font-black text-sm transition border border-white/10">
                Cancelar
              </button>
              <button type="submit" form="new-lead-form" disabled={savingLead}
                className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-sm transition shadow-lg shadow-emerald-500/20 disabled:opacity-50">
                {savingLead ? "Criando..." : "✅ Criar Paciente"}
              </button>
            </div>
          </div>
        </div>
      )}

      {selected && (
        <LeadModal
          lead={selected}
          currentUser={user}
          onClose={() => setSelected(null)}
          onUpdated={() => { load(); setSelected(null); }}
        />
      )}

      {/* Toasts de notificação da IA — canto inferior direito */}
      <div className="fixed bottom-4 right-4 z-[200] flex flex-col gap-2 pointer-events-none">
        {toasts.map(n => (
          <div key={n.id}
            className="pointer-events-auto flex items-start gap-3 pl-4 pr-3 py-3 rounded-2xl border shadow-2xl max-w-xs"
            style={{
              background: "rgba(10,20,60,0.97)",
              backdropFilter: "blur(16px)",
              borderColor: n.type === "urgente" ? "rgba(239,68,68,0.45)" : n.type === "retorno" ? "rgba(34,197,94,0.4)" : "rgba(139,92,246,0.4)",
              animation: "slideIn 0.3s ease",
            }}>
            <span className="text-xl leading-none shrink-0 mt-0.5">
              {n.type === "retorno" ? "🔄" : n.type === "urgente" ? "🔴" : "🎯"}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-violet-300 text-[9px] font-black uppercase tracking-wider mb-0.5">🤖 Maria detectou</p>
              <p className="text-white font-black text-xs">{n.lead_name}</p>
              <p className="text-white/70 text-[11px] leading-relaxed mt-0.5">{n.message}</p>
              <button
                onClick={() => handleNotifClick(n)}
                className="mt-1.5 text-[10px] font-black text-violet-400 hover:text-violet-300 transition underline underline-offset-2"
              >
                Ver conversa →
              </button>
            </div>
            <button onClick={() => setToasts(prev => prev.filter(t => t.id !== n.id))}
              className="shrink-0 p-1 rounded-lg hover:bg-white/10 text-white/30 hover:text-white/60 transition self-start">
              <X size={11} />
            </button>
          </div>
        ))}
      </div>

      {/* Modal de progresso do Organizar IA */}
      {organizeModal?.open && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(8px)" }}>
          <div className="w-full max-w-md rounded-2xl border border-violet-500/30 shadow-2xl overflow-hidden" style={{ background: "rgba(10,18,55,0.98)" }}>
            {/* Header */}
            <div className="px-5 py-4 border-b border-white/10 flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-violet-600/30 flex items-center justify-center">
                <Brain size={15} className={organizeModal.done ? "text-violet-300" : "text-violet-300 animate-pulse"} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-white font-black text-sm">🎯 Organizando Kanban com IA</p>
                <p className="text-white/40 text-[10px] font-bold mt-0.5">
                  {organizeModal.done
                    ? `${organizeModal.results.length} leads analisados · ${organizeModal.results.filter(r => r.changed).length} movidos pela IA`
                    : `Lendo conversas... ${organizeModal.current} de ${organizeModal.total}`}
                </p>
              </div>
            </div>

            {/* Progress bar */}
            <div className="px-5 pt-4">
              <div className="w-full h-2 rounded-full bg-white/10 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-300"
                  style={{
                    width: `${organizeModal.total > 0 ? Math.round((organizeModal.current / organizeModal.total) * 100) : 0}%`,
                    background: organizeModal.done ? "linear-gradient(90deg, #22c55e, #16a34a)" : "linear-gradient(90deg, #7c3aed, #a855f7)",
                  }}
                />
              </div>
              <p className="text-right text-[10px] text-white/25 font-bold mt-1">
                {organizeModal.total > 0 ? Math.round((organizeModal.current / organizeModal.total) * 100) : 0}%
              </p>
            </div>

            {/* Summary badges */}
            {organizeModal.results.length > 0 && (
              <div className="px-5 pt-1 flex items-center gap-3">
                <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-violet-500/20 text-violet-300 border border-violet-500/30">
                  {organizeModal.results.length} analisados
                </span>
                {organizeModal.results.filter(r => r.changed).length > 0 && (
                  <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                    {organizeModal.results.filter(r => r.changed).length} movidos
                  </span>
                )}
                {organizeModal.results.filter(r => !r.changed).length > 0 && (
                  <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-white/10 text-white/40 border border-white/10">
                    {organizeModal.results.filter(r => !r.changed).length} mantidos
                  </span>
                )}
              </div>
            )}

            {/* Results list */}
            <div className="px-5 pb-2 max-h-64 overflow-y-auto mt-2 space-y-1.5">
              {organizeModal.results.length === 0 && !organizeModal.done && (
                <p className="text-white/25 text-xs text-center py-4">Analisando conversas com IA...</p>
              )}
              {organizeModal.results.map((r, i) => {
                const stageLabel: Record<string, string> = {
                  novo_lead: "Novo Lead", maria_ia: "Maria IA", interesse_real: "Interesse Real",
                  agendado: "Agendado", resolvido: "Resolvido", perdido: "Perdido",
                };
                return (
                  <div key={i} className={`px-3 py-2 rounded-xl border ${
                    r.changed
                      ? "bg-violet-500/12 border-violet-500/30"
                      : "bg-white/3 border-white/8"
                  }`}>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-black shrink-0 ${r.changed ? "text-violet-300" : "text-white/25"}`}>
                        {r.changed ? "→" : "·"}
                      </span>
                      <span className={`text-xs font-bold truncate flex-1 ${r.changed ? "text-white" : "text-white/50"}`}>{r.name}</span>
                      <div className="flex items-center gap-1.5 shrink-0 text-[10px] font-bold">
                        {r.changed ? (
                          <>
                            <span className="text-white/35">{stageLabel[r.from] || r.from}</span>
                            <span className="text-violet-400">→</span>
                            <span className="text-violet-300">{stageLabel[r.to] || r.to}</span>
                          </>
                        ) : (
                          <span className="text-white/25">{stageLabel[r.from] || r.from}</span>
                        )}
                      </div>
                    </div>
                    {r.motivo && (
                      <p className={`text-[10px] mt-0.5 ml-4 leading-relaxed ${r.changed ? "text-violet-300/70" : "text-white/25"}`}>
                        {r.motivo}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Footer */}
            <div className="px-5 py-4 border-t border-white/10 flex justify-end">
              <button
                onClick={() => setOrganizeModal(null)}
                disabled={!organizeModal.done}
                className={`px-5 py-2 rounded-xl text-sm font-black transition ${
                  organizeModal.done
                    ? "bg-violet-600 hover:bg-violet-500 text-white shadow-lg shadow-violet-500/20"
                    : "bg-white/5 text-white/25 cursor-wait"
                }`}
              >
                {organizeModal.done ? "Fechar" : "Aguarde..."}
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`@keyframes slideIn { from { opacity:0; transform:translateX(24px); } to { opacity:1; transform:translateX(0); } }`}</style>
    </div>
  );
}
