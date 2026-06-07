import { useEffect, useState, useCallback } from "react";
import {
  TrendingUp, TrendingDown, AlertTriangle, RefreshCw, Star, Target, Brain,
  Calendar, DollarSign, Activity, ChevronUp, ChevronDown, Users, Clock, Zap,
  MessageSquare, Hash, PhoneCall, CheckCircle, XCircle, Bot, Download, Search,
} from "lucide-react";
import { STAGES, fetchMessages } from "../lib/api";
import { supabase } from "../lib/supabase";

const PT_STOPWORDS = new Set([
  "a","o","e","as","os","um","uma","de","da","do","das","dos","em","na","no","nas","nos",
  "por","para","com","sem","que","se","me","te","lhe","nos","eles","elas","eu","tu",
  "ele","ela","você","nós","vocês","ao","à","pelo","pela","pelos","pelas","mais","mas",
  "oi","olá","boa","bom","tarde","manhã","noite","tudo","sim","não","né","ok","tá","só",
  "muito","pouco","bem","mal","então","porque","quando","onde","como","qual","quais",
  "já","ainda","também","só","aqui","aí","ali","lá","aqui","isso","este","esta","esse",
  "essa","aquele","aquela","meu","minha","seu","sua","nosso","nossa","este","isto",
  "foi","ser","ter","tem","tem","são","está","estou","estamos","estão","vou","vai",
  "gostaria","poderia","queria","preciso","gostara","obrigada","obrigado","boa","bom",
  "dia","olá","oi","opa","eae","alo","hey","ah","oh","hm","né","né","né","ta","tá",
]);

function extractKeywords(messages: string[]): { word: string; count: number }[] {
  const freq: Record<string, number> = {};
  for (const msg of messages) {
    const words = msg
      .toLowerCase()
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z\s]/g, " ")
      .split(/\s+/)
      .filter(w => w.length >= 4 && !PT_STOPWORDS.has(w));
    for (const w of words) freq[w] = (freq[w] || 0) + 1;
  }
  return Object.entries(freq)
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);
}

type Period = "1d" | "7d" | "30d" | "90d" | "custom";

// Normaliza variações de nome do remetente para exibição consistente
function normalizeSender(nome: string): string {
  const n = (nome || "").trim().toLowerCase();
  if (n === "maria ia" || n === "maria" || n === "ia bot" || n === "bot") return "Maria IA";
  if (n.includes("thamires") || n.includes("tamires") || n === "secretaria" || n === "secretária") return "Thamires";
  if (n.includes("mônica") || n.includes("monica")) return "Mônica";
  if (n.includes("clínica") || n.includes("clinica") || n.includes("pronutro")) return "Clínica (celular)";
  return nome.trim();
}

function BRL(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}

function todayRange() {
  const d = new Date(); d.setHours(0, 0, 0, 0);
  const from = d.toISOString();
  d.setHours(23, 59, 59, 999);
  return { from, to: d.toISOString() };
}

function yesterdayRange() {
  const d = new Date(); d.setDate(d.getDate() - 1); d.setHours(0, 0, 0, 0);
  const from = d.toISOString();
  d.setHours(23, 59, 59, 999);
  return { from, to: d.toISOString() };
}

function getDateRange(period: Period, customFrom: string, customTo: string) {
  if (period === "1d") {
    const { from, to }     = todayRange();
    const { from: pf, to: pt } = yesterdayRange();
    return { from, to, prevFrom: pf, prevTo: pt };
  }
  if (period === "custom") {
    // Garante que o range inclui o dia inteiro no horário local (sem depender de timezone)
    const [fy, fm, fd] = customFrom.split("-").map(Number);
    const [ty, tm, td] = customTo.split("-").map(Number);
    const from    = new Date(fy, fm - 1, fd, 0, 0, 0, 0);
    const to      = new Date(ty, tm - 1, td, 23, 59, 59, 999);
    const diffMs  = Math.max(to.getTime() - from.getTime(), 86400000);
    return {
      from:     from.toISOString(),
      to:       to.toISOString(),
      prevFrom: new Date(from.getTime() - diffMs).toISOString(),
      prevTo:   from.toISOString(),
    };
  }
  const now  = new Date();
  const days = period === "7d" ? 7 : period === "30d" ? 30 : 90;
  const from = new Date(now.getTime() - days * 86400000);
  return {
    from:     from.toISOString(),
    to:       now.toISOString(),
    prevFrom: new Date(from.getTime() - days * 86400000).toISOString(),
    prevTo:   from.toISOString(),
  };
}

// ── Sub-components ────────────────────────────────────────────────────────────

function DeltaBadge({ value }: { value: number }) {
  if (value === 0) return null;
  const up = value > 0;
  return (
    <span className={`flex items-center gap-0.5 text-[10px] font-black px-1.5 py-0.5 rounded-full ${up ? "bg-emerald-500/15 text-emerald-400" : "bg-rose-500/15 text-rose-400"}`}>
      {up ? <ChevronUp size={9} /> : <ChevronDown size={9} />}
      {Math.abs(value)}%
    </span>
  );
}

