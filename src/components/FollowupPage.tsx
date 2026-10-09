import { useEffect, useState, useCallback } from "react";
import {
  fetchFollowupPlans, analyzeLeadFollowup, analyzeAllFollowup,
  updateFollowupStatus, editFollowupMessage, sendMessage,
  fetchLeads,
} from "../lib/api";
import { Brain, Send, Trash2, RefreshCw, Search, Edit3, Check, X, Zap, AlertTriangle, MessageSquare, BookOpen, Gift, Users, Clock } from "lucide-react";

const TIPO_META: Record<string, { label: string; color: string; icon: string; desc: string }> = {
  isca_educacional: { label: "Isca Educacional", color: "#0ea5e9", icon: "📚", desc: "Conteúdo educativo relevante" },
  isca_promocional: { label: "Isca Promocional", color: "#f59e0b", icon: "🎁", desc: "Promoção / Condição especial" },
  reengajamento:    { label: "Reengajamento",    color: "#8b5cf6", icon: "🔄", desc: "Lead sumiu — mensagem personalizada" },
  checkin:          { label: "Check-in",         color: "#10b981", icon: "💚", desc: "Paciente em tratamento" },
  acompanhamento:   { label: "Acompanhamento",   color: "#06b6d4", icon: "👀", desc: "Lead ativo — lembrete gentil" },
  sem_acao:         { label: "Sem Ação",         color: "#6b7280", icon: "✅", desc: "Conversa já resolvida" },
};

const URGENCIA_COLOR: Record<string, string> = {
  alta:  "#ef4444",
  media: "#f59e0b",
  baixa: "#6b7280",
};

