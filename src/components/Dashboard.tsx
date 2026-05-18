import { useEffect, useState, useCallback, useRef } from "react";
import { Search, RefreshCw, Users, Calendar, BarChart3, LogOut, Bot, UserPlus, X, TrendingDown, Zap, Brain, Filter } from "lucide-react";
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
  const [newLeadForm, setNewLeadForm] = useState({ name: "", phone: "", stage: "novo_lead", ai_mode: false, first_message: "" });
  const [savingLead, setSavingLead]   = useState(false);
  const [newLeadMsg, setNewLeadMsg]   = useState("");
  const [briefing, setBriefing]       = useState<any>(null);

  const [newLeadAlert, setNewLeadAlert]   = useState(false);
  const [newMsgAlert,  setNewMsgAlert]    = useState(false);
  const [filterHoje, setFilterHoje]       = useState(false);
  const [organizing, setOrganizing]       = useState(false);
  const [organizeMsg, setOrganizeMsg]     = useState("");

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
    setOrganizing(true);
    setOrganizeMsg("");
    // Processa leads que não são "agendado" — em lotes de 5 para não sobrecarregar
    const toProcess = leads.filter(l => l.stage !== "agendado");
    let changed = 0;
    for (let i = 0; i < toProcess.length; i += 5) {
      const batch = toProcess.slice(i, i + 5);
      await Promise.all(batch.map(async (l) => {
        try {
          const res = await fetch("https://pvphgusjofufwtyiyviu.supabase.co/functions/v1/pn-auto-stage", {
            method: "POST",
            headers: { "Content-Type": "application/json", "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB2cGhndXNqb2Z1Znd0eWl5dml1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDI0MTM2NjMsImV4cCI6MjA1Nzk4OTY2M30.TLBbLCx08gkD_RWnMpZ4dBKxnb4wZgm6vTbAFaGRZ3A" },
            body: JSON.stringify({ lead_id: l.id }),
          });
          const data = await res.json();
          if (data.changed) changed++;
        } catch {}
      }));
    }
    await load();
    setOrganizeMsg(`✅ ${changed} lead${changed !== 1 ? "s" : ""} reorganizado${changed !== 1 ? "s" : ""}`);
    setOrganizing(false);
    setTimeout(() => setOrganizeMsg(""), 4000);
  }

  async function handleCreateLead(e: React.FormEvent) {
    e.preventDefault();
    setSavingLead(true);
    setNewLeadMsg("");
    const ok = await createLead(newLeadForm);
    setSavingLead(false);
    if (ok) {
      setNewLeadMsg("✅ Paciente criado!");
      setNewLeadForm({ name: "", phone: "", stage: "novo_lead", ai_mode: false, first_message: "" });
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
              <div className="flex items-center gap-2">
                {organizeMsg && (
                  <span className="text-xs font-bold text-emerald-300 whitespace-nowrap">{organizeMsg}</span>
                )}
                <button
                  onClick={handleOrganize}
                  disabled={organizing}
                  title="Analisa todas as conversas e move cada lead para o stage correto automaticamente"
                  className={`flex items-center gap-1.5 font-black px-3 py-2 rounded-xl text-xs border transition ${
                    organizing
                      ? "bg-amber-500/20 border-amber-500/40 text-amber-300 cursor-wait"
                      : "bg-violet-600/20 hover:bg-violet-600/40 border-violet-500/30 text-violet-300"
                  }`}
                >
                  <Brain size={13} className={organizing ? "animate-pulse" : ""} />
                  <span className="hidden sm:inline">{organizing ? "Organizando..." : "🎯 Organizar IA"}</span>
                </button>
              </div>
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

      {/* Briefing card — visível apenas no kanban quando existe análise */}
      {page === "kanban" && briefing && (
        <div className="flex-shrink-0 px-4 sm:px-6 pb-1">
          <div className="rounded-xl border border-violet-500/20 px-4 py-2.5 flex items-center gap-3 flex-wrap" style={{ background: "rgba(109,40,217,0.07)" }}>
            {/* Score */}
            <div className="flex items-center gap-2 shrink-0">
              <Brain size={13} className="text-violet-400" />
              <span className="text-violet-300 text-xs font-black">Score</span>
              <span className={`text-sm font-black ${briefing.score_saude >= 70 ? "text-emerald-400" : briefing.score_saude >= 45 ? "text-amber-400" : "text-rose-400"}`}>
                {briefing.score_saude}pts
              </span>
            </div>
            <div className="w-px h-4 bg-white/10 shrink-0" />
            {/* Briefing text */}
            <p className="text-white/60 text-xs leading-relaxed flex-1 min-w-0 truncate">{briefing.briefing}</p>
            {/* Oportunidade perdida */}
            {briefing.metricas?.totalOportunidadePerdida > 0 && (
              <>
                <div className="w-px h-4 bg-white/10 shrink-0" />
                <div className="flex items-center gap-1.5 shrink-0">
                  <TrendingDown size={12} className="text-rose-400" />
                  <span className="text-rose-300 text-xs font-black">
                    -{briefing.metricas.totalOportunidadePerdida.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 })}
                  </span>
                  <span className="text-white/30 text-[10px]">perdidos</span>
                </div>
              </>
            )}
            {/* Top bullet */}
            {briefing.bullets?.[0] && (
              <>
                <div className="w-px h-4 bg-white/10 shrink-0 hidden sm:block" />
                <div className="hidden sm:flex items-center gap-1.5 shrink-0 max-w-xs">
                  <Zap size={11} className="text-amber-400 shrink-0" />
                  <span className="text-white/40 text-[10px] truncate">{briefing.bullets[0]}</span>
                </div>
              </>
            )}
            {/* Link para relatório */}
            <button
              onClick={() => setPage("relatorio")}
              className="shrink-0 text-[10px] font-black text-violet-400 hover:text-violet-300 transition underline underline-offset-2"
            >
              Ver relatório completo →
            </button>
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

      {/* Modal: novo paciente */}
      {showNewLead && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(6px)" }}>
          <div className="w-full max-w-md rounded-2xl border border-white/10 shadow-2xl" style={{ background: "rgba(10,20,55,0.97)" }}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
              <p className="text-white font-black text-base">Novo Paciente</p>
              <button onClick={() => { setShowNewLead(false); setNewLeadMsg(""); }} className="p-1.5 rounded-lg hover:bg-white/10 transition">
                <X size={16} className="text-white/50" />
              </button>
            </div>
            <form onSubmit={handleCreateLead} className="p-5 space-y-3">
              <div>
                <label className="block text-white/50 text-[10px] font-bold mb-1 uppercase">Nome completo</label>
                <input required value={newLeadForm.name} onChange={e => setNewLeadForm(p => ({ ...p, name: e.target.value }))}
                  placeholder="Maria Silva"
                  className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40" />
              </div>
              <div>
                <label className="block text-white/50 text-[10px] font-bold mb-1 uppercase">Telefone (WhatsApp)</label>
                <input required value={newLeadForm.phone} onChange={e => setNewLeadForm(p => ({ ...p, phone: e.target.value }))}
                  placeholder="5561999998888"
                  className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500/40" />
                <p className="text-white/25 text-[10px] mt-0.5">Formato: 55 + DDD + número (ex: 5561999998888)</p>
              </div>
              <div>
                <label className="block text-white/50 text-[10px] font-bold mb-1 uppercase">Stage inicial</label>
                <select value={newLeadForm.stage} onChange={e => setNewLeadForm(p => ({ ...p, stage: e.target.value }))}
                  className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40">
                  {STAGES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-white/50 text-[10px] font-bold mb-1 uppercase">Observação inicial (opcional)</label>
                <textarea value={newLeadForm.first_message} onChange={e => setNewLeadForm(p => ({ ...p, first_message: e.target.value }))}
                  placeholder="Ex: Indicado pela Dra. Vanessa, quer consulta de retorno"
                  rows={2}
                  className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white text-sm resize-none focus:outline-none focus:ring-2 focus:ring-emerald-500/40" />
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" id="ai_mode_new" checked={newLeadForm.ai_mode} onChange={e => setNewLeadForm(p => ({ ...p, ai_mode: e.target.checked }))}
                  className="w-4 h-4 rounded accent-violet-500" />
                <label htmlFor="ai_mode_new" className="text-white/60 text-xs">Ativar Maria IA para este paciente</label>
              </div>
              {newLeadMsg && <p className={`text-xs font-bold ${newLeadMsg.startsWith("✅") ? "text-emerald-300" : "text-rose-300"}`}>{newLeadMsg}</p>}
              <button type="submit" disabled={savingLead}
                className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-sm transition shadow-lg shadow-emerald-500/20 disabled:opacity-50">
                {savingLead ? "Criando..." : "Criar Paciente"}
              </button>
            </form>
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
    </div>
  );
}