function KpiCard({ label, value, sub, delta, color = "emerald", icon: Icon }: {
  label: string; value: string; sub?: string; delta?: number; color?: string; icon: any;
}) {
  const g: Record<string, string> = {
    emerald: "from-emerald-500 to-teal-600",
    sky:     "from-sky-500 to-blue-600",
    amber:   "from-amber-500 to-orange-500",
    rose:    "from-rose-500 to-red-600",
    violet:  "from-violet-500 to-purple-600",
    indigo:  "from-indigo-500 to-blue-700",
  };
  return (
    <div className="rounded-2xl border border-white/10 p-4 flex flex-col gap-3" style={{ background: "rgba(255,255,255,0.04)" }}>
      <div className="flex items-center justify-between">
        <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${g[color] ?? g.emerald} flex items-center justify-center shadow-lg`}>
          <Icon size={15} className="text-white" />
        </div>
        {delta !== undefined && <DeltaBadge value={delta} />}
      </div>
      <div>
        <p className="text-white font-black text-2xl leading-none">{value}</p>
        <p className="text-white/40 text-[10px] font-bold uppercase tracking-wider mt-1">{label}</p>
        {sub && <p className="text-white/25 text-[10px] mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

function ScoreRing({ score }: { score: number }) {
  const color = score >= 70 ? "#22c55e" : score >= 45 ? "#f59e0b" : "#ef4444";
  const label = score >= 70 ? "Saudável" : score >= 45 ? "Atenção" : "Crítico";
  return (
    <div className="flex flex-col items-center gap-1 shrink-0">
      <div className="relative w-16 h-16">
        <svg viewBox="0 0 80 80" className="w-full h-full -rotate-90">
          <circle cx="40" cy="40" r="34" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="8" />
          <circle cx="40" cy="40" r="34" fill="none" stroke={color} strokeWidth="8"
            strokeDasharray={`${2 * Math.PI * 34}`}
            strokeDashoffset={`${2 * Math.PI * 34 * (1 - score / 100)}`}
            strokeLinecap="round" style={{ transition: "stroke-dashoffset 1s ease" }} />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-white font-black text-lg leading-none">{score}</span>
          <span className="text-white/40 text-[8px] font-bold">pts</span>
        </div>
      </div>
      <span className="text-[10px] font-black" style={{ color }}>{label}</span>
    </div>
  );
}

// ── Funil stages ──────────────────────────────────────────────────────────────

const FUNIL_STAGES = [
  { key: "novo_lead",      label: "Novo Lead",  color: "#16a34a" },
  { key: "maria_ia",       label: "Maria IA",   color: "#0284c7" },
  { key: "interesse_real", label: "Interesse",  color: "#d97706" },
  { key: "agendado",       label: "Agendado",   color: "#059669" },
  { key: "resolvido",      label: "Resolvido",  color: "#4f46e5" },
  { key: "perdido",        label: "Perdido",    color: "#dc2626" },
];

// ── Main component ────────────────────────────────────────────────────────────

export default function RelatorioPage() {
  const [period, setPeriod]         = useState<Period>("30d");
  const [customFrom, setCustomFrom] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  });
  const [customTo, setCustomTo]     = useState(() => new Date().toISOString().slice(0, 10));
  const [stats, setStats]           = useState<any>(null);
  const [waStats, setWaStats]       = useState<any>(null);
  const [hoje, setHoje]             = useState<any[]>([]);
  const [insight, setInsight]       = useState<any>(null);
  const [keywords, setKeywords]     = useState<{ word: string; count: number }[]>([]);
  const [loading, setLoading]       = useState(true);
  const [generating, setGenerating] = useState(false);
  const [genMsg, setGenMsg]         = useState("");

  const [reportTab, setReportTab]         = useState<"analytics" | "conversao">("analytics");
  const [convLeads, setConvLeads]         = useState<any[]>([]);
  const [convLoading, setConvLoading]     = useState(false);
  const [convFilter, setConvFilter]       = useState<"todos" | "convertidos" | "nao_convertidos">("todos");
  const [convSearch, setConvSearch]       = useState("");
  const [selectedConvLead, setSelectedConvLead] = useState<any | null>(null);
  const [convMessages, setConvMessages]         = useState<any[]>([]);
  const [convMsgLoading, setConvMsgLoading]     = useState(false);

  const loadConversao = useCallback(async () => {
    setConvLoading(true);
    const { data } = await supabase
      .from("pn_leads")
      .select("id, name, whatsapp_name, phone, numero_prontuario, stage, created_at, pn_agendamentos(id)")
      .order("numero_prontuario", { ascending: true, nullsFirst: false });
    setConvLeads(data || []);
    setConvLoading(false);
  }, []);

  useEffect(() => { if (reportTab === "conversao") loadConversao(); }, [reportTab]);

  function isConvertido(l: any): boolean {
    return (l.pn_agendamentos?.length > 0) || l.stage === "agendado" || l.stage === "resolvido";
  }

  function exportConvCSV() {
    const rows = convLeads
      .filter(l => !isConvertido(l))
      .map(l => [
        l.numero_prontuario ? `#${String(l.numero_prontuario).padStart(3,"0")}` : "—",
        l.name || l.whatsapp_name || "",
        l.phone,
        l.stage,
        new Date(l.created_at).toLocaleDateString("pt-BR"),
      ]);
    const csv = [["#","Nome","Telefone","Stage","Entrada"], ...rows].map(r => r.join(",")).join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a"); a.href = url;
    a.download = `leads-nao-convertidos-${new Date().toISOString().slice(0,10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  }

  async function openConvMessages(lead: any) {
    setSelectedConvLead(lead);
    setConvMessages([]);
    setConvMsgLoading(true);
    const msgs = await fetchMessages(lead.id);
    setConvMessages(msgs || []);
    setConvMsgLoading(false);
  }

  const load = useCallback(async () => {
    if (period === "custom" && (!customFrom || !customTo || customFrom > customTo + "z")) return;
    setLoading(true);
    const { from, to, prevFrom, prevTo } = getDateRange(period, customFrom, customTo);
    const { from: todayFrom, to: todayTo } = todayRange();

    const [agRes, prevAgRes, finRes, prevFinRes, leadsRes, hojeRes, insightRes, msgRes, waMsgRes, hojeWaMsgRes] = await Promise.all([
      supabase.from("pn_agendamentos")
        .select("status, tipo_consulta, nome_paciente, medico:pn_medicos(nome, valor, cor), lead:pn_leads(name, phone)")
        .gte("data_hora", from).lte("data_hora", to),
      supabase.from("pn_agendamentos")
        .select("status")
        .gte("data_hora", prevFrom).lte("data_hora", prevTo),
      supabase.from("pn_financeiro")
        .select("valor, medico_nome, nome_paciente, forma_pagamento")
        .gte("data_pagamento", from).lte("data_pagamento", to),
      supabase.from("pn_financeiro")
        .select("valor")
        .gte("data_pagamento", prevFrom).lte("data_pagamento", prevTo),
      supabase.from("pn_leads")
        .select("stage, created_at, ai_mode")
        .order("created_at", { ascending: false }),
      supabase.from("pn_agendamentos")
        .select("data_hora, tipo_consulta, nome_paciente, medico:pn_medicos(nome, cor), lead:pn_leads(name, phone)")
        .eq("status", "confirmado")
        .gte("data_hora", todayFrom).lte("data_hora", todayTo)
        .order("data_hora", { ascending: true }),
      supabase.from("pn_insights")
        .select("*").order("created_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("pn_mensagens")
        .select("body")
        .eq("direction", "in")
        .gte("created_at", from).lte("created_at", to)
        .limit(600),
      supabase.from("pn_mensagens")
        .select("direction, sender_nome, created_at, lead_id")
        .gte("created_at", from).lte("created_at", to)
        .limit(3000),
      // Mensagens de hoje para ranking de atendimento diário
      supabase.from("pn_mensagens")
        .select("direction, sender_nome, lead_id")
        .eq("direction", "out")
        .gte("created_at", todayFrom).lte("created_at", todayTo)
        .limit(2000),
    ]);

    const ags      = agRes.data      || [];
    const prevAgs  = prevAgRes.data  || [];
    const fins     = finRes.data     || [];
    const prevFins = prevFinRes.data || [];
    const allLeads = leadsRes.data   || [];
    const msgs     = msgRes.data     || [];

    // Financeiro
    const receita      = fins.reduce((s, f) => s + (f.valor || 0), 0);
    const prevReceita  = prevFins.reduce((s, f) => s + (f.valor || 0), 0);
    const deltaReceita = prevReceita > 0 ? Math.round((receita - prevReceita) / prevReceita * 100) : 0;

    // Agendamentos
    const confirmados = ags.filter(a => a.status === "confirmado").length;
    const realizados  = ags.filter(a => a.status === "realizado").length;
    const noShows     = ags.filter(a => a.status === "no_show").length;
    const cancelados  = ags.filter(a => a.status === "cancelado").length;
    const totalAgs    = confirmados + realizados + noShows + cancelados;
    const taxaNS      = (realizados + noShows) > 0 ? Math.round(noShows / (realizados + noShows) * 100) : 0;
    const prevTotal   = prevAgs.length;
    const deltaAgs    = prevTotal > 0 ? Math.round((totalAgs - prevTotal) / prevTotal * 100) : 0;

    // Leads por stage
    const stageCount: Record<string, number> = {};
    for (const l of allLeads) stageCount[l.stage] = (stageCount[l.stage] || 0) + 1;
    const periodFrom     = new Date(from);
    const leadsNoPeriodo = allLeads.filter(l => new Date(l.created_at) >= periodFrom).length;
    const mariaLeads     = allLeads.filter(l => l.ai_mode).length;

    // Performance por médico
    const medicoMap: Record<string, any> = {};
    for (const ag of ags) {
      const nome = (ag.medico as any)?.nome || "Sem médico";
      if (!medicoMap[nome]) medicoMap[nome] = { nome, confirmados: 0, realizados: 0, noShow: 0, cancelados: 0, receita: 0 };
      if (ag.status === "confirmado") medicoMap[nome].confirmados++;
      if (ag.status === "realizado")  medicoMap[nome].realizados++;
      if (ag.status === "no_show")    medicoMap[nome].noShow++;
      if (ag.status === "cancelado")  medicoMap[nome].cancelados++;
    }
    for (const f of fins) {
      const nome = f.medico_nome || "Sem médico";
      if (!medicoMap[nome]) medicoMap[nome] = { nome, confirmados: 0, realizados: 0, noShow: 0, cancelados: 0, receita: 0 };
      medicoMap[nome].receita += f.valor || 0;
    }
    const medicos = Object.values(medicoMap).sort((a, b) => b.receita - a.receita);

    // Formas de pagamento
    const formaMap: Record<string, number> = {};
    for (const f of fins) {
      const k = f.forma_pagamento || "Outro";
      formaMap[k] = (formaMap[k] || 0) + (f.valor || 0);
    }

    // Top tipos de consulta
    const tipoMap: Record<string, { count: number; receita: number }> = {};
    for (const ag of ags) {
      const tipo = ag.tipo_consulta || "Consulta geral";
      if (!tipoMap[tipo]) tipoMap[tipo] = { count: 0, receita: 0 };
      tipoMap[tipo].count++;
    }
    const topConsultas = Object.entries(tipoMap)
      .map(([tipo, v]) => ({ tipo, ...v }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

    // Palavras-chave das conversas
    const kw = extractKeywords(msgs.map((m: any) => m.body || ""));
    setKeywords(kw);

    // ── WhatsApp operacional ───────────────────────────────────────────────
    const waMsgs = waMsgRes.data || [];
    if (waMsgs.length > 0) {
      const hourMap: Record<number, { in: number; out: number }> = {};
      for (let h = 0; h < 24; h++) hourMap[h] = { in: 0, out: 0 };
      const senderMap: Record<string, number> = {};
      let totalIn = 0, totalOut = 0;
      const leadsComMsg      = new Set<string>();
      const leadsComResposta = new Set<string>();

      for (const m of waMsgs) {
        const d = new Date(m.created_at);
        const h = ((d.getUTCHours() - 3) + 24) % 24;
        if (m.direction === "in") {
          hourMap[h].in++;
          totalIn++;
          if (m.lead_id) leadsComMsg.add(m.lead_id);
        } else {
          hourMap[h].out++;
          totalOut++;
          if (m.lead_id) leadsComResposta.add(m.lead_id);
          const sender = normalizeSender(m.sender_nome || "Clínica (celular)");
          senderMap[sender] = (senderMap[sender] || 0) + 1;
        }
      }

      // Leads que tiveram contato humano (não Maria IA)
      const leadsComRespostaHumana = new Set<string>();
      for (const m of waMsgs) {
        if (m.direction === "out" && m.sender_nome && normalizeSender(m.sender_nome) !== "Maria IA" && m.lead_id) {
          leadsComRespostaHumana.add(m.lead_id);
        }
      }

      const semResposta  = [...leadsComMsg].filter(id => !leadsComResposta.has(id)).length;
      const pctResposta  = leadsComMsg.size > 0 ? Math.round(leadsComResposta.size / leadsComMsg.size * 100) : 0;
      const mariaOut     = senderMap["Maria IA"] || 0;
      const humanOut     = totalOut - mariaOut;
      const pctMaria     = totalOut > 0 ? Math.round(mariaOut / totalOut * 100) : 0;
      const peakIn       = Math.max(...Object.values(hourMap).map(h => h.in), 1);
      const peakHour     = Object.entries(hourMap).sort((a, b) => b[1].in - a[1].in)[0];

      // Resumo horário
      const horasComDemanda   = Object.entries(hourMap).filter(([, d]) => d.in > 0);
      const horasSemCobertura = horasComDemanda.filter(([, d]) => d.out === 0).length;
      const totalGap          = horasComDemanda.reduce((s, [, d]) => s + Math.max(d.in - d.out, 0), 0);
      const peakAM = horasComDemanda.filter(([h]) => Number(h) < 12).sort((a, b) => b[1].in - a[1].in)[0];
      const peakPM = horasComDemanda.filter(([h]) => Number(h) >= 12).sort((a, b) => b[1].in - a[1].in)[0];

      // Gráfico por dia (Brasília UTC-3)
      const dayMap: Record<string, { in: number; out: number }> = {};
      for (const m of waMsgs) {
        const brTs = new Date(new Date(m.created_at).getTime() - 3 * 3600000);
        const key = brTs.toISOString().slice(0, 10);
        if (!dayMap[key]) dayMap[key] = { in: 0, out: 0 };
        if (m.direction === "in") dayMap[key].in++;
        else dayMap[key].out++;
      }
      const dayEntries = Object.entries(dayMap).sort((a, b) => a[0].localeCompare(b[0]));
      const dayPeak    = Math.max(...dayEntries.map(([, d]) => d.in), 1);

      // Heatmap: DOW (0=Dom..6=Sab) × hora
      const heatmap: Record<number, Record<number, number>> = {};
      for (let d = 0; d < 7; d++) heatmap[d] = {};
      for (const m of waMsgs) {
        if (m.direction !== "in") continue;
        const brTs = new Date(new Date(m.created_at).getTime() - 3 * 3600000);
        const dow   = brTs.getUTCDay();
        const h     = brTs.getUTCHours();
        heatmap[dow][h] = (heatmap[dow][h] || 0) + 1;
      }
      const heatmaxVal = Math.max(...Object.values(heatmap).flatMap(row => Object.values(row)), 1);

      setWaStats({
        totalIn, totalOut, semResposta, pctResposta,
        mariaOut, humanOut, pctMaria,
        senderMap, hourMap, peakIn, peakHour,
        leadsAtivos: leadsComMsg.size,
        leadsRespondidos: leadsComResposta.size,
        leadsComRespostaHumana: leadsComRespostaHumana.size,
        horasSemCobertura, totalGap, peakAM, peakPM,
        dayEntries, dayPeak, heatmap, heatmaxVal,
      });
    } else {
      setWaStats(null);
    }

    // ── Ranking de atendimento de hoje ────────────────────────────────────────
    const hojeMsgs = hojeWaMsgRes.data || [];
    const hojeAtendMap: Record<string, { msgs: number; leads: Set<string> }> = {};
    for (const m of hojeMsgs) {
      const sender = normalizeSender(m.sender_nome || "Clínica (celular)");
      if (!hojeAtendMap[sender]) hojeAtendMap[sender] = { msgs: 0, leads: new Set() };
      hojeAtendMap[sender].msgs++;
      if (m.lead_id) hojeAtendMap[sender].leads.add(m.lead_id);
    }
    const hojeRanking = Object.entries(hojeAtendMap)
      .map(([nome, d]) => ({ nome, msgs: d.msgs, leads: d.leads.size }))
      .sort((a, b) => b.msgs - a.msgs);

    setStats({
      receita, deltaReceita, totalAgs, confirmados, realizados,
      noShows, cancelados, taxaNS, deltaAgs,
      stageCount, leadsNoPeriodo, mariaLeads, totalLeads: allLeads.length,
      medicos, formaMap, topConsultas, hojeRanking,
    });
    setHoje(hojeRes.data || []);
    setInsight(insightRes.data || null);
    setLoading(false);
  }, [period, customFrom, customTo]);

  useEffect(() => { load(); }, [load]);

  async function handleGenerate() {
    setGenerating(true);
    setGenMsg("");
    const { error } = await supabase.functions.invoke("pronutro-insights", { method: "POST" });
    if (!error) {
      setGenMsg("✅ Análise gerada!");
      await load();
    } else {
      setGenMsg("❌ Erro ao gerar.");
    }
    setGenerating(false);
    setTimeout(() => setGenMsg(""), 3000);
  }

  const maxStage = stats
    ? Math.max(...FUNIL_STAGES.map(s => stats.stageCount[s.key] || 0), 1)
    : 1;

  const periodoLabel = period === "1d" ? "hoje"
    : period === "custom"
    ? `${customFrom.split("-").reverse().join("/")} → ${customTo.split("-").reverse().join("/")}`
    : period === "7d" ? "últimos 7 dias" : period === "30d" ? "últimos 30 dias" : "últimos 90 dias";

  const convFiltered = convLeads
    .filter(l => {
      const conv = isConvertido(l);
      if (convFilter === "convertidos"    && !conv) return false;
      if (convFilter === "nao_convertidos" && conv) return false;
      if (convSearch) {
        const q = convSearch.replace(/^#/,"").toLowerCase();
        const nome = (l.name || l.whatsapp_name || "").toLowerCase();
        const num  = String(l.numero_prontuario || "");
        return nome.includes(q) || l.phone?.includes(q) || num.includes(q);
      }
      return true;
    });

  const convTotal      = convLeads.length;
  const convConv       = convLeads.filter(isConvertido).length;
  const convNao        = convTotal - convConv;
  const convTaxa       = convTotal > 0 ? Math.round(convConv / convTotal * 100) : 0;

  return (
    <div className="h-full overflow-y-auto px-4 sm:px-6 py-4 space-y-5">

      {/* Tab switcher topo */}
      <div className="flex gap-1 border-b border-white/10 pb-3">
        <button onClick={() => setReportTab("analytics")}
          className={`px-4 py-1.5 rounded-lg text-xs font-black transition ${reportTab === "analytics" ? "bg-white/15 text-white" : "text-white/40 hover:text-white/70"}`}>
          📊 Analytics
        </button>
        <button onClick={() => setReportTab("conversao")}
          className={`px-4 py-1.5 rounded-lg text-xs font-black transition ${reportTab === "conversao" ? "bg-white/15 text-white" : "text-white/40 hover:text-white/70"}`}>
          🎯 Conversão de Leads
        </button>
      </div>

      {/* ═══ TAB: CONVERSÃO ══════════════════════════════════════════════ */}
      {reportTab === "conversao" && (
        <div className="space-y-5">
          {/* KPIs */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Total Leads", value: convTotal, color: "from-sky-500 to-blue-600", icon: Users },
              { label: "Viraram Pacientes", value: convConv, color: "from-emerald-500 to-teal-600", icon: CheckCircle },
              { label: "Não Convertidos", value: convNao, color: "from-rose-500 to-red-600", icon: XCircle },
              { label: "Taxa Conversão", value: `${convTaxa}%`, color: "from-violet-500 to-purple-600", icon: Target },
            ].map(({ label, value, color, icon: Icon }) => (
              <div key={label} className="rounded-2xl border border-white/10 p-4 flex flex-col gap-3" style={{ background: "rgba(255,255,255,0.04)" }}>
                <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${color} flex items-center justify-center`}>
                  <Icon size={15} className="text-white" />
                </div>
                <div>
                  <p className="text-white font-black text-2xl leading-none">{convLoading ? "—" : value}</p>
                  <p className="text-white/40 text-[10px] font-bold uppercase tracking-wider mt-1">{label}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Filtros + busca + export */}
          <div className="flex items-center gap-2 flex-wrap">
            {[
              { key: "todos",            label: "Todos" },
              { key: "convertidos",      label: "✅ Pacientes" },
              { key: "nao_convertidos",  label: "❌ Não convertidos" },
            ].map(opt => (
              <button key={opt.key} onClick={() => setConvFilter(opt.key as any)}
                className={`text-xs font-black px-3 py-1.5 rounded-lg border transition ${
                  convFilter === opt.key
                    ? "bg-violet-600/80 text-white border-violet-500/50"
                    : "bg-white/5 text-white/40 border-white/10 hover:text-white/70"
                }`}>
                {opt.label}
              </button>
            ))}
            <div className="relative flex-1 max-w-xs">
              <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none" />
              <input value={convSearch} onChange={e => setConvSearch(e.target.value)}
                placeholder="Buscar por nome, # ou telefone..."
                className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-sm text-white placeholder-white/25 focus:outline-none focus:ring-1 focus:ring-violet-500/40" />
            </div>
            <button onClick={exportConvCSV}
              className="flex items-center gap-1.5 text-xs font-black px-3 py-1.5 rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20 transition ml-auto">
              <Download size={11} /> Exportar não convertidos
            </button>
          </div>

          {/* Tabela */}
          {convLoading ? (
            <div className="flex items-center justify-center py-16 text-white/25 text-sm">Carregando...</div>
          ) : (
            <div className="rounded-2xl border border-white/10 overflow-hidden" style={{ background: "rgba(255,255,255,0.03)" }}>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-white/8" style={{ background: "rgba(255,255,255,0.04)" }}>
                      <th className="px-4 py-2.5 text-left text-white/35 font-black uppercase tracking-wider text-[10px]">#</th>
                      <th className="px-4 py-2.5 text-left text-white/35 font-black uppercase tracking-wider text-[10px]">Nome</th>
                      <th className="px-4 py-2.5 text-left text-white/35 font-black uppercase tracking-wider text-[10px]">Telefone</th>
                      <th className="px-4 py-2.5 text-left text-white/35 font-black uppercase tracking-wider text-[10px]">Stage</th>
                      <th className="px-4 py-2.5 text-left text-white/35 font-black uppercase tracking-wider text-[10px]">Consultas</th>
                      <th className="px-4 py-2.5 text-left text-white/35 font-black uppercase tracking-wider text-[10px]">Entrada</th>
                      <th className="px-4 py-2.5 text-left text-white/35 font-black uppercase tracking-wider text-[10px]">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {convFiltered.slice(0, 200).map(l => {
                      const conv = isConvertido(l);
                      const nome = l.name || l.whatsapp_name || `+${l.phone}`;
                      const stageLabel = STAGES.find(s => s.key === l.stage)?.label || l.stage;
                      return (
                        <tr key={l.id} className="hover:bg-white/[0.06] transition cursor-pointer" onClick={() => openConvMessages(l)}>
                          <td className="px-4 py-2">
                            {l.numero_prontuario ? (
                              <span className="text-[10px] font-black px-1.5 py-0.5 rounded bg-white/10 text-white/50">
                                #{String(l.numero_prontuario).padStart(3,"0")}
                              </span>
                            ) : (
                              <span className="text-white/20">—</span>
                            )}
                          </td>
                          <td className="px-4 py-2 text-white font-bold truncate max-w-[180px]">{nome}</td>
                          <td className="px-4 py-2 text-white/40 font-mono">{l.phone}</td>
                          <td className="px-4 py-2 text-white/60">{stageLabel}</td>
                          <td className="px-4 py-2">
                            <span className={`font-black text-[11px] ${l.pn_agendamentos?.length > 0 ? "text-emerald-400" : "text-white/25"}`}>
                              {l.pn_agendamentos?.length || 0}
                            </span>
                          </td>
                          <td className="px-4 py-2 text-white/35">
                            {new Date(l.created_at).toLocaleDateString("pt-BR", { day:"2-digit", month:"2-digit", year:"2-digit" })}
                          </td>
                          <td className="px-4 py-2">
                            {conv ? (
                              <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                                ✅ Paciente
                              </span>
                            ) : (
                              <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full bg-rose-500/15 text-rose-400 border border-rose-500/25">
                                ❌ Não converteu
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {convFiltered.length > 200 && (
                  <p className="text-center text-white/25 text-[10px] py-3">
                    Mostrando 200 de {convFiltered.length} — refine a busca para ver todos
                  </p>
                )}
                {convFiltered.length === 0 && (
                  <p className="text-center text-white/25 text-sm py-10">Nenhum resultado</p>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══ TAB: ANALYTICS (conteúdo original) ════════════════════════ */}
      {reportTab === "analytics" && <>

      {/* Header ────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div>
          <h2 className="text-white font-black text-xl">Visão da Clínica</h2>
          <p className="text-white/30 text-xs mt-0.5">Dados ao vivo · {periodoLabel}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Presets */}
          <div className="flex rounded-xl overflow-hidden border border-white/10">
            <button onClick={() => setPeriod("1d")}
              className={`px-3 py-1.5 text-[11px] font-black transition ${period === "1d" ? "bg-emerald-600 text-white" : "text-white/40 hover:text-white/70"}`}>
              Hoje
            </button>
            {(["7d", "30d", "90d"] as Period[]).map(p => (
              <button key={p} onClick={() => setPeriod(p)}
                className={`px-3 py-1.5 text-[11px] font-black transition ${period === p ? "bg-violet-600 text-white" : "text-white/40 hover:text-white/70"}`}>
                {p === "7d" ? "7 dias" : p === "30d" ? "30 dias" : "90 dias"}
              </button>
            ))}
            <button onClick={() => setPeriod("custom")}
              className={`px-3 py-1.5 text-[11px] font-black transition flex items-center gap-1 ${period === "custom" ? "bg-violet-600 text-white" : "text-white/40 hover:text-white/70"}`}>
              <Calendar size={10}/> Personalizado
            </button>
          </div>

          {/* Custom date range */}
          {period === "custom" && (
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-xl border border-white/10 bg-white/3">
              <span className="text-white/30 text-[10px] font-bold shrink-0">De</span>
              <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)}
                className="bg-transparent text-white text-[11px] font-bold focus:outline-none cursor-pointer"
                style={{ colorScheme: "dark" }}/>
              <span className="text-white/20 text-[10px] shrink-0">→</span>
              <span className="text-white/30 text-[10px] font-bold shrink-0">Até</span>
              <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)}
                className="bg-transparent text-white text-[11px] font-bold focus:outline-none cursor-pointer"
                style={{ colorScheme: "dark" }}/>
            </div>
          )}

          <button onClick={load} disabled={loading}
            className="p-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 transition disabled:opacity-40">
            <RefreshCw size={13} className={`text-white/50 ${loading ? "animate-spin" : ""}`} />
          </button>
          {genMsg && <span className={`text-xs font-bold ${genMsg.startsWith("✅") ? "text-emerald-300" : "text-rose-300"}`}>{genMsg}</span>}
          <button onClick={handleGenerate} disabled={generating}
            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-black transition disabled:opacity-60">
            <Brain size={12} className={generating ? "animate-pulse" : ""} />
            {generating ? "Analisando..." : "Análise GPT"}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-24 gap-2 text-white/30 text-sm">
          <RefreshCw size={15} className="animate-spin" /> Carregando dados...
        </div>
      ) : stats ? (
        <>
          {/* WhatsApp — Demanda Operacional ────────────────────────────── */}
          {waStats && (
            <div className="space-y-4">

              {/* Título da seção */}
              <div className="flex items-center gap-2 pt-2">
                <PhoneCall size={14} className="text-emerald-400" />
                <span className="text-white font-black text-sm uppercase tracking-widest">WhatsApp — Demanda Operacional</span>
                <div className="flex-1 h-px bg-white/8 ml-2" />
                <span className="text-white/20 text-[10px]">{periodoLabel}</span>
              </div>

              {/* KPIs WhatsApp */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="rounded-2xl border border-white/10 p-4" style={{ background: "rgba(255,255,255,0.04)" }}>
                  <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-sky-500 to-blue-600 flex items-center justify-center mb-3 shadow-lg">
                    <MessageSquare size={15} className="text-white" />
                  </div>
                  <p className="text-white font-black text-2xl leading-none">{waStats.totalIn}</p>
                  <p className="text-white/40 text-[10px] font-bold uppercase tracking-wider mt-1">Msgs Recebidas</p>
                  <p className="text-white/25 text-[10px] mt-0.5">{waStats.totalOut} respondidas</p>
                </div>
                <div className="rounded-2xl border border-white/10 p-4" style={{ background: "rgba(255,255,255,0.04)" }}>
                  <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center mb-3 shadow-lg">
                    <CheckCircle size={15} className="text-white" />
                  </div>
                  <p className="text-white font-black text-2xl leading-none">{waStats.pctResposta}%</p>
                  <p className="text-white/40 text-[10px] font-bold uppercase tracking-wider mt-1">Leads Respondidos</p>
                  <p className="text-white/25 text-[10px] mt-0.5">{waStats.leadsRespondidos} de {waStats.leadsAtivos}</p>
                </div>
                <div className="rounded-2xl border border-white/10 p-4" style={{ background: "rgba(255,255,255,0.04)" }}>
                  <div className={`w-9 h-9 rounded-xl bg-gradient-to-br flex items-center justify-center mb-3 shadow-lg ${waStats.semResposta > 10 ? "from-rose-500 to-red-600" : "from-amber-500 to-orange-500"}`}>
                    <XCircle size={15} className="text-white" />
                  </div>
                  <p className={`font-black text-2xl leading-none ${waStats.semResposta > 10 ? "text-rose-400" : "text-amber-400"}`}>{waStats.semResposta}</p>
                  <p className="text-white/40 text-[10px] font-bold uppercase tracking-wider mt-1">Sem Retorno</p>
                  <p className="text-white/25 text-[10px] mt-0.5">leads sem nenhuma resposta</p>
                </div>
                <div className="rounded-2xl border border-white/10 p-4" style={{ background: "rgba(255,255,255,0.04)" }}>
                  <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center mb-3 shadow-lg">
                    <Bot size={15} className="text-white" />
                  </div>
                  <p className="text-white font-black text-2xl leading-none">{waStats.pctMaria}%</p>
                  <p className="text-white/40 text-[10px] font-bold uppercase tracking-wider mt-1">Maria IA</p>
                  <p className="text-white/25 text-[10px] mt-0.5">{waStats.mariaOut} msgs · {waStats.humanOut} manual</p>
                </div>
              </div>

              {/* Pacientes que falaram com a recepção */}
              <div className="rounded-2xl border border-emerald-500/25 p-4" style={{ background: "rgba(16,185,129,0.06)" }}>
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg shadow-emerald-500/30 shrink-0">
                    <PhoneCall size={20} className="text-white" />
                  </div>
                  <div className="flex-1">
                    <p className="text-emerald-300 font-black text-3xl leading-none">{waStats.leadsComRespostaHumana}</p>
                    <p className="text-white/60 text-xs font-black uppercase tracking-wider mt-1">Pacientes que falaram com a recepção</p>
                    <p className="text-white/25 text-[10px] mt-0.5">
                      leads com pelo menos 1 resposta humana (Mônica, Thamires ou equipe) no período
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-emerald-300 font-black text-2xl leading-none">
                      {waStats.leadsAtivos > 0 ? Math.round(waStats.leadsComRespostaHumana / waStats.leadsAtivos * 100) : 0}%
                    </p>
                    <p className="text-white/30 text-[10px] mt-0.5">dos leads ativos</p>
                    <p className="text-white/20 text-[10px]">
                      {waStats.leadsAtivos - waStats.leadsComRespostaHumana} sem contato humano
                    </p>
                  </div>
                </div>
              </div>

              {/* Dias mais movimentados */}
              {waStats.dayEntries?.length > 0 && (
                <div className="rounded-2xl border border-white/10 p-4" style={{ background: "rgba(255,255,255,0.03)" }}>
                  <div className="flex items-center gap-2 mb-4">
                    <TrendingUp size={13} className="text-sky-400" />
                    <span className="text-white/60 text-xs font-black uppercase tracking-wider">Dias Mais Movimentados</span>
                    <span className="text-white/20 text-[10px] ml-auto">{periodoLabel}</span>
                  </div>
                  <div className="space-y-1 overflow-y-auto max-h-60 pr-1">
                    {waStats.dayEntries.map(([date, d]: [string, { in: number; out: number }]) => {
                      const [yr, mo, dy] = date.split("-");
                      const dt     = new Date(`${date}T12:00:00Z`);
                      const dow    = ["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"][dt.getUTCDay()];
                      const label  = `${dow} ${dy}/${mo}`;
                      const inPct  = Math.round(d.in / waStats.dayPeak * 100);
                      const outPct = Math.round(d.out / waStats.dayPeak * 100);
                      const isPeak = d.in === waStats.dayPeak;
                      return (
                        <div key={date} className={`flex items-center gap-2 rounded-lg px-2 py-0.5 ${isPeak ? "bg-sky-500/6" : ""}`}>
                          <span className={`text-[10px] font-mono w-16 shrink-0 ${isPeak ? "text-sky-300 font-black" : "text-white/35"}`}>{label}</span>
                          <div className="flex-1 grid grid-cols-2 gap-1">
                            <div className="h-4 rounded-sm bg-white/5 relative flex items-center overflow-hidden">
                              <div className="h-full rounded-sm absolute left-0" style={{ width: `${Math.max(inPct,2)}%`, backgroundColor: "rgba(14,165,233,0.55)" }} />
                              <span className="relative z-10 text-white text-[9px] font-black px-1.5">{d.in}</span>
                            </div>
                            <div className="h-4 rounded-sm bg-white/5 relative flex items-center overflow-hidden">
                              {d.out > 0 && <div className="h-full rounded-sm absolute left-0" style={{ width: `${Math.max(outPct,2)}%`, backgroundColor: "rgba(16,185,129,0.5)" }} />}
                              <span className="relative z-10 text-white/60 text-[9px] font-black px-1.5">{d.out}</span>
                            </div>
                          </div>
                          {isPeak && <span className="text-[9px] font-black text-sky-300 shrink-0">🔥 pico</span>}
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-3 flex items-center gap-3 pt-2 border-t border-white/8">
                    <span className="flex items-center gap-1 text-[10px] text-sky-300/60"><span className="w-3 h-2 rounded-sm bg-sky-500/55 inline-block" /> Recebidas</span>
                    <span className="flex items-center gap-1 text-[10px] text-emerald-300/60"><span className="w-3 h-2 rounded-sm bg-emerald-500/50 inline-block" /> Enviadas</span>
                    <span className="text-white/20 text-[10px] ml-auto">
                      Pico: {waStats.dayPeak} msgs/dia
                    </span>
                  </div>
                </div>
              )}

              {/* Heatmap semana × hora */}
              {waStats.heatmap && (
                <div className="rounded-2xl border border-white/10 p-4" style={{ background: "rgba(255,255,255,0.03)" }}>
                  <div className="flex items-center gap-2 mb-4">
                    <Activity size={13} className="text-amber-400" />
                    <span className="text-white/60 text-xs font-black uppercase tracking-wider">Heatmap — Semana × Hora</span>
                    <span className="text-white/20 text-[10px] ml-auto">msgs recebidas</span>
                  </div>
                  {/* Legenda de horas no topo */}
                  <div className="overflow-x-auto">
                    <div className="min-w-[480px]">
                      <div className="flex items-center mb-1 gap-0.5 pl-8">
                        {Array.from({ length: 24 }, (_, h) => (
                          <div key={h} className="flex-1 text-center text-[8px] text-white/20 font-mono">{h < 10 ? `0${h}` : h}</div>
                        ))}
                      </div>
                      {[1,2,3,4,5,6,0].map(dow => {
                        const labels = ["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"];
                        const rowLabel = labels[dow];
                        const isWeekend = dow === 0 || dow === 6;
                        return (
                          <div key={dow} className="flex items-center gap-0.5 mb-0.5">
                            <span className={`text-[9px] font-black w-8 shrink-0 text-right pr-1.5 ${isWeekend ? "text-white/25" : "text-white/40"}`}>{rowLabel}</span>
                            {Array.from({ length: 24 }, (_, h) => {
                              const val     = waStats.heatmap[dow]?.[h] || 0;
                              const intense = val / waStats.heatmaxVal;
                              const bg = intense === 0
                                ? "rgba(255,255,255,0.04)"
                                : intense < 0.25
                                ? "rgba(14,165,233,0.20)"
                                : intense < 0.5
                                ? "rgba(14,165,233,0.40)"
                                : intense < 0.75
                                ? "rgba(14,165,233,0.65)"
                                : "rgba(14,165,233,0.90)";
                              return (
                                <div key={h} title={`${rowLabel} ${h}h: ${val} msgs`}
                                  className="flex-1 h-5 rounded-sm cursor-default transition-colors flex items-center justify-center"
                                  style={{ backgroundColor: bg }}
                                >
                                  {val > 0 && intense >= 0.5 && (
                                    <span className="text-white text-[7px] font-black">{val}</span>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <div className="mt-3 flex items-center gap-2 flex-wrap">
                    <span className="text-white/20 text-[10px]">Intensidade:</span>
                    {[0.15, 0.35, 0.6, 0.85].map((v, i) => (
                      <span key={i} className="flex items-center gap-1 text-[10px] text-white/40">
                        <span className="w-4 h-3 rounded-sm inline-block" style={{ backgroundColor: `rgba(14,165,233,${v})` }} />
                        {i === 0 ? "baixo" : i === 1 ? "médio" : i === 2 ? "alto" : "máximo"}
                      </span>
                    ))}
                    <span className="text-white/20 text-[10px] ml-auto">Pico: {waStats.heatmaxVal} msgs/slot</span>
                  </div>
                </div>
              )}

              {/* Demanda por hora — enriquecida */}
              <div className="rounded-2xl border border-white/10 p-4" style={{ background: "rgba(255,255,255,0.03)" }}>
                <div className="flex items-center gap-2 mb-1">
                  <Clock size={13} className="text-sky-400" />
                  <span className="text-white/60 text-xs font-black uppercase tracking-wider">Demanda por Horário</span>
                  <span className="text-white/20 text-[10px] ml-auto">Horário de Brasília</span>
                </div>

                {/* Legenda */}
                <div className="flex flex-wrap items-center gap-3 mb-4">
                  <span className="flex items-center gap-1 text-[10px] text-sky-300/70"><span className="w-3 h-2 rounded-sm bg-sky-500/60 inline-block" /> Pacientes</span>
                  <span className="flex items-center gap-1 text-[10px] text-emerald-300/70"><span className="w-3 h-2 rounded-sm bg-emerald-500/60 inline-block" /> Equipe</span>
                  <span className="flex items-center gap-1 text-[10px] text-rose-300/60"><span className="w-3 h-2 rounded-sm bg-rose-500/30 inline-block" /> Sem cobertura</span>
                  <span className="flex items-center gap-1 text-[10px] text-amber-300/60"><span className="w-3 h-2 rounded-sm bg-amber-500/30 inline-block" /> Gap parcial</span>
                </div>

                {/* Tabela de horas */}
                <div className="space-y-1 overflow-y-auto max-h-[480px] pr-1">
                  {/* Cabeçalho colunas */}
                  <div className="flex items-center gap-2 mb-2 pb-1 border-b border-white/6">
                    <span className="text-white/20 text-[9px] font-black w-6 shrink-0">H</span>
                    <div className="flex-1 grid grid-cols-2 gap-1">
                      <span className="text-white/20 text-[9px] font-black">Pacientes</span>
                      <span className="text-white/20 text-[9px] font-black">Equipe</span>
                    </div>
                    <span className="text-white/20 text-[9px] font-black w-28 text-right shrink-0">Detalhes</span>
                  </div>

                  {Array.from({ length: 24 }, (_, h) => {
                    const d = waStats.hourMap[h];
                    if (!d || (d.in === 0 && d.out === 0)) return null;
                    const inPct        = Math.round(d.in  / waStats.peakIn * 100);
                    const outPct       = Math.round(d.out / waStats.peakIn * 100);
                    const semCobertura = d.in > 0 && d.out === 0;
                    const gapParcial   = d.in > 0 && d.out > 0 && d.out < d.in * 0.5;
                    const gap          = Math.max(d.in - d.out, 0);
                    const hora         = `${String(h).padStart(2, "0")}h`;
                    const rowBg        = semCobertura
                      ? "rgba(239,68,68,0.05)"
                      : gapParcial
                      ? "rgba(245,158,11,0.04)"
                      : "transparent";

                    return (
                      <div key={h} className="flex items-center gap-2 rounded-lg px-1 py-0.5 transition-colors" style={{ background: rowBg }}>
                        <span className="text-white/40 text-[10px] font-mono font-black w-6 shrink-0">{hora}</span>

                        <div className="flex-1 grid grid-cols-2 gap-1">
                          {/* Barra pacientes */}
                          <div className="h-4 rounded-sm overflow-hidden bg-white/5 relative flex items-center">
                            <div
                              className="h-full rounded-sm transition-all duration-700 absolute left-0 top-0"
                              style={{
                                width: `${Math.max(inPct, 3)}%`,
                                backgroundColor: semCobertura ? "rgba(239,68,68,0.55)" : "rgba(14,165,233,0.55)",
                              }}
                            />
                            <span className="relative z-10 text-white text-[9px] font-black px-1.5 drop-shadow-sm">{d.in}</span>
                          </div>
                          {/* Barra equipe */}
                          <div className="h-4 rounded-sm overflow-hidden bg-white/5 relative flex items-center">
                            {d.out > 0 && (
                              <div
                                className="h-full rounded-sm transition-all duration-700 absolute left-0 top-0"
                                style={{ width: `${Math.max(outPct, 3)}%`, backgroundColor: "rgba(16,185,129,0.55)" }}
                              />
                            )}
                            <span className="relative z-10 text-white text-[9px] font-black px-1.5 drop-shadow-sm">{d.out}</span>
                          </div>
                        </div>

                        {/* Coluna de detalhe */}
                        <div className="w-28 flex items-center justify-end gap-1 shrink-0">
                          {semCobertura && (
                            <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/30 whitespace-nowrap">
                              🚫 sem cob.
                            </span>
                          )}
                          {gapParcial && !semCobertura && (
                            <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/25 whitespace-nowrap">
                              ⚠ gap {gap}
                            </span>
                          )}
                          {!semCobertura && !gapParcial && d.in > 0 && (
                            <span className="text-[9px] text-emerald-400/60 font-mono">✓ {d.in}/{d.out}</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Resumo estatístico */}
                <div className="mt-4 pt-3 border-t border-white/8 grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="text-center">
                    <p className="text-sky-300 font-black text-lg leading-none">
                      {waStats.peakAM ? `${String(Number(waStats.peakAM[0])).padStart(2,"0")}h` : "—"}
                    </p>
                    <p className="text-white/30 text-[10px] font-bold mt-0.5">Pico manhã</p>
                    {waStats.peakAM && <p className="text-white/20 text-[9px]">{waStats.peakAM[1].in} msgs</p>}
                  </div>
                  <div className="text-center">
                    <p className="text-amber-300 font-black text-lg leading-none">
                      {waStats.peakPM ? `${String(Number(waStats.peakPM[0])).padStart(2,"0")}h` : "—"}
                    </p>
                    <p className="text-white/30 text-[10px] font-bold mt-0.5">Pico tarde/noite</p>
                    {waStats.peakPM && <p className="text-white/20 text-[9px]">{waStats.peakPM[1].in} msgs</p>}
                  </div>
                  <div className="text-center">
                    <p className={`font-black text-lg leading-none ${waStats.horasSemCobertura > 3 ? "text-rose-400" : "text-amber-400"}`}>
                      {waStats.horasSemCobertura}h
                    </p>
                    <p className="text-white/30 text-[10px] font-bold mt-0.5">Sem cobertura</p>
                    <p className="text-white/20 text-[9px]">horas com demanda e 0 respostas</p>
                  </div>
                  <div className="text-center">
                    <p className={`font-black text-lg leading-none ${waStats.totalGap > 20 ? "text-rose-400" : waStats.totalGap > 10 ? "text-amber-400" : "text-emerald-400"}`}>
                      {waStats.totalGap}
                    </p>
                    <p className="text-white/30 text-[10px] font-bold mt-0.5">Gap total</p>
                    <p className="text-white/20 text-[9px]">msgs recebidas sem resposta</p>
                  </div>
                </div>
              </div>

              {/* Quem atendeu */}
              <div className="rounded-2xl border border-white/10 p-4" style={{ background: "rgba(255,255,255,0.03)" }}>
                <div className="flex items-center gap-2 mb-4">
                  <Bot size={13} className="text-violet-400" />
                  <span className="text-white/60 text-xs font-black uppercase tracking-wider">Quem Atendeu</span>
                  <span className="text-white/20 text-[10px] ml-auto">{waStats.totalOut} mensagens enviadas</span>
                </div>

                {/* Barra Maria vs Manual */}
                <div className="mb-4">
                  <div className="flex justify-between text-[10px] font-bold mb-1.5">
                    <span className="text-violet-400">🤖 Maria IA — {waStats.pctMaria}%</span>
                    <span className="text-emerald-400">💬 Equipe Manual — {100 - waStats.pctMaria}%</span>
                  </div>
                  <div className="h-4 rounded-full overflow-hidden bg-white/5 flex">
                    <div className="h-full bg-gradient-to-r from-violet-600 to-purple-500 transition-all duration-700 flex items-center justify-center"
                      style={{ width: `${waStats.pctMaria}%` }}>
                      {waStats.pctMaria >= 10 && <span className="text-white text-[9px] font-black">{waStats.pctMaria}%</span>}
                    </div>
                    <div className="h-full bg-gradient-to-r from-emerald-600 to-teal-500 flex-1 flex items-center justify-center">
                      <span className="text-white text-[9px] font-black">{100 - waStats.pctMaria}%</span>
                    </div>
                  </div>
                  <p className="text-white/20 text-[10px] mt-1.5">
                    {waStats.pctMaria < 30
                      ? "⚠ Equipe sobrecarregada — Maria está cobrindo menos de 30% do atendimento"
                      : waStats.pctMaria < 60
                      ? "Maria cobre parte do atendimento — há espaço para expandir a automação"
                      : "Boa cobertura automatizada"}
                  </p>
                </div>

                {/* Por atendente */}
                <div className="space-y-2 border-t border-white/8 pt-3">
                  {Object.entries(waStats.senderMap as Record<string, number>)
                    .sort((a, b) => (b[1] as number) - (a[1] as number))
                    .filter(([nome]) => !["Bruno", "Claude", "bruno", "claude"].includes(nome.toLowerCase()))
                    .map(([nome, total]) => {
                      const pct     = waStats.totalOut > 0 ? Math.round((total as number) / waStats.totalOut * 100) : 0;
                      const isMaria = nome === "Maria IA";
                      const isCelular = nome === "Clínica (celular)";
                      return (
                        <div key={nome} className="flex items-center gap-3">
                          <span className={`text-[10px] font-bold w-36 truncate shrink-0 ${isMaria ? "text-violet-300" : isCelular ? "text-amber-300" : "text-emerald-300"}`}>
                            {isMaria ? "🤖" : isCelular ? "📱" : "💬"} {nome}
                          </span>
                          <div className="flex-1 h-3 rounded-full overflow-hidden bg-white/5">
                            <div className="h-full rounded-full transition-all duration-700"
                              style={{
                                width: `${Math.max(pct, 2)}%`,
                                background: isMaria ? "rgba(139,92,246,0.6)" : isCelular ? "rgba(245,158,11,0.6)" : "rgba(16,185,129,0.6)",
                              }} />
                          </div>
                          <span className="text-white/40 text-[10px] font-mono w-12 text-right shrink-0">{total as number} msg</span>
                          <span className="text-white/20 text-[10px] w-8 text-right shrink-0">{pct}%</span>
                        </div>
                      );
                    })}
                </div>
              </div>
            </div>
          )}

          {/* Ranking de atendimento hoje ───────────────────────────────── */}
          {stats.hojeRanking?.length > 0 && (
            <div className="rounded-2xl border border-white/10 p-4" style={{ background: "rgba(255,255,255,0.03)" }}>
              <div className="flex items-center gap-2 mb-4">
                <Users size={13} className="text-emerald-400" />
                <span className="text-white font-black text-sm uppercase tracking-widest">Atendimento de Hoje</span>
                <div className="flex-1 h-px bg-white/8 ml-2" />
                <span className="text-white/20 text-[10px]">{new Date().toLocaleDateString("pt-BR", { weekday:"long", day:"numeric", month:"long" })}</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {stats.hojeRanking.map((r: any, i: number) => {
                  const isMaria   = r.nome === "Maria IA";
                  const isCelular = r.nome === "Clínica (celular)";
                  const maxMsgs   = stats.hojeRanking[0]?.msgs || 1;
                  const pct       = Math.round(r.msgs / maxMsgs * 100);
                  const MEDAL     = ["🥇","🥈","🥉"];
                  const color     = isMaria ? "#7c3aed" : isCelular ? "#d97706" : "#059669";
                  return (
                    <div key={r.nome} className="rounded-2xl border border-white/10 p-4 flex flex-col gap-2" style={{ background: "rgba(255,255,255,0.04)" }}>
                      <div className="flex items-center justify-between">
                        <span className="text-white font-black text-xs truncate">
                          {MEDAL[i] ?? "👤"} {r.nome}
                        </span>
                        {i === 0 && <span className="text-[9px] font-black text-amber-400 shrink-0">TOP</span>}
                      </div>
                      <div>
                        <p className="text-white font-black text-2xl leading-none">{r.leads}</p>
                        <p className="text-white/30 text-[10px] font-bold mt-0.5">
                          {r.leads === 1 ? "paciente atendido" : "pacientes atendidos"}
                        </p>
                        <p className="text-white/20 text-[10px]">{r.msgs} mensagens enviadas</p>
                      </div>
                      <div className="h-1.5 rounded-full bg-white/8">
                        <div className="h-full rounded-full transition-all duration-700"
                          style={{ width: `${pct}%`, backgroundColor: color + "cc" }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* KPIs ──────────────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <KpiCard label="Receita no Período" icon={DollarSign} color="emerald"
              value={BRL(stats.receita)} delta={stats.deltaReceita}
              sub={stats.deltaReceita !== 0 ? "vs período anterior" : undefined} />
            <KpiCard label="Consultas" icon={Calendar} color="sky"
              value={String(stats.totalAgs)} delta={stats.deltaAgs}
              sub={`${stats.realizados} realizadas · ${stats.confirmados} confirmadas`} />
            <KpiCard label="Taxa No-Show" icon={AlertTriangle}
              color={stats.taxaNS >= 20 ? "rose" : stats.taxaNS >= 10 ? "amber" : "emerald"}
              value={`${stats.taxaNS}%`}
              sub={`${stats.noShows} faltas · ref. ≤ 10%`} />
            <KpiCard label="Novos Leads" icon={Users} color="indigo"
              value={String(stats.leadsNoPeriodo)}
              sub={`${stats.totalLeads} total no sistema`} />
            <KpiCard label="Maria Ativa" icon={Brain} color="violet"
              value={String(stats.mariaLeads)}
              sub={`${stats.totalLeads > 0 ? Math.round(stats.mariaLeads / stats.totalLeads * 100) : 0}% dos leads`} />
          </div>

          {/* Agenda hoje + Funil ────────────────────────────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

            {/* Agenda do dia */}
            <div className="rounded-2xl border border-white/10 overflow-hidden" style={{ background: "rgba(255,255,255,0.03)" }}>
              <div className="px-4 py-3 border-b border-white/8 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Clock size={13} className="text-sky-400" />
                  <span className="text-white/60 text-xs font-black uppercase tracking-wider">Agenda de Hoje</span>
                </div>
                <span className="text-[10px] text-white/25 font-bold">
                  {new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" })}
                </span>
              </div>
              {hoje.length === 0 ? (
                <div className="px-4 py-10 text-center text-white/20 text-sm">Nenhuma consulta confirmada hoje</div>
              ) : (
                <div className="divide-y divide-white/5 max-h-72 overflow-y-auto">
                  {hoje.map((ag, i) => {
                    const hora  = new Date(ag.data_hora).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
                    const nome  = ag.nome_paciente || (ag.lead as any)?.name || (ag.lead as any)?.phone || "—";
                    const medico = ag.medico as any;
                    const agora = new Date();
                    const agHora = new Date(ag.data_hora);
                    const isPast = agHora < agora;
                    const isNext = !isPast && i === hoje.findIndex((a: any) => new Date(a.data_hora) >= agora);
                    return (
                      <div key={i} className={`px-4 py-3 flex items-center gap-3 ${isNext ? "bg-sky-500/5" : ""}`}>
                        <div className="shrink-0 text-center w-12">
                          <p className={`font-black text-sm ${isPast ? "text-white/30" : isNext ? "text-sky-300" : "text-white"}`}>{hora}</p>
                          {isNext && <span className="text-[8px] font-black text-sky-400 uppercase">Próxima</span>}
                        </div>
                        <div className="w-0.5 h-8 rounded-full shrink-0" style={{ backgroundColor: medico?.cor || "#6366f1" }} />
                        <div className="min-w-0 flex-1">
                          <p className={`text-xs font-bold truncate ${isPast ? "text-white/40" : "text-white"}`}>{nome}</p>
                          <p className="text-white/30 text-[10px] truncate">{medico?.nome ?? "—"} · {ag.tipo_consulta || "Consulta"}</p>
                        </div>
                        {isPast && <span className="shrink-0 text-[9px] font-black text-white/20 bg-white/5 px-1.5 py-0.5 rounded-full">Passada</span>}
                      </div>
                    );
                  })}
                </div>
              )}
              <div className="px-4 py-2 border-t border-white/5 flex items-center justify-between">
                <span className="text-white/20 text-[10px]">Total hoje: {hoje.length} consulta(s)</span>
                {hoje.length > 0 && (
                  <span className="text-emerald-400 text-[10px] font-bold">
                    {BRL(hoje.reduce((s: number, ag: any) => s + ((ag.medico as any)?.valor || 0), 0))} previsto
                  </span>
                )}
              </div>
            </div>

            {/* Funil de pacientes */}
            <div className="rounded-2xl border border-white/10 p-4 flex flex-col" style={{ background: "rgba(255,255,255,0.03)" }}>
              <div className="flex items-center gap-2 mb-4">
                <Activity size={13} className="text-amber-400" />
                <span className="text-white/60 text-xs font-black uppercase tracking-wider">Funil de Pacientes</span>
                <span className="text-white/20 text-[10px] ml-auto">{stats.totalLeads} total</span>
              </div>
              <div className="flex-1 flex flex-col justify-center space-y-2.5">
                {FUNIL_STAGES.map(s => {
                  const val      = stats.stageCount[s.key] || 0;
                  const barPct   = Math.round(val / maxStage * 100);
                  const pctTotal = stats.totalLeads > 0 ? Math.round(val / stats.totalLeads * 100) : 0;
                  return (
                    <div key={s.key} className="flex items-center gap-3">
                      <p className="text-white/40 text-[10px] font-bold w-20 shrink-0 text-right leading-tight">{s.label}</p>
                      <div className="flex-1 h-6 rounded-lg overflow-hidden" style={{ background: "rgba(255,255,255,0.05)" }}>
                        <div className="h-full rounded-lg flex items-center px-2.5 gap-2 transition-all duration-700"
                          style={{ width: `${Math.max(barPct, 5)}%`, backgroundColor: s.color + "cc" }}>
                          <span className="text-white font-black text-[10px] shrink-0">{val}</span>
                        </div>
                      </div>
                      <span className="text-white/25 text-[10px] w-8 text-right">{pctTotal}%</span>
                    </div>
                  );
                })}
              </div>
              <div className="mt-4 pt-3 border-t border-white/8 flex items-center justify-between">
                <span className="text-white/30 text-[10px] font-bold">Lead → Agendado</span>
                {(() => {
                  const ag   = stats.stageCount["agendado"] || 0;
                  const conv = stats.totalLeads > 0 ? Math.round(ag / stats.totalLeads * 100) : 0;
                  return (
                    <span className={`text-base font-black ${conv >= 30 ? "text-emerald-400" : conv >= 15 ? "text-amber-400" : "text-rose-400"}`}>
                      {conv}%
                    </span>
                  );
                })()}
              </div>
            </div>
          </div>

          {/* Formas de pagamento ────────────────────────────────────────── */}
          {Object.keys(stats.formaMap).length > 0 && (
            <div className="rounded-2xl border border-white/10 p-4" style={{ background: "rgba(255,255,255,0.03)" }}>
              <div className="flex items-center gap-2 mb-4">
                <TrendingUp size={13} className="text-emerald-400" />
                <span className="text-white/60 text-xs font-black uppercase tracking-wider">Receita por Forma de Pagamento</span>
                <span className="text-emerald-300 font-black text-xs ml-auto">{BRL(stats.receita)} total</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {Object.entries(stats.formaMap)
                  .sort((a, b) => (b[1] as number) - (a[1] as number))
                  .map(([forma, valor]) => {
                    const pctVal = stats.receita > 0 ? Math.round((valor as number) / stats.receita * 100) : 0;
                    return (
                      <div key={forma} className="flex-1 min-w-28 rounded-xl border border-white/8 p-3" style={{ background: "rgba(255,255,255,0.02)" }}>
                        <p className="text-white font-black text-lg leading-none">{BRL(valor as number)}</p>
                        <p className="text-white/40 text-[10px] font-bold uppercase tracking-wide mt-1">{forma}</p>
                        <div className="mt-2 h-1 rounded-full bg-white/8">
                          <div className="h-full rounded-full bg-emerald-500 transition-all duration-700" style={{ width: `${pctVal}%` }} />
                        </div>
                        <p className="text-white/20 text-[10px] mt-1">{pctVal}% da receita</p>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}

          {/* O que mais vende ──────────────────────────────────────────── */}
          {stats.topConsultas?.length > 0 && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

              {/* Top consultas */}
              <div className="rounded-2xl border border-white/10 p-4" style={{ background: "rgba(255,255,255,0.03)" }}>
                <div className="flex items-center gap-2 mb-4">
                  <TrendingUp size={13} className="text-emerald-400" />
                  <span className="text-white/60 text-xs font-black uppercase tracking-wider">O que mais vende</span>
                  <span className="text-white/20 text-[10px] ml-auto">{stats.totalAgs} agendamentos</span>
                </div>
                <div className="space-y-2.5">
                  {stats.topConsultas.map((t: any, i: number) => {
                    const maxC = stats.topConsultas[0]?.count || 1;
                    const bar  = Math.round(t.count / maxC * 100);
                    const COLORS = ["#22c55e","#0ea5e9","#f59e0b","#a78bfa","#f97316","#06b6d4","#e11d48","#84cc16"];
                    return (
                      <div key={t.tipo} className="flex items-center gap-3">
                        <span className="text-white/20 text-[10px] font-black w-4 text-right shrink-0">{i + 1}</span>
                        <div className="flex-1">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-white/70 text-[11px] font-bold truncate">{t.tipo}</span>
                            <span className="text-white font-black text-xs ml-2 shrink-0">{t.count}x</span>
                          </div>
                          <div className="h-1.5 rounded-full bg-white/8">
                            <div className="h-full rounded-full transition-all duration-700"
                              style={{ width: `${bar}%`, backgroundColor: COLORS[i % COLORS.length] }} />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* O que as pessoas mais pedem (keywords) */}
              <div className="rounded-2xl border border-white/10 p-4" style={{ background: "rgba(255,255,255,0.03)" }}>
                <div className="flex items-center gap-2 mb-4">
                  <MessageSquare size={13} className="text-sky-400" />
                  <span className="text-white/60 text-xs font-black uppercase tracking-wider">O que as pessoas mais pedem</span>
                  <span className="text-white/20 text-[10px] ml-auto">via WhatsApp</span>
                </div>
                {keywords.length === 0 ? (
                  <p className="text-white/20 text-sm text-center py-6">Sem mensagens no período</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {keywords.map((kw, i) => {
                      const maxK = keywords[0]?.count || 1;
                      const intensity = Math.round(kw.count / maxK * 100);
                      const size = intensity >= 80 ? "text-base" : intensity >= 50 ? "text-sm" : intensity >= 30 ? "text-xs" : "text-[10px]";
                      const bg   = intensity >= 80 ? "bg-sky-500/25 border-sky-500/40 text-sky-200"
                                 : intensity >= 50 ? "bg-sky-500/15 border-sky-500/25 text-sky-300"
                                 : intensity >= 30 ? "bg-white/8 border-white/15 text-white/50"
                                 :                   "bg-white/4 border-white/8 text-white/30";
                      return (
                        <span key={i} className={`px-2.5 py-1 rounded-full border font-bold ${size} ${bg} flex items-center gap-1`}>
                          <Hash size={9} className="opacity-50" />
                          {kw.word}
                          <span className="opacity-50 text-[9px] font-black ml-0.5">{kw.count}</span>
                        </span>
                      );
                    })}
                  </div>
                )}
                <p className="text-white/15 text-[10px] mt-3">Palavras mais frequentes nas mensagens recebidas dos pacientes</p>
              </div>
            </div>
          )}

          {/* Briefing GPT (se disponível) ──────────────────────────────── */}
          {insight ? (
            <div className="rounded-2xl border border-violet-500/25 p-5" style={{ background: "rgba(109,40,217,0.06)" }}>
              <div className="flex items-start gap-4">
                <ScoreRing score={insight.score_saude ?? 0} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <Brain size={13} className="text-violet-400" />
                    <span className="text-violet-300 text-[10px] font-black uppercase tracking-wider">Briefing Executivo · GPT-4o</span>
                    <span className="text-white/20 text-[10px] ml-auto">
                      {new Date(insight.created_at).toLocaleString("pt-BR")}
                    </span>
                  </div>
                  <p className="text-white/80 text-sm leading-relaxed mb-3">{insight.briefing}</p>
                  <div className="flex flex-col gap-2 mb-3">
                    {insight.alerta && (
                      <div className="flex items-start gap-2 px-3 py-2 rounded-xl bg-rose-500/10 border border-rose-500/20">
                        <TrendingDown size={12} className="text-rose-400 shrink-0 mt-0.5" />
                        <p className="text-rose-300 text-xs font-bold">{insight.alerta}</p>
                      </div>
                    )}
                    {insight.recomendacao && (
                      <div className="flex items-start gap-2 px-3 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                        <Target size={12} className="text-emerald-400 shrink-0 mt-0.5" />
                        <p className="text-emerald-300 text-xs font-bold">{insight.recomendacao}</p>
                      </div>
                    )}
                  </div>
                  {Array.isArray(insight.bullets) && insight.bullets.length > 0 && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {insight.bullets.map((b: string, i: number) => (
                        <div key={i} className="flex items-start gap-2 px-3 py-2 rounded-xl border border-white/6" style={{ background: "rgba(255,255,255,0.02)" }}>
                          <Zap size={11} className="text-amber-400 shrink-0 mt-0.5" />
                          <p className="text-white/60 text-xs leading-relaxed">{b}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-violet-500/15 p-5 flex items-center gap-4" style={{ background: "rgba(109,40,217,0.04)" }}>
              <Brain size={28} className="text-violet-400/40 shrink-0" />
              <div>
                <p className="text-white/40 text-sm font-bold">Análise GPT não gerada ainda</p>
                <p className="text-white/20 text-xs mt-0.5">Clique em "Análise GPT" para o GPT-4o gerar um briefing executivo completo com score de saúde e recomendações.</p>
              </div>
            </div>
          )}

          {/* Performance por médico — cards compactos ───────────────────── */}
          {stats.medicos.length > 0 && (
            <div className="rounded-2xl border border-white/10 p-4" style={{ background: "rgba(255,255,255,0.03)" }}>
              <div className="flex items-center gap-2 mb-4">
                <Star size={13} className="text-amber-400" />
                <span className="text-white/60 text-xs font-black uppercase tracking-wider">Performance por Médico</span>
                <span className="text-white/20 text-[10px] ml-auto">{periodoLabel}</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {stats.medicos.map((med: any, i: number) => {
                  const total = med.realizados + med.noShow;
                  const txNS  = total > 0 ? Math.round(med.noShow / total * 100) : 0;
                  const CORES = ["#22c55e","#0ea5e9","#f59e0b","#a78bfa","#f97316","#06b6d4"];
                  return (
                    <div key={med.nome} className="rounded-2xl border border-white/10 p-4 flex flex-col gap-2.5" style={{ background: "rgba(255,255,255,0.04)" }}>
                      <div className="flex items-center gap-2">
                        <div className="w-1.5 h-6 rounded-full shrink-0" style={{ backgroundColor: CORES[i % CORES.length] }} />
                        <p className="text-white font-black text-xs truncate leading-tight">{med.nome}</p>
                        {i === 0 && <Star size={9} className="text-amber-400 ml-auto shrink-0" />}
                      </div>
                      <div className="space-y-1 border-t border-white/8 pt-2">
                        <div className="flex justify-between text-[10px]">
                          <span className="text-white/30">Realizadas</span>
                          <span className="text-white font-black">{med.realizados}</span>
                        </div>
                        <div className="flex justify-between text-[10px]">
                          <span className="text-white/30">Confirmadas</span>
                          <span className="text-sky-300 font-black">{med.confirmados}</span>
                        </div>
                        <div className="flex justify-between text-[10px]">
                          <span className="text-white/30">No-show</span>
                          <span className={`font-black ${txNS >= 20 ? "text-rose-400" : txNS >= 10 ? "text-amber-400" : "text-emerald-400"}`}>
                            {txNS}%
                          </span>
                        </div>
                        {med.receita > 0 && (
                          <div className="flex justify-between text-[10px] pt-1 border-t border-white/5">
                            <span className="text-white/30">Receita</span>
                            <span className="text-emerald-400 font-black">{BRL(med.receita)}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Footer ─────────────────────────────────────────────────────── */}
          <div className="rounded-xl border border-white/6 px-4 py-3" style={{ background: "rgba(255,255,255,0.02)" }}>
            <p className="text-white/15 text-[10px] leading-relaxed">
              Dados ao vivo do Supabase · Período: {periodoLabel} · Análise GPT: {insight ? new Date(insight.created_at).toLocaleString("pt-BR") : "nunca gerada"}
            </p>
          </div>
        </>
      ) : null}
      </>}

      {/* Modal histórico de mensagens */}
      {selectedConvLead && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,10,0.82)", backdropFilter: "blur(8px)" }}
          onClick={e => { if (e.target === e.currentTarget) setSelectedConvLead(null); }}>
          <div className="w-full max-w-lg rounded-2xl border border-white/10 overflow-hidden flex flex-col"
            style={{ background: "rgba(10,18,48,0.99)", maxHeight: "85vh" }}>

            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/8 shrink-0"
              style={{ background: "rgba(255,255,255,0.03)" }}>
              <div className="flex items-center gap-2.5">
                <MessageSquare size={15} className="text-violet-400" />
                <div>
                  <p className="text-white font-black text-sm leading-none">
                    {selectedConvLead.name || selectedConvLead.whatsapp_name || `+${selectedConvLead.phone}`}
                  </p>
                  <p className="text-white/30 text-[10px] mt-0.5 font-mono">+{selectedConvLead.phone}</p>
                </div>
              </div>
              <button onClick={() => setSelectedConvLead(null)}
                className="p-1.5 rounded-lg hover:bg-white/10 text-white/40 transition">
                <XCircle size={15} />
              </button>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2.5 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-white/10 [&::-webkit-scrollbar-thumb]:rounded-full">
              {convMsgLoading ? (
                <div className="flex items-center justify-center py-12 text-white/25 text-sm gap-2">
                  <RefreshCw size={14} className="animate-spin" /> Carregando mensagens...
                </div>
              ) : convMessages.length === 0 ? (
                <div className="text-center py-12 text-white/20 text-sm">Nenhuma mensagem encontrada</div>
              ) : convMessages.map((msg: any, i: number) => {
                const isIn = msg.direction === "in";
                const isMaria = !isIn && normalizeSender(msg.sender_nome || "") === "Maria IA";
                const sender = isIn ? "Paciente" : normalizeSender(msg.sender_nome || "Clínica");
                const time = new Date(msg.created_at).toLocaleString("pt-BR", {
                  day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit"
                });
                return (
                  <div key={i} className={`flex ${isIn ? "justify-start" : "justify-end"}`}>
                    <div className={`max-w-[82%] rounded-2xl px-3.5 py-2.5 ${
                      isIn
                        ? "rounded-tl-sm"
                        : isMaria
                        ? "rounded-tr-sm"
                        : "rounded-tr-sm"
                    }`}
                      style={{
                        background: isIn
                          ? "rgba(255,255,255,0.07)"
                          : isMaria
                          ? "rgba(139,92,246,0.22)"
                          : "rgba(5,150,105,0.22)",
                        border: `1px solid ${isIn ? "rgba(255,255,255,0.08)" : isMaria ? "rgba(139,92,246,0.3)" : "rgba(16,185,129,0.3)"}`,
                      }}>
                      <p className="text-[9px] font-black mb-1 opacity-60"
                        style={{ color: isIn ? "#94a3b8" : isMaria ? "#c4b5fd" : "#6ee7b7" }}>
                        {isIn ? "👤" : isMaria ? "🤖" : "💬"} {sender}
                      </p>
                      <p className="text-white text-xs leading-relaxed whitespace-pre-wrap break-words">{msg.body}</p>
                      <p className="text-[9px] mt-1.5 opacity-40 text-right">{time}</p>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Footer */}
            <div className="shrink-0 px-5 py-3 border-t border-white/8 flex items-center justify-between"
              style={{ background: "rgba(255,255,255,0.02)" }}>
              <span className="text-white/25 text-[10px]">{convMessages.length} mensagens</span>
              <button onClick={() => setSelectedConvLead(null)}
                className="px-4 py-1.5 rounded-lg text-xs font-black border border-white/10 text-white/50 hover:bg-white/10 transition">
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