export default function FollowupPage({ onSelectLead }: { onSelectLead?: (lead: any) => void }) {
  const [plans, setPlans]             = useState<any[]>([]);
  const [loading, setLoading]         = useState(true);
  const [analyzing, setAnalyzing]     = useState<string | null>(null); // lead_id being analyzed
  const [analyzingAll, setAnalyzingAll] = useState(false);
  const [filter, setFilter]           = useState<"todos" | "pendente" | "enviado" | "descartado">("pendente");
  const [typeFilter, setTypeFilter]   = useState<string>("todos");
  const [search, setSearch]           = useState("");
  const [sending, setSending]         = useState<string | null>(null);   // plan id
  const [editingId, setEditingId]     = useState<string | null>(null);
  const [editText, setEditText]       = useState("");
  const [allLeads, setAllLeads]       = useState<any[]>([]);
  const [analyzeLeadSearch, setAnalyzeLeadSearch] = useState("");
  const [analyzeLeadResults, setAnalyzeLeadResults] = useState<any[]>([]);
  const searchTimer = useState<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const data = await fetchFollowupPlans();
    setPlans(data);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, []);

  async function handleAnalyzeOne(leadId: string) {
    setAnalyzing(leadId);
    try {
      await analyzeLeadFollowup(leadId);
      await load();
    } finally {
      setAnalyzing(null);
    }
  }

  async function handleAnalyzeAll() {
    setAnalyzingAll(true);
    try {
      await analyzeAllFollowup();
      await load();
    } finally {
      setAnalyzingAll(false);
    }
  }

  async function handleSend(plan: any) {
    const lead = plan.lead;
    if (!lead?.phone || !plan.mensagem_sugerida) return;
    setSending(plan.id);
    const ok = await sendMessage(lead.id, lead.phone, plan.mensagem_sugerida, "Maria IA");
    if (ok) {
      await updateFollowupStatus(plan.id, "enviado");
      await load();
    }
    setSending(null);
  }

  async function handleDiscard(planId: string) {
    await updateFollowupStatus(planId, "descartado");
    await load();
  }

  async function handleSaveEdit(planId: string) {
    await editFollowupMessage(planId, editText);
    setEditingId(null);
    await load();
  }

  function handleLeadSearchChange(text: string) {
    setAnalyzeLeadSearch(text);
    if (searchTimer[0]) clearTimeout(searchTimer[0]);
    if (text.trim().length >= 2) {
      (searchTimer as any)[0] = setTimeout(() =>
        fetchLeads(text).then(setAnalyzeLeadResults), 300);
    } else {
      setAnalyzeLeadResults([]);
    }
  }

  const filtered = plans.filter(p => {
    if (filter !== "todos" && p.status !== filter) return false;
    if (typeFilter !== "todos" && p.tipo !== typeFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      const nome = (p.lead?.name || p.lead?.whatsapp_name || "").toLowerCase();
      const phone = p.lead?.phone || "";
      if (!nome.includes(q) && !phone.includes(q)) return false;
    }
    return true;
  });

  const pendentes   = plans.filter(p => p.status === "pendente" && p.tipo !== "sem_acao").length;
  const enviados    = plans.filter(p => p.status === "enviado").length;
  const descartados = plans.filter(p => p.status === "descartado").length;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 px-6 py-4 border-b border-slate-200 bg-white">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2">
              <Brain size={18} className="text-violet-500" />
              <h2 className="text-slate-800 font-black text-lg leading-none">Follow-up IA — Maria</h2>
            </div>
            <p className="text-slate-500 text-xs mt-1">
              Maria analisa cada conversa e sugere a mensagem ideal. <span className="text-violet-600 font-bold">Você aprova antes de enviar.</span>
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {/* KPIs rápidos */}
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-amber-300 bg-amber-50">
              <AlertTriangle size={11} className="text-amber-500" />
              <span className="text-amber-700 font-black text-xs">{pendentes} pendentes</span>
            </div>
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-emerald-300 bg-emerald-50">
              <Send size={11} className="text-emerald-600" />
              <span className="text-emerald-700 font-black text-xs">{enviados} enviados</span>
            </div>
            {/* Analisar lead individual */}
            <div className="relative">
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl border border-slate-200 bg-slate-100">
                <Search size={11} className="text-slate-400 shrink-0" />
                <input
                  value={analyzeLeadSearch}
                  onChange={e => handleLeadSearchChange(e.target.value)}
                  placeholder="Analisar lead..."
                  className="bg-transparent text-slate-800 text-xs w-32 placeholder-slate-400 focus:outline-none"
                />
                {analyzing && <RefreshCw size={11} className="text-violet-400 animate-spin shrink-0" />}
              </div>
              {analyzeLeadResults.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 rounded-xl border border-white/10 overflow-hidden z-20 shadow-xl"
                  style={{ background: "rgba(10,18,60,0.99)" }}>
                  {analyzeLeadResults.slice(0, 5).map(l => (
                    <button key={l.id}
                      onClick={() => { handleAnalyzeOne(l.id); setAnalyzeLeadSearch(""); setAnalyzeLeadResults([]); }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-white/10 transition text-left border-b border-white/5 last:border-0">
                      <div className="w-5 h-5 rounded bg-violet-500/20 flex items-center justify-center text-violet-300 font-black text-[9px] shrink-0">
                        {(l.name || "?")[0]?.toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <p className="text-white/80 text-[11px] font-bold truncate">{l.name || l.whatsapp_name || "—"}</p>
                        <p className="text-white/30 text-[10px] font-mono">+{l.phone}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {/* Analisar Todos */}
            <button onClick={handleAnalyzeAll} disabled={analyzingAll}
              className="flex items-center gap-2 px-3 py-1.5 rounded-xl border border-violet-300 bg-violet-50 text-violet-700 text-xs font-black hover:bg-violet-100 transition disabled:opacity-50">
              <Zap size={12} className={analyzingAll ? "animate-pulse" : ""} />
              {analyzingAll ? "Analisando..." : "Analisar Todos"}
            </button>
            <button onClick={load} disabled={loading} className="p-1.5 rounded-xl bg-slate-50 border border-slate-200 hover:bg-slate-100 transition disabled:opacity-40">
              <RefreshCw size={13} className={`text-slate-400 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>

        {/* Filtros */}
        <div className="flex items-center gap-2 mt-3 flex-wrap">
          {/* Status filter */}
          {(["todos", "pendente", "enviado", "descartado"] as const).map(s => (
            <button key={s} onClick={() => setFilter(s)}
              className={`text-[10px] font-black px-2.5 py-1 rounded-lg border transition capitalize ${
                filter === s ? "bg-slate-800 border-slate-800 text-white" : "border-slate-200 text-slate-400 hover:text-slate-700"
              }`}>
              {s === "todos" ? "Todos" : s === "pendente" ? "⏳ Pendentes" : s === "enviado" ? "✅ Enviados" : "🗑 Descartados"}
            </button>
          ))}
          <div className="w-px h-4 bg-slate-200" />
          {/* Tipo filter */}
          <button onClick={() => setTypeFilter("todos")}
            className={`text-[10px] font-black px-2.5 py-1 rounded-lg border transition ${typeFilter === "todos" ? "bg-slate-800 border-slate-800 text-white" : "border-slate-200 text-slate-400 hover:text-slate-700"}`}>
            Todos tipos
          </button>
          {Object.entries(TIPO_META).filter(([k]) => k !== "sem_acao").map(([key, meta]) => (
            <button key={key} onClick={() => setTypeFilter(typeFilter === key ? "todos" : key)}
              className="text-[10px] font-black px-2.5 py-1 rounded-lg border transition"
              style={{
                background: typeFilter === key ? `${meta.color}18` : "transparent",
                borderColor: typeFilter === key ? `${meta.color}60` : "#e2e8f0",
                color: typeFilter === key ? meta.color : "#94a3b8",
              }}>
              {meta.icon} {meta.label}
            </button>
          ))}
          <div className="relative ml-auto">
            <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Buscar paciente..."
              className="pl-7 pr-3 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-800 text-[11px] placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-violet-500/40 w-40" />
          </div>
        </div>
      </div>

      {/* Lista de planos */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3 bg-slate-50 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-slate-300 [&::-webkit-scrollbar-thumb]:rounded-full">
        {loading ? (
          <div className="flex items-center justify-center py-20 gap-2 text-slate-400 text-sm">
            <RefreshCw size={15} className="animate-spin" /> Carregando planos...
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3 text-slate-300">
            <Brain size={40} strokeWidth={1} />
            <p className="text-sm font-bold">
              {plans.length === 0
                ? "Nenhum plano gerado ainda — clique em \"Analisar Todos\""
                : "Nenhum plano corresponde ao filtro"}
            </p>
          </div>
        ) : (
          filtered.map(plan => {
            const lead  = plan.lead || {};
            const nome  = lead.name || lead.whatsapp_name || `+${lead.phone}`;
            const meta  = TIPO_META[plan.tipo] || TIPO_META.sem_acao;
            const isPendente   = plan.status === "pendente";
            const isEnviado    = plan.status === "enviado";
            const isDescartado = plan.status === "descartado";
            const isSemAcao    = plan.tipo === "sem_acao";
            const isEditing    = editingId === plan.id;
            const isSending    = sending === plan.id;

            return (
              <div key={plan.id}
                className="rounded-2xl border overflow-hidden transition-all bg-white shadow-sm"
                style={{
                  borderColor: isEnviado
                    ? "rgba(16,185,129,0.35)"
                    : isDescartado
                    ? "#e2e8f0"
                    : `${meta.color}40`,
                  opacity: isDescartado ? 0.6 : 1,
                }}>

                {/* Card header */}
                <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100">
                  {/* Avatar */}
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center font-black text-sm shrink-0"
                    style={{ background: `${meta.color}20`, color: meta.color }}>
                    {nome[0]?.toUpperCase() || "?"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <button onClick={() => onSelectLead && lead.id && onSelectLead(lead)}
                        className="text-slate-800 font-black text-sm hover:text-violet-600 transition leading-none">
                        {nome}
                      </button>
                      {lead.numero_prontuario && (
                        <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">
                          #{String(lead.numero_prontuario).padStart(3, "0")}
                        </span>
                      )}
                      {/* Tipo badge */}
                      <span className="text-[9px] font-black px-2 py-0.5 rounded-full"
                        style={{ background: `${meta.color}18`, color: meta.color, border: `1px solid ${meta.color}50` }}>
                        {meta.icon} {meta.label}
                      </span>
                      {/* Urgência */}
                      {plan.urgencia && plan.urgencia !== "baixa" && !isSemAcao && (
                        <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full border"
                          style={{ color: URGENCIA_COLOR[plan.urgencia], borderColor: `${URGENCIA_COLOR[plan.urgencia]}50`, background: `${URGENCIA_COLOR[plan.urgencia]}12` }}>
                          ⚡ {plan.urgencia}
                        </span>
                      )}
                    </div>
                    <p className="text-slate-400 text-[10px] font-mono mt-0.5">+{lead.phone}</p>
                  </div>
                  {/* Status */}
                  <div className="shrink-0 text-right">
                    {isEnviado && <span className="text-[10px] font-black text-emerald-600">✅ Enviado</span>}
                    {isDescartado && <span className="text-[10px] font-black text-slate-400">🗑 Descartado</span>}
                    {isPendente && !isSemAcao && <span className="text-[10px] font-black text-amber-600 animate-pulse">⏳ Aguardando aprovação</span>}
                    {isPendente && isSemAcao && <span className="text-[10px] font-black text-slate-400">— Sem ação</span>}
                    <p className="text-slate-300 text-[9px] mt-0.5">
                      {new Date(plan.updated_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </div>
                </div>

                {/* Tags */}
                {plan.tags?.length > 0 && (
                  <div className="flex gap-1.5 px-4 py-2 flex-wrap border-b border-slate-100">
                    {plan.tags.map((tag: string) => (
                      <span key={tag} className="text-[9px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 border border-slate-200">
                        #{tag}
                      </span>
                    ))}
                  </div>
                )}

                {/* Análise da IA */}
                <div className="px-4 py-3 border-b border-slate-100 bg-violet-50/60">
                  <div className="flex items-start gap-2">
                    <Brain size={12} className="text-violet-500 shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-violet-500 text-[9px] font-black uppercase tracking-wider mb-1">Análise Maria IA</p>
                      <p className="text-slate-600 text-xs leading-relaxed">{plan.analise}</p>
                      {plan.plano && <p className="text-slate-400 text-[10px] mt-1.5 italic leading-relaxed">📋 {plan.plano}</p>}
                    </div>
                  </div>
                </div>

                {/* Mensagem sugerida */}
                {plan.mensagem_sugerida && !isSemAcao && (
                  <div className="px-4 py-3">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-slate-400 text-[9px] font-black uppercase tracking-wider">
                        💬 Mensagem sugerida — Maria vai enviar
                      </p>
                      {isPendente && !isEditing && (
                        <button onClick={() => { setEditingId(plan.id); setEditText(plan.mensagem_sugerida); }}
                          className="flex items-center gap-1 text-[9px] font-black px-2 py-0.5 rounded-lg border border-slate-200 text-slate-400 hover:text-slate-700 hover:bg-slate-50 transition">
                          <Edit3 size={9} /> Editar
                        </button>
                      )}
                    </div>

                    {isEditing ? (
                      <div className="space-y-2">
                        <textarea
                          value={editText}
                          onChange={e => setEditText(e.target.value)}
                          rows={6}
                          className="w-full px-3 py-2.5 rounded-xl bg-white border border-violet-300 text-slate-800 text-xs leading-relaxed placeholder-slate-300 focus:outline-none focus:ring-1 focus:ring-violet-500/50 resize-none"
                        />
                        <div className="flex gap-2">
                          <button onClick={() => handleSaveEdit(plan.id)}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-black"
                            style={{ background: "rgba(16,185,129,0.12)", color: "#059669", border: "1.5px solid rgba(16,185,129,0.35)" }}>
                            <Check size={11} /> Salvar
                          </button>
                          <button onClick={() => setEditingId(null)}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-black"
                            style={{ background: "#f1f5f9", color: "#64748b", border: "1.5px solid #e2e8f0" }}>
                            <X size={11} /> Cancelar
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-xl px-3.5 py-3 text-xs text-slate-700 leading-relaxed whitespace-pre-wrap font-mono border"
                        style={{ background: "rgba(139,92,246,0.06)", borderColor: "rgba(139,92,246,0.25)" }}>
                        {plan.mensagem_sugerida}
                      </div>
                    )}

                    {/* Actions */}
                    {isPendente && !isEditing && (
                      <div className="flex gap-2 mt-3">
                        <button onClick={() => handleSend(plan)} disabled={isSending}
                          className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-black transition disabled:opacity-50"
                          style={{ background: "#7c3aed", color: "#ffffff", border: "1.5px solid #7c3aed" }}>
                          <Send size={13} className={isSending ? "animate-pulse" : ""} />
                          {isSending ? "Maria enviando..." : "✓ Aprovar e Maria Envia"}
                        </button>
                        <button onClick={() => handleDiscard(plan.id)}
                          className="flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-black transition"
                          style={{ background: "#fef2f2", color: "#dc2626", border: "1.5px solid #fecaca" }}>
                          <Trash2 size={13} /> Descartar
                        </button>
                        <button onClick={() => handleAnalyzeOne(lead.id)} disabled={analyzing === lead.id}
                          title="Re-analisar conversa"
                          className="flex items-center justify-center gap-1 px-3 py-2.5 rounded-xl text-xs font-black transition"
                          style={{ background: "#f8fafc", color: "#94a3b8", border: "1.5px solid #e2e8f0" }}>
                          <RefreshCw size={12} className={analyzing === lead.id ? "animate-spin" : ""} />
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* Sem ação — só mostra analise, sem botões de envio */}
                {isSemAcao && (
                  <div className="px-4 py-2 flex items-center justify-between">
                    <p className="text-slate-300 text-[10px]">Nenhuma mensagem necessária agora</p>
                    <button onClick={() => handleDiscard(plan.id)}
                      className="text-[9px] font-black text-slate-300 hover:text-slate-500 transition">
                      Arquivar
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
