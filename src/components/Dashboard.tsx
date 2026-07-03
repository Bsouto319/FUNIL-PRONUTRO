import { useEffect, useState, useCallback, useRef } from "react";
import { Search, RefreshCw, Users, Calendar, BarChart3, LogOut, Bot, UserPlus, X, TrendingDown, Zap, Brain, Bell, CalendarDays, Volume2, VolumeX, ChevronDown } from "lucide-react";
import Pipeline from "./Pipeline";
import LeadModal from "./LeadModal";
import AgendaPage from "./AgendaPage";
import AdminPanel from "./AdminPanel";
import FinanceiroPage from "./FinanceiroPage";
import RelatorioPage from "./RelatorioPage";
import FollowupPage from "./FollowupPage";
import ProntuarioPage from "./ProntuarioPage";
import PendenciasPage from "./PendenciasPage";
import PacientesPage from "./PacientesPage";
import PacientePresencialModal from "./PacientePresencialModal";
import EstoquePage from "./EstoquePage";
import TeamChat from "./TeamChat";
import { fetchLeads, fetchLeadById, fetchStats, fetchMariaGlobalMode, setMariaGlobalMode, updateLeadAiMode, signOut, createLead, STAGES, fetchLatestInsight, fetchBancos, sendMessage, getClinicSlug } from "../lib/api";
import { supabase } from "../lib/supabase";

type Page = "kanban" | "agenda" | "pacientes" | "pendencias" | "financeiro" | "relatorio" | "prontuario" | "estoque" | "admin" | "followup";

