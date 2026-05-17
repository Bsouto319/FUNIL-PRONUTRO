import { useEffect, useState } from "react";
import { TrendingUp, TrendingDown, AlertTriangle, Zap, RefreshCw, Star, Target, Brain } from "lucide-react";
import { fetchLatestInsight, generateInsight } from "../lib/api";

function BRL(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}

function ScoreRing({ score }: { score: number }) {
  const color = score >= 70 ? "#22c55e" : score >= 45 ? "#f59e0b" : "#ef4444";
  const label = score >= 70 ? "Saudável" : score >= 45 ? "Atenção" : "Crítico";
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative w-20 h-20">
        <svg viewBox="0 0 80 80" className="w-full h-full -rotate-90">
          <circle cx="40" cy="40" r="34" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="8" />
          <circle cx="40" cy="40" r="34" fill="none" stroke={color} strokeWidth="8"
            strokeDasharray={`${2 * Math.PI * 34}`}
            strokeDashoffset={`${2 * Math.PI * 34 * (1 - score / 100)}`}
            strokeLinecap="round" style={{ transition: "stroke-dashoffset 1s ease" }} />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-white font-black text-xl leading-none">{score}</span>
          <span className="text-white/40 text-[9px] font-bold">pts</span>
        </div>
      </div>
      <span className="text-xs font-black" style={{ color }}>{label}</span>
    </div>
  );
}

function MetricCard({ label, value, sub, color = "emerald", icon: Icon }: {
  label: string; value: string; sub?: string; color?: string; icon: any;
}) {
  const colors: Record<string, string> = {
    emerald: "from-emerald-500 to-teal-600", sky: "from-sky-500 to-blue-600",
    amber: "from-amber-500 to-orange-500", rose: "from-rose-500 to-red-600",
    violet: "from-violet-500 to-purple-600",
  };
  return (
    <div className="rounded-xl border border-white/10 p-4 flex items-center gap-3" style={{ background: "rgba(255,255,255,0.04)" }}>
      <div className={`w-11 h-11 rounded-xl bg-gradient-to-br ${colors[color]} flex items-center justify-center shrink-0 shadow-lg`}>
        <Icon size={18} className="text-white" />
      </div>
      <div className="min-w-0">
        <p className="text-white font-black text-xl leading-none truncate">{value}</p>
        <p className="text-white/50 text-[10px] font-bold uppercase tracking-wider mt-0.5">{label}</p>
        {sub && <p className="text-white/30 text-[10px] mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

export default function RelatorioPage() {
  const [insight, setInsight]   = useState<any>(null);
  const [loading, setLoading]   = useState(true);
  const [generating, setGenerating] = useState(false);
  const [genMsg, setGenMsg]     = useState("");

  async function load() {
    setLoading(true);
    const data = await fetchLatestInsight();
    setInsight(data);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function handleGenerate() {
    setGenerating(true);
    setGenMsg("");
    const ok = await generateInsight();
    if (ok) {
      setGenMsg("✅ Análise gerada!");
      await load();
    } else {
      setGenMsg("❌ Erro ao gerar análise.");
    }
    setGenerating(false);
    setTimeout(() => setGenMsg(""), 3000);
  }

  const m = insight?.metricas;

  return (
    <div className="h-full overflow-y-auto px-4 sm:px-6 py-4 space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-white font-black text-xl">Relatório Inteligente</h2>
          <p className="text-white/30 text-xs mt-0.5">
            {insight ? `Gerado em ${new Date(insight.created_at).toLocaleString("pt-BR")}` : "Nenhuma análise gerada ainda"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {genMsg && <span className={`text-xs font-bold ${genMsg.startsWith("✅") ? "text-emerald-300" : "text-rose-300"}`}>{genMsg}</span>}
          <button onClick={load} className="p-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 transition">
            <RefreshCw size={13} className="text-white/50" />
          </button>
          <button onClick={handleGenerate} disabled={generating}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-black transition disabled:opacity-60">
            <Brain size={13} className={generating ? "animate-pulse" : ""} />
            {generating ? "Analisando..." : "Gerar Análise GPT"}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-white/30 text-sm">Carregando...</div>
      ) : !insight ? (
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <Brain size={40} className="text-white/15" />
          <p className="text-white/30 text-sm">Nenhuma análise ainda. Clique em "Gerar Análise GPT" para começar.</p>
        </div>
      ) : (
        <>
          {/* Score + Briefing GPT */}
          <div className="rounded-2xl border border-violet-500/25 p-5 flex gap-5 items-start" style={{ background: "rgba(109,40,217,0.08)" }}>
            <ScoreRing score={insight.score_saude ?? 0} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-2">
                <Brain size={14} className="text-violet-400" />
                <span className="text-violet-300 text-xs font-black uppercase tracking-wider">Briefing Executivo · GPT-4o</span>
              </div>
              <p className="text-white/85 text-sm leading-relaxed mb-3">{insight.briefing}</p>
              {insight.alerta && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-rose-500/10 border border-rose-500/25 mb-3">
                  <AlertTriangle size={13} className="text-rose-400 shrink-0" />
                  <p className="text-rose-300 text-xs font-bold">{insight.alerta}</p>
                </div>
              )}
              {insight.recomendacao && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/25">
                  <Target size={13} className="text-emerald-400 shrink-0" />
                  <p className="text-emerald-300 text-xs font-bold">{insight.recomendacao}</p>
                </div>
              )}
            </div>
          </div>

          {/* Bullets de insights */}
          {Array.isArray(insight.bullets) && insight.bullets.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {insight.bullets.map((b: string, i: number) => (
                <div key={i} className="flex items-start gap-2.5 px-3 py-2.5 rounded-xl border border-white/8" style={{ background: "rgba(255,255,255,0.03)" }}>
                  <Zap size={12} className="text-amber-400 shrink-0 mt-0.5" />
                  <p className="text-white/70 text-xs leading-relaxed">{b}</p>
                </div>
              ))}
            </div>
          )}

          {/* KPIs principais */}
          {m && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              <MetricCard label="Receita do Mês" icon={TrendingUp}
                value={BRL(m.receitaRealizada)}
                sub={`${m.variacaoReceita >= 0 ? "+" : ""}${m.variacaoReceita}% vs mês anterior`}
                color={m.variacaoReceita >= 0 ? "emerald" : "rose"} />
              <MetricCard label="Oportunidade Perdida" icon={TrendingDown} color="rose"
                value={BRL(m.totalOportunidadePerdida)}
                sub={`No-show: ${BRL(m.totalPerdaNoShow)} | Cancel.: ${BRL(m.totalPerdaCancelados)}`} />
              <MetricCard label="RevPAS" icon={Target} color="sky"
                value={BRL(m.revPAS)}
                sub="Receita por slot utilizado" />
              <MetricCard label="Taxa No-Show" icon={AlertTriangle}
                color={m.taxaNoShowGlobal >= 20 ? "rose" : m.taxaNoShowGlobal >= 10 ? "amber" : "emerald"}
                value={`${m.taxaNoShowGlobal}%`}
                sub={`Referência mercado: ≤ 10%`} />
              <MetricCard label="ROI Maria IA" icon={Brain} color="violet"
                value={`${m.roiMaria}%`}
                sub={`${m.leadsAgendadosMaria} de ${m.leadsMaria} leads convertidos`} />
            </div>
          )}

          {/* Funil de conversão */}
          {m && (
            <div className="rounded-xl border border-white/10 p-4" style={{ background: "rgba(255,255,255,0.03)" }}>
              <p className="text-white/60 text-xs font-black uppercase tracking-wider mb-3">Funil de Conversão de Leads</p>
              <div className="flex items-end gap-2 h-24">
                {[
                  { key: "novo_lead",      label: "Novo Lead",      color: "#16a34a" },
                  { key: "maria_ia",       label: "Maria IA",       color: "#0284c7" },
                  { key: "interesse_real", label: "Interesse",      color: "#d97706" },
                  { key: "agendado",       label: "Agendado",       color: "#059669" },
                  { key: "perdido",        label: "Perdido",        color: "#dc2626" },
                ].map(s => {
                  const val = m.funil[s.key] || 0;
                  const max = Math.max(...Object.values(m.funil as Record<string, number>), 1);
                  const pct = Math.round(val / (max as number) * 100);
                  return (
                    <div key={s.key} className="flex-1 flex flex-col items-center gap-1">
                      <span className="text-white font-black text-sm">{val}</span>
                      <div className="w-full rounded-t-lg transition-all" style={{ height: `${Math.max(pct, 4)}%`, backgroundColor: s.color + "cc" }} />
                      <span className="text-white/35 text-[9px] font-bold text-center leading-tight">{s.label}</span>
                    </div>
                  );
                })}
              </div>
              <div className="mt-2 pt-2 border-t border-white/8 flex items-center justify-between">
                <span className="text-white/40 text-xs">Taxa conversão lead→agendado:</span>
                <span className={`text-sm font-black ${m.taxaConversao >= 30 ? "text-emerald-400" : m.taxaConversao >= 15 ? "text-amber-400" : "text-rose-400"}`}>{m.taxaConversao}%</span>
              </div>
            </div>
          )}

          {/* Performance por médico */}
          {m?.medicos?.length > 0 && (
            <div className="rounded-xl border border-white/10 overflow-hidden" style={{ background: "rgba(255,255,255,0.03)" }}>
              <div className="px-4 py-3 border-b border-white/8 flex items-center gap-2">
                <Star size={13} className="text-amber-400" />
                <p className="text-white/60 text-xs font-black uppercase tracking-wider">Performance por Médico — {m.periodo.inicio} a {m.periodo.fim}</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-white/8" style={{ background: "rgba(255,255,255,0.03)" }}>
                      {["Médico", "Confirmados", "No-Show", "Taxa NS", "Cancelados", "Receita", "Perda NS"].map(h => (
                        <th key={h} className="px-3 py-2 text-left text-white/30 font-black uppercase tracking-wider text-[9px] whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {m.medicos.map((med: any, i: number) => (
                      <tr key={i} className="border-b border-white/5 hover:bg-white/[0.02]">
                        <td className="px-3 py-2.5 text-white font-bold whitespace-nowrap">
                          {med.nome === insight.medico_destaque && <Star size={10} className="inline text-amber-400 mr-1" />}
                          {med.nome}
                        </td>
                        <td className="px-3 py-2.5 text-emerald-300 font-black">{med.confirmados + med.realizados}</td>
                        <td className="px-3 py-2.5 font-black" style={{ color: med.no_show > 0 ? "#f87171" : "#6ee7b7" }}>{med.no_show}</td>
                        <td className="px-3 py-2.5">
                          <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-black ${
                            med.taxa_no_show >= 20 ? "bg-rose-500/20 text-rose-300" :
                            med.taxa_no_show >= 10 ? "bg-amber-500/20 text-amber-300" :
                            "bg-emerald-500/20 text-emerald-300"
                          }`}>{med.taxa_no_show}%</span>
                        </td>
                        <td className="px-3 py-2.5 text-white/40">{med.cancelados}</td>
                        <td className="px-3 py-2.5 text-emerald-300 font-bold whitespace-nowrap">{BRL(med.receita_confirmada)}</td>
                        <td className="px-3 py-2.5 font-bold whitespace-nowrap" style={{ color: med.perda_no_show > 0 ? "#f87171" : "#6ee7b7" }}>
                          {med.perda_no_show > 0 ? `-${BRL(med.perda_no_show)}` : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Modelos utilizados */}
          <div className="rounded-xl border border-white/8 px-4 py-3" style={{ background: "rgba(255,255,255,0.02)" }}>
            <p className="text-white/25 text-[10px] font-bold uppercase tracking-wider mb-1.5">Modelos de análise utilizados</p>
            <p className="text-white/20 text-[10px] leading-relaxed">
              RevPAS (Revenue per Available Slot) · Taxa de Utilização de Agenda · Análise de No-Show Cost · Funil de Conversão · ROI de Automação IA · Variação MoM (Month-over-Month)
            </p>
          </div>
        </>
      )}
    </div>
  );
}