export default function Dashboard({ user, clinicConfig }: { user: any; clinicConfig?: any }) {
  const clinicName = clinicConfig?.clinic_name || "CRM";
  const agentName  = clinicConfig?.agent_name  || "Maria";
  const [leads, setLeads]         = useState<any[]>([]);
  const [stats, setStats]         = useState({ hoje: 0, maria: 0, agendados: 0, total: 0 });
  const [search, setSearch]       = useState("");
  const [selected, setSelected]   = useState<any>(null);
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [mariaActive, setMariaActive] = useState(false);
  const [mariaLoading, setMariaLoading] = useState(false);
  const [page, setPage]           = useState<Page>("kanban");
  const [financeiroPatient, setFinanceiroPatient] = useState<string | null>(null);
  const [showNewLead, setShowNewLead] = useState(false);
  const [newLeadForm, setNewLeadForm] = useState({
    name: "", phone: "", email: "", cpf: "", data_nascimento: "", sexo: "",
    stage: "em_atendimento", ai_mode: false, first_message: "",
    origem: "",
    cep: "", endereco: "", numero: "", complemento: "", bairro: "", cidade: "", estado: "",
    convenio: "",
  });
  const [savingLead, setSavingLead]   = useState(false);
  const [newLeadMsg, setNewLeadMsg]   = useState("");
  const [briefing, setBriefing]       = useState<any>(null);

  const [newLeadAlert, setNewLeadAlert]   = useState(false);
  const [newMsgAlert,  setNewMsgAlert]    = useState(false);
  // Padrão "Todos" — antes começava filtrado em "Hoje", escondendo conversas por engano
  const [dayFilter, setDayFilter]         = useState<string | null>(null);
  const [muted, setMuted]                 = useState(() => localStorage.getItem('pn_sound_muted') === 'true');
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
  const [bancos, setBancos]                 = useState<any[]>([]);
  const [showPresencial, setShowPresencial] = useState(false);
  const [showOutbound, setShowOutbound]       = useState(false);
  const [outboundPhone, setOutboundPhone]     = useState("");
  const [outboundName,  setOutboundName]      = useState("");
  const [outboundText,  setOutboundText]      = useState("");
  const [sendingOutbound, setSendingOutbound] = useState(false);
  const [outboundErr,   setOutboundErr]       = useState("");
  const [outboundSearch, setOutboundSearch]   = useState("");
  const [outboundSuggs,  setOutboundSuggs]    = useState<any[]>([]);
  const [outboundLead,   setOutboundLead]     = useState<any | null>(null);
  const outboundTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const searchRef = useRef(search);
  searchRef.current = search;
  const pageRef = useRef(page);
  pageRef.current = page;
  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement>(null);

  function playNewLeadSound() {
    if (mutedRef.current) return;
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
    if (mutedRef.current) return;
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

  const load = useCallback(async (q?: string, attempt = 1) => {
    try {
      const query = q !== undefined ? q : searchRef.current;
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), 15000)
      );
      const [l, s] = await Promise.race([
        Promise.all([fetchLeads(query), fetchStats()]),
        timeout,
      ]);
      const unique = Array.from(new Map(l.map((x: any) => [x.id, x])).values());
      if (unique.length === 0 && attempt === 1) {
        // Retry automático se vier vazio na primeira tentativa (possível timeout Supabase)
        setTimeout(() => load(q, 2), 3000);
        return;
      }
      setLeads(unique);
      setStats(s);
    } catch (err) {
      console.error("load error (attempt", attempt, ")", err);
      if (attempt === 1) {
        // Retry após 3s na primeira falha
        setTimeout(() => load(q, 2), 3000);
        return;
      }
      // Em erro na 2ª tentativa: mantém o que está na tela
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
    fetchBancos().then(setBancos).catch(() => {});
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
        if (!mutedRef.current) try {
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
    const slug = getClinicSlug();
    const leadsChannel = supabase
      .channel("pn_leads_rt")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "pn_leads", filter: `clinic_slug=eq.${slug}` }, (payload) => {
        playNewLeadSound();
        if (pageRef.current !== "kanban") setNewLeadAlert(true);
        const newLead = payload.new as any;
        if (!newLead?.id) return;
        // Insere imediatamente com os dados do payload (sem esperar round-trip)
        const optimistic = { ...newLead, stage: (STAGES as any)[newLead.stage] ? newLead.stage : (newLead.stage || "em_atendimento") };
        setLeads(prev => [optimistic, ...prev.filter(l => l.id !== newLead.id)]);
        // Corrige com dados joined em background (responsavel, etc.)
        fetchLeadById(newLead.id).then(full => {
          if (full) setLeads(prev => prev.map(l => l.id === full.id ? full : l));
        });
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "pn_leads", filter: `clinic_slug=eq.${slug}` }, (payload) => {
        const changedLead = payload.new as any;
        if (!changedLead?.id) return;
        // Atualiza imediatamente mesclando payload com dados joined existentes
        setLeads(prev => prev.map(l => l.id === changedLead.id ? { ...l, ...changedLead } : l));
        // Corrige com dados completos em background
        fetchLeadById(changedLead.id).then(full => {
          if (full) setLeads(prev => prev.map(l => l.id === full.id ? full : l));
        });
      })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "pn_leads", filter: `clinic_slug=eq.${slug}` }, (payload) => {
        const deleted = payload.old as any;
        if (deleted?.id) setLeads(prev => prev.filter(l => l.id !== deleted.id));
      })
      .subscribe();

    const msgChannel = supabase
      .channel("pn_mensagens_rt")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "pn_mensagens", filter: `clinic_slug=eq.${slug}` }, (payload) => {
        const msg = payload.new as any;
        if (msg?.direction === "in") {
          playNewMessageSound();
          if (pageRef.current !== "kanban") setNewMsgAlert(true);
        }
        if (!msg?.lead_id) return;
        // Atualiza ultima_mensagem do lead imediatamente sem esperar round-trip
        if (msg.body) {
          setLeads(prev => prev.map(l => l.id === msg.lead_id
            ? { ...l, last_message_at: msg.created_at ?? new Date().toISOString() }
            : l
          ));
        }
        // Busca lead completo em background para sincronizar todos os campos
        fetchLeadById(msg.lead_id).then(full => {
          if (!full) return;
          setLeads(prev => {
            const exists = prev.some(l => l.id === full.id);
            if (exists) return prev.map(l => l.id === full.id ? full : l);
            return [full, ...prev];
          });
        });
      })
      .subscribe();

    // Polling de fallback — Realtime é o primário, polling cobre quedas de conexão
    const interval = setInterval(() => load(), 3000);

    // Ao voltar pra aba: força reload imediato + reconecta canais
    function handleVisibility() {
      if (document.visibilityState === "visible") {
        load();
        leadsChannel.subscribe();
        msgChannel.subscribe();
      }
    }
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      supabase.removeChannel(leadsChannel);
      supabase.removeChannel(msgChannel);
      clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibility);
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
            headers: { "Content-Type": "application/json", "apikey": (import.meta.env.VITE_SUPABASE_ANON_KEY as string)?.trim() },
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
      const order: Record<string, number> = { alta: 0, media: 1, baixa: 2 };
      return order[a.urgency] - order[b.urgency] || b.minsSince - a.minsSince;
    });

  // ── Computed: follow-ups necessários ─────────────────────────────────────
  const FOLLOWUP_TEMPLATES = [
    (nome: string) => `Oi ${nome}! 😊 Tudo bem? Ainda tem interesse em agendar sua consulta de nutrição?`,
    (nome: string) => `Olá ${nome}! Passando para saber se ainda posso te ajudar com alguma informação sobre a consulta. 🌿`,
    (nome: string) => `Oi ${nome}! A ${clinicName} aqui. Você ainda está interessado(a) em agendar? Temos horários disponíveis esta semana! 📅`,
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
    await (await import("../lib/api")).sendMessage(lead.id, lead.phone, text, user.nome);
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
        stage: "em_atendimento", ai_mode: false, first_message: "",
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

  async function handleSendOutbound(e: React.FormEvent) {
    e.preventDefault();
    setOutboundErr("");
    const cleanPhone = (outboundLead?.phone || outboundPhone).replace(/\D/g, "");
    if (!cleanPhone || !outboundText.trim()) return;
    setSendingOutbound(true);
    let leadId = outboundLead?.id as string | undefined;
    if (!leadId) {
      // Try existing lead by phone, else create
      const { data: existing } = await supabase.from("pn_leads").select("id").eq("phone", cleanPhone).maybeSingle();
      leadId = existing?.id;
      if (!leadId) {
        const { data: created, error } = await supabase.from("pn_leads").insert({
          name: outboundName.trim() || null,
          phone: cleanPhone,
          stage: "em_atendimento",
          ai_mode: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).select("id").single();
        if (error || !created) { setOutboundErr("Erro ao criar contato."); setSendingOutbound(false); return; }
        leadId = created.id;
      }
    }
    const ok = await sendMessage(leadId!, cleanPhone, outboundText.trim(), user.nome || "Atendente");
    setSendingOutbound(false);
    if (!ok) { setOutboundErr("Erro ao enviar mensagem. Verifique o número."); return; }
    setShowOutbound(false);
    setOutboundPhone(""); setOutboundName(""); setOutboundText(""); setOutboundErr("");
    setOutboundSearch(""); setOutboundSuggs([]); setOutboundLead(null);
    await load();
    const { data: updatedLead } = await supabase.from("pn_leads").select("*").eq("id", leadId).single();
    if (updatedLead) setSelected(updatedLead);
  }

  function handleOutboundSearchChange(text: string) {
    setOutboundSearch(text);
    setOutboundLead(null);
    if (outboundTimer.current) clearTimeout(outboundTimer.current);
    if (text.trim().length >= 2) {
      outboundTimer.current = setTimeout(() =>
        fetchLeads(text).then(results => setOutboundSuggs(results.slice(0, 6))), 200);
    } else {
      setOutboundSuggs([]);
    }
  }

  function selectOutboundLead(lead: any) {
    setOutboundLead(lead);
    setOutboundName(lead.name || lead.whatsapp_name || "");
    setOutboundPhone(lead.phone || "");
    setOutboundSearch(lead.name || lead.whatsapp_name || `+${lead.phone}`);
    setOutboundSuggs([]);
  }

  const statCards = [
    { label: "Leads Hoje",  value: stats.hoje,      icon: Users,    gradient: "from-sky-500 to-blue-600",       glow: "shadow-sky-500/30"     },
    { label: `${agentName} IA`, value: mariaActive ? stats.maria : 0, icon: Bot, gradient: "from-violet-500 to-purple-600", glow: "shadow-violet-500/30" },
    { label: "Agendados",   value: stats.agendados, icon: Calendar, gradient: "from-emerald-500 to-teal-600",   glow: "shadow-emerald-500/30" },
    { label: "Total",       value: stats.total,     icon: BarChart3, gradient: "from-amber-500 to-orange-500", glow: "shadow-amber-500/30"   },
  ];

  const roleLabel: Record<string, string> = { gerente: "GERENTE", secretaria: "SECRETÁRIA", medico: "MÉDICO", admin: "ADMIN" };


  const displayName = (user.nome || "").includes("@") ? (user.nome as string).split("@")[0] : (user.nome || "Usuário");
  const firstName = displayName.split(" ")[0];
  const brHour    = new Date(Date.now() - 3 * 60 * 60 * 1000).getUTCHours();
  const saudacao  = brHour < 12 ? "Bom dia" : brHour < 18 ? "Boa tarde" : "Boa noite";

  return (
    <div className="h-screen flex flex-col overflow-hidden" style={{ background: "linear-gradient(160deg, #f0f9ff 0%, #e8f4fd 40%, #f1f5f9 100%)" }}>

      {/* Header */}
      <header className="flex-shrink-0 border-b border-slate-200" style={{ background: "rgba(255,255,255,0.95)", backdropFilter: "blur(12px)" }}>
        <div className="px-4 sm:px-6 py-2 flex items-center gap-3">

          {/* Logo */}
          <div className="flex items-center gap-2.5 shrink-0">
            <img
              src="/favicon.jpg"
              alt="ProNutro"
              className="h-10 w-10 rounded-xl object-cover shadow-lg"
              style={{ boxShadow: "0 0 16px 2px rgba(180,120,80,0.35)" }}
            />
            <div>
              <p className="text-slate-800 font-black text-lg leading-none tracking-tight">{clinicName}</p>
              <p className="text-sky-500 text-[10px] font-bold tracking-wide">CRM CLÍNICA</p>
            </div>
          </div>

          {/* User badge + saudação */}
          <div className="hidden sm:flex items-center gap-2 ml-2 px-3 py-1.5 rounded-xl border border-emerald-500/25 bg-emerald-500/10">
            <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-emerald-400 to-teal-600 flex items-center justify-center">
              <span className="text-white font-black text-[10px]">{(displayName[0] || "U").toUpperCase()}</span>
            </div>
            <div className="leading-tight">
              <p className="text-emerald-300 font-black text-xs leading-none">{saudacao}, {firstName}! 👋</p>
              <p className="text-emerald-500/60 text-[9px] font-bold">{roleLabel[user.role] || user.role?.toUpperCase()}</p>
            </div>
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          </div>

          {/* Nav tabs */}
          <div className="flex items-center gap-1 ml-2">
            {/* Tabs principais sempre visíveis */}
            {(["kanban", "agenda", "pacientes"] as Page[]).map(p => {
              const isKanban = p === "kanban";
              const hasAlert = isKanban && (newLeadAlert || newMsgAlert);
              return (
                <button
                  key={p}
                  onClick={() => { setPage(p); if (isKanban) { setNewLeadAlert(false); setNewMsgAlert(false); } }}
                  className={`relative px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                    page === p ? "bg-sky-100 text-sky-700" : "text-slate-500 hover:text-slate-700 hover:bg-slate-100"
                  }`}
                >
                  {p === "kanban" ? "Kanban" : p === "agenda" ? "Agenda" : "👥 Pacientes"}
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

            {/* Dropdown "Mais" para o resto */}
            <div className="relative" ref={moreMenuRef}>
              <button
                onClick={() => setShowMoreMenu(m => !m)}
                className={`relative flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                  ["pendencias","financeiro","relatorio","followup","prontuario","estoque","admin"].includes(page)
                    ? "bg-sky-100 text-sky-700"
                    : "text-slate-500 hover:text-slate-700 hover:bg-slate-100"
                }`}
              >
                {["pendencias","financeiro","relatorio","followup","prontuario","estoque","admin"].includes(page)
                  ? (page === "pendencias" ? "💰 Pendências" : page === "financeiro" ? "Financeiro" : page === "relatorio" ? "Relatório" : page === "followup" ? "🤖 Follow-up IA" : page === "prontuario" ? "Prontuário" : page === "estoque" ? "📦 Estoque" : "Admin")
                  : "Mais"}
                <ChevronDown size={11} className={`transition-transform ${showMoreMenu ? "rotate-180" : ""}`} />
                {/* Badge pendências */}
                {leads.filter(l => l.pendencia_financeira).length > 0 && !["pendencias","financeiro","relatorio","followup","prontuario","estoque","admin"].includes(page) && (
                  <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 rounded-full bg-yellow-500 text-white text-[9px] font-black flex items-center justify-center px-1">
                    {leads.filter(l => l.pendencia_financeira).length}
                  </span>
                )}
              </button>

              {showMoreMenu && (
                <div className="absolute top-full left-0 mt-1 z-50 bg-white border border-slate-200 rounded-xl shadow-xl py-1.5 min-w-[160px]">
                  {([
                    { key: "pendencias", label: "💰 Pendências" },
                    { key: "financeiro", label: "Financeiro" },
                    { key: "relatorio",  label: "Relatório" },
                    { key: "followup",   label: "🤖 Follow-up IA" },
                    { key: "prontuario", label: "Prontuário" },
                    { key: "estoque",    label: "📦 Estoque" },
                    { key: "admin",      label: "⚙️ Admin" },
                  ] as { key: Page; label: string }[]).map(({ key, label }) => {
                    const pendenciasCount = leads.filter(l => l.pendencia_financeira).length;
                    return (
                      <button
                        key={key}
                        onClick={() => { setPage(key); setShowMoreMenu(false); }}
                        className={`w-full text-left flex items-center justify-between px-4 py-2 text-sm transition ${
                          page === key ? "text-sky-700 bg-sky-50" : "text-slate-600 hover:text-slate-800 hover:bg-slate-50"
                        }`}
                      >
                        {label}
                        {key === "pendencias" && pendenciasCount > 0 && (
                          <span className="ml-2 min-w-[18px] h-4 rounded-full bg-yellow-500 text-white text-[9px] font-black flex items-center justify-center px-1">{pendenciasCount}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Search + Filtro Hoje */}
          {page === "kanban" && (
            <div className="flex items-center gap-2 ml-2">
              <div className="relative max-w-xs w-full hidden sm:block">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                <input
                  value={search}
                  onChange={handleSearch}
                  placeholder="Buscar paciente..."
                  className="w-full pl-9 pr-3 py-2 bg-slate-100 border border-slate-200 rounded-xl text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-400/50 transition"
                />
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="ml-auto flex items-center gap-2">
            {/* Fila de Prioridades */}
            {page === "kanban" && (
              <button
                onClick={() => setShowPriorityQueue(true)}
                title="Fila de prioridades — quem atender primeiro"
                className="relative flex items-center gap-1.5 font-black px-3 py-2 rounded-xl text-xs border bg-amber-50 hover:bg-amber-100 border-amber-300 text-amber-700 transition"
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
            {/* Paciente Presencial */}
            {(page === "kanban" || page === "agenda") && (
              <button
                onClick={() => setShowPresencial(true)}
                className="flex items-center gap-1.5 font-black px-3 py-2 rounded-xl text-xs border bg-emerald-50 hover:bg-emerald-100 border-emerald-300 text-emerald-700 transition"
                title="Adicionar paciente presencial — cadastro + consulta + pagamento"
              >
                <UserPlus size={13} />
                <span className="hidden sm:inline">Novo Paciente</span>
              </button>
            )}
            {(page === "kanban" || page === "agenda") && (
              <button
                onClick={() => setShowOutbound(true)}
                className="flex items-center gap-1.5 font-black px-3 py-2 rounded-xl text-xs border bg-sky-50 hover:bg-sky-100 border-sky-300 text-sky-700 transition"
                title="Iniciar conversa ativa com paciente pelo WhatsApp"
              >
                <span className="text-[13px]">💬</span>
                <span className="hidden sm:inline">Nova Conversa</span>
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
                  : "bg-slate-100 hover:bg-slate-200 border-slate-200 text-slate-500"
              } ${mariaLoading ? "opacity-60 cursor-wait" : ""}`}
            >
              <span className="text-sm leading-none">🤖</span>
              <span className="hidden sm:inline">{mariaActive ? "MARIA ON" : "MARIA OFF"}</span>
            </button>

            <button
              onClick={() => setMuted(m => { const next = !m; localStorage.setItem('pn_sound_muted', next ? 'true' : 'false'); return next; })}
              title={muted ? 'Som desligado — clique para ligar' : 'Som ligado — clique para desligar'}
              className={`p-2 rounded-xl border transition ${muted ? 'bg-red-500/15 border-red-500/30 text-red-500' : 'bg-slate-100 hover:bg-slate-200 border-slate-200 text-slate-500'}`}
            >
              {muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
            </button>

            <button
              onClick={() => { setRefreshing(true); load(); }}
              className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 border border-slate-200 transition"
              title="Atualizar"
            >
              <RefreshCw size={14} className={`text-slate-500 ${refreshing ? "animate-spin" : ""}`} />
            </button>

            {/* Sino de notificações */}
            <div className="relative">
              <button
                onClick={() => setShowNotifPanel(s => !s)}
                className={`relative p-2 rounded-xl border transition ${showNotifPanel ? "bg-violet-600/30 border-violet-500/40" : "bg-slate-100 hover:bg-slate-200 border-slate-200"}`}
                title="Notificações da IA"
              >
                <Bell size={14} className={notifications.some(n => !n.read) ? "text-violet-500" : "text-slate-500"} />
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
              className="p-2 rounded-xl bg-slate-100 hover:bg-rose-500/20 border border-slate-200 hover:border-rose-500/30 transition"
              title="Sair"
            >
              <LogOut size={14} className="text-slate-500 hover:text-rose-500" />
            </button>
          </div>
        </div>
      </header>

      {/* Barra de status compacta — stats + briefing em uma única linha */}
      {page === "kanban" && !loading && (
        <div className="flex-shrink-0 px-4 sm:px-6 py-1 border-b border-slate-200" style={{ background: "rgba(255,255,255,0.7)" }}>
          <div className="flex items-center gap-3 overflow-x-auto [&::-webkit-scrollbar]:hidden min-h-[28px]">
            {/* Stats inline */}
            <div className="flex items-center gap-3 shrink-0">
              <span className="text-[11px] text-slate-500"><span className="font-black text-sky-600">{stats.hoje}</span> <span className="text-slate-400">hoje</span></span>
              <span className="text-slate-300 text-[10px]">·</span>
              <span className="text-[11px] text-slate-500"><span className="font-black text-violet-600">{mariaActive ? stats.maria : 0}</span> <span className="text-slate-400">IA</span></span>
              <span className="text-slate-300 text-[10px]">·</span>
              <span className="text-[11px] text-slate-500"><span className="font-black text-emerald-600">{stats.agendados}</span> <span className="text-slate-400">agendados</span></span>
              <span className="text-slate-300 text-[10px]">·</span>
              <span className="text-[11px] text-slate-500"><span className="font-black text-amber-600">{stats.total}</span> <span className="text-slate-400">total</span></span>
            </div>

            <div className="w-px h-3 bg-slate-300 shrink-0" />

            {/* Urgências */}
            {priorityQueue.filter(l => l.urgency === "alta").length > 0 ? (
              <button onClick={() => setShowPriorityQueue(true)}
                className="flex items-center gap-1.5 shrink-0 hover:opacity-80 transition">
                <span className="text-[10px] font-black text-red-300">
                  🔴 {priorityQueue.filter(l => l.urgency === "alta").length} urgente{priorityQueue.filter(l => l.urgency === "alta").length !== 1 ? "s" : ""}
                </span>
                <span className="text-slate-400 text-[10px] hidden sm:inline">
                  — {priorityQueue.filter(l => l.urgency === "alta").slice(0, 2).map(l => l.nomeLead.split(" ")[0]).join(", ")}
                </span>
              </button>
            ) : (
              <span className="text-emerald-400 text-[10px] font-black shrink-0">✅ ok</span>
            )}

            {/* Briefing GPT — truncado, clicável para relatório */}
            {briefing && (
              <>
                <div className="w-px h-3 bg-slate-300 shrink-0" />
                {briefing.score_saude != null && (
                  <span className={`text-[10px] font-black shrink-0 ${briefing.score_saude >= 70 ? "text-emerald-400" : briefing.score_saude >= 45 ? "text-amber-400" : "text-rose-400"}`}>
                    {briefing.score_saude}pts
                  </span>
                )}
                <p className="text-slate-400 text-[10px] truncate min-w-0 max-w-[260px] hidden md:block">{briefing.briefing}</p>
                {briefing.metricas?.totalOportunidadePerdida > 0 && (
                  <div className="flex items-center gap-1 shrink-0">
                    <TrendingDown size={9} className="text-rose-400" />
                    <span className="text-rose-300 text-[10px] font-black">
                      -{briefing.metricas.totalOportunidadePerdida.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 })}
                    </span>
                  </div>
                )}
                <button onClick={() => setPage("relatorio")}
                  className="shrink-0 text-[10px] font-black text-violet-400 hover:text-violet-300 transition">
                  Rel. →
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Main content */}
      <main className="flex-1 overflow-hidden min-h-0">
        {page === "kanban" && (
          loading ? (
            <div className="flex items-center justify-center h-full text-slate-400 text-sm">Carregando leads...</div>
          ) : (
            <div className="h-full flex flex-col px-4 sm:px-6 pb-6 gap-2">
              {/* Day filter bar */}
              <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
                <CalendarDays size={13} className="text-slate-400" />
                {[
                  { label: "Todos", value: null },
                  { label: "Hoje", value: (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; })() },
                  { label: "Ontem", value: (() => { const d = new Date(); d.setDate(d.getDate()-1); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; })() },
                ].map(opt => (
                  <button
                    key={opt.label}
                    onClick={() => setDayFilter(opt.value)}
                    className={`text-[11px] font-black px-3 py-1 rounded-lg border transition-all ${
                      dayFilter === opt.value
                        ? "bg-emerald-600/80 text-white border-emerald-500/60 shadow shadow-emerald-500/20"
                        : "bg-white text-slate-500 border-slate-200 hover:text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    {opt.label}
                    {dayFilter === opt.value && opt.value !== null && (
                      <span className="ml-1.5 bg-white/25 px-1 py-0.5 rounded-full text-[9px]">
                        {leads.filter(l => {
                          const ref = l.last_message_at ?? l.created_at;
                          const d = new Date(ref);
                          const y = d.getFullYear();
                          const mo = String(d.getMonth() + 1).padStart(2, '0');
                          const da = String(d.getDate()).padStart(2, '0');
                          return `${y}-${mo}-${da}` === opt.value;
                        }).length}
                      </span>
                    )}
                  </button>
                ))}
                <input
                  type="date"
                  value={dayFilter ?? ""}
                  onChange={e => setDayFilter(e.target.value || null)}
                  className="text-[11px] font-bold px-2 py-1 rounded-lg border bg-white text-slate-500 border-slate-200 focus:outline-none focus:border-emerald-500/50 focus:text-slate-800 transition"
                />
                {dayFilter && (
                  <button
                    onClick={() => setDayFilter(null)}
                    className="text-[10px] text-white/30 hover:text-white/60 font-black transition"
                    title="Limpar filtro"
                  >
                    ✕ limpar
                  </button>
                )}
              </div>
              <div className="flex-1 min-h-0">
                <Pipeline leads={leads} onSelect={setSelected} onToggleAi={handleToggleAi} currentUser={user} dayFilter={dayFilter} />
              </div>
            </div>
          )
        )}
        {page === "agenda" && <AgendaPage onSelectLead={setSelected} currentUser={user} />}
        {page === "pacientes" && <PacientesPage leads={leads} currentUser={user} onSelect={setSelected} />}
        {page === "pendencias" && <PendenciasPage leads={leads} onSelect={setSelected} onResolved={load} />}
        {page === "financeiro" && <FinanceiroPage initialPaciente={financeiroPatient} />}
        {page === "relatorio" && <RelatorioPage />}
        {page === "followup" && <FollowupPage onSelectLead={setSelected} />}
        {page === "prontuario" && <ProntuarioPage />}
        {page === "estoque" && <EstoquePage />}
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
          onGoFinanceiro={(patientName) => {
            load();
            setSelected(null);
            setFinanceiroPatient(patientName);
            setPage("financeiro");
          }}
          onGoAgenda={() => {
            setSelected(null);
            setPage("agenda");
          }}
        />
      )}

      {showPresencial && (
        <PacientePresencialModal
          currentUser={user}
          onClose={() => setShowPresencial(false)}
          onDone={(lead) => { setShowPresencial(false); load(); setSelected(lead); }}
        />
      )}

      {/* Modal — Nova Conversa (outbound WhatsApp) */}
      {showOutbound && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,10,0.75)", backdropFilter: "blur(6px)" }}
          onClick={e => { if (e.target === e.currentTarget) setShowOutbound(false); }}>
          <div className="w-full max-w-sm rounded-2xl border border-white/10 overflow-hidden" style={{ background: "rgba(10,18,48,0.98)" }}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/8">
              <div className="flex items-center gap-2">
                <span className="text-lg">💬</span>
                <div>
                  <p className="text-white font-black text-sm leading-none">Nova Conversa</p>
                  <p className="text-white/30 text-[10px] mt-0.5">Inicia conversa ativa no WhatsApp</p>
                </div>
              </div>
              <button onClick={() => setShowOutbound(false)} className="p-1.5 rounded-lg hover:bg-white/10 text-white/40 transition">
                <X size={15} />
              </button>
            </div>
            <form onSubmit={handleSendOutbound} className="px-5 py-4 space-y-3">

              {/* Busca de paciente existente */}
              <div>
                <label className="text-white/40 text-[10px] font-bold uppercase tracking-wide block mb-1">Buscar paciente ou contato</label>
                {outboundLead ? (
                  <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-sky-500/10 border border-sky-500/30">
                    <div className="w-7 h-7 rounded-full bg-sky-500/25 flex items-center justify-center text-sky-300 font-black text-xs shrink-0">
                      {(outboundLead.name || outboundLead.whatsapp_name || "?")[0].toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sky-200 text-sm font-bold truncate">{outboundLead.name || outboundLead.whatsapp_name}</p>
                      <p className="text-sky-400/50 text-[10px] font-mono">+{outboundLead.phone}</p>
                    </div>
                    <button type="button" onClick={() => { setOutboundLead(null); setOutboundSearch(""); setOutboundPhone(""); setOutboundName(""); }}
                      className="text-sky-400/50 hover:text-sky-300 transition shrink-0">
                      <X size={13} />
                    </button>
                  </div>
                ) : (
                  <div className="relative">
                    <input
                      value={outboundSearch}
                      onChange={e => handleOutboundSearchChange(e.target.value)}
                      placeholder="Digite nome ou telefone..."
                      autoFocus
                      className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white text-sm placeholder-white/20 focus:outline-none focus:ring-2 focus:ring-sky-500/50"
                    />
                    {outboundSuggs.length > 0 && (
                      <div className="absolute top-full left-0 right-0 mt-1 rounded-xl border border-white/10 overflow-hidden z-10 shadow-2xl" style={{ background: "rgba(10,18,60,0.98)" }}>
                        {outboundSuggs.map(l => (
                          <button key={l.id} type="button" onClick={() => selectOutboundLead(l)}
                            className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-white/10 transition text-left border-b border-white/5 last:border-0">
                            <div className="w-7 h-7 rounded-full bg-white/10 flex items-center justify-center text-white/60 font-black text-xs shrink-0">
                              {(l.name || l.whatsapp_name || "?")[0].toUpperCase()}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-white/80 text-sm font-bold truncate">{l.name || l.whatsapp_name || "—"}</p>
                              <p className="text-white/30 text-[10px] font-mono">+{l.phone}</p>
                            </div>
                            {l.numero_prontuario && (
                              <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-white/10 text-white/40 shrink-0">
                                #{String(l.numero_prontuario).padStart(3,"0")}
                              </span>
                            )}
                          </button>
                        ))}
                        <button type="button" onClick={() => { setOutboundSuggs([]); }}
                          className="w-full px-3 py-2 text-center text-white/25 text-[10px] hover:bg-white/5 transition">
                          Contato novo (não listado)
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Telefone — preenchido automaticamente ou manual */}
              {!outboundLead && (
                <div>
                  <label className="text-white/40 text-[10px] font-bold uppercase tracking-wide block mb-1">Telefone WhatsApp *</label>
                  <input
                    value={outboundPhone} onChange={e => setOutboundPhone(e.target.value)}
                    placeholder="61999998888"
                    required
                    className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white text-sm placeholder-white/20 focus:outline-none focus:ring-2 focus:ring-sky-500/50"
                  />
                </div>
              )}

              <div>
                <label className="text-white/40 text-[10px] font-bold uppercase tracking-wide block mb-1">Mensagem *</label>
                <textarea
                  value={outboundText} onChange={e => setOutboundText(e.target.value)}
                  placeholder="Olá! Vi que você tem interesse em nutrição..."
                  required rows={4}
                  className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white text-sm placeholder-white/20 focus:outline-none focus:ring-2 focus:ring-sky-500/50 resize-none"
                />
              </div>
              {outboundErr && <p className="text-rose-400 text-xs font-bold">{outboundErr}</p>}
              <button type="submit" disabled={sendingOutbound || (!outboundLead && !outboundPhone.replace(/\D/g,""))}
                className="w-full py-3 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-sm font-black transition disabled:opacity-50">
                {sendingOutbound ? "Enviando..." : "📲 Enviar e Abrir Conversa"}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Chat da equipe — botão flutuante */}
      <TeamChat currentUser={user} />

      {/* Toasts de notificação da IA — canto inferior direito */}
      <div className="fixed bottom-20 right-4 z-[200] flex flex-col gap-2 pointer-events-none">
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
