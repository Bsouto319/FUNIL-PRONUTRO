import { useEffect, useState } from "react";
import { fetchAgendamentos, fetchMedicos, cancelAgendamento } from "../lib/api";
import { ChevronLeft, ChevronRight, X, Clock, Stethoscope, BanknoteIcon, ShieldCheck } from "lucide-react";

const FALLBACK_COLORS = [
  "#7c3aed", "#0284c7", "#059669", "#d97706", "#dc2626", "#0891b2",
];

const MONTHS_PT = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
const DAYS_PT   = ["Seg","Ter","Qua","Qui","Sex","Sáb","Dom"];

function localStr(d: Date): string {
  const y  = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const dy = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${dy}`;
}

function formatBRL(v: number | null): string {
  if (!v) return "—";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
}

function hexToRgb(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

export default function AgendaPage() {
  const today    = new Date();
  const todayStr = localStr(today);

  const [year, setYear]             = useState(today.getFullYear());
  const [month, setMonth]           = useState(today.getMonth());
  const [agendamentos, setAgendamentos] = useState<any[]>([]);
  const [medicos, setMedicos]       = useState<any[]>([]);
  const [medicoFiltro, setMedicoFiltro] = useState("");
  const [selectedDay, setSelectedDay] = useState<string | null>(todayStr);
  const [loading, setLoading]       = useState(true);

  function getMonthRange() {
    const first = new Date(year, month, 1);
    const last  = new Date(year, month + 1, 0);
    return { from: `${localStr(first)}T00:00:00`, to: `${localStr(last)}T23:59:59` };
  }

  async function load() {
    setLoading(true);
    const { from, to } = getMonthRange();
    const [ag, med] = await Promise.all([fetchAgendamentos(from, to), fetchMedicos()]);
    setAgendamentos(ag);
    setMedicos(med);
    setLoading(false);
  }

  useEffect(() => { load(); }, [year, month]);

  function prevMonth() {
    if (month === 0) { setYear(y => y - 1); setMonth(11); }
    else setMonth(m => m - 1);
  }
  function nextMonth() {
    if (month === 11) { setYear(y => y + 1); setMonth(0); }
    else setMonth(m => m + 1);
  }

  const firstDay    = new Date(year, month, 1);
  const lastDay     = new Date(year, month + 1, 0);
  const startOffset = (firstDay.getDay() + 6) % 7;

  const calDays: (Date | null)[] = [];
  for (let i = 0; i < startOffset; i++) calDays.push(null);
  for (let d = 1; d <= lastDay.getDate(); d++) calDays.push(new Date(year, month, d));

  const filtered = medicoFiltro
    ? agendamentos.filter(a => a.medico_id === medicoFiltro)
    : agendamentos;

  // color per doctor — prefer db `cor` field, fallback to palette
  const medicoColorMap: Record<string, string> = {};
  medicos.forEach((m, i) => {
    medicoColorMap[m.id] = m.cor || FALLBACK_COLORS[i % FALLBACK_COLORS.length];
  });

  const selectedDayAg = selectedDay
    ? [...filtered.filter(a => a.data_hora.slice(0, 10) === selectedDay)]
        .sort((a, b) => a.data_hora.localeCompare(b.data_hora))
    : [];

  async function handleCancel(id: string) {
    await cancelAgendamento(id);
    load();
  }

  return (
    <div
      className="h-full overflow-y-auto"
      style={{
        background: "linear-gradient(160deg, #0a1628 0%, #0f2240 35%, #071830 100%)",
      }}
    >
      {/* Inner padding */}
      <div className="px-4 sm:px-6 py-5 space-y-5">

        {/* Toolbar */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <button onClick={prevMonth} className="p-1.5 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 transition">
              <ChevronLeft size={14} className="text-white/60" />
            </button>
            <span className="text-white font-black text-base min-w-[180px] text-center tracking-wide">
              {MONTHS_PT[month]} {year}
            </span>
            <button onClick={nextMonth} className="p-1.5 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 transition">
              <ChevronRight size={14} className="text-white/60" />
            </button>
            <button
              onClick={() => { const t = new Date(); setYear(t.getFullYear()); setMonth(t.getMonth()); setSelectedDay(localStr(t)); }}
              className="text-xs text-emerald-400 hover:text-emerald-300 font-bold ml-1 px-2 py-1 rounded-lg hover:bg-emerald-500/10 transition"
            >
              Hoje
            </button>
          </div>

          {/* Doctor filter legend */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setMedicoFiltro("")}
              className={`text-[10px] font-bold px-2.5 py-1 rounded-full border transition ${!medicoFiltro ? "bg-white/15 border-white/30 text-white" : "border-white/10 text-white/40 hover:text-white/60"}`}
            >
              Todos
            </button>
            {medicos.map(m => {
              const color = medicoColorMap[m.id];
              const active = medicoFiltro === m.id;
              return (
                <button
                  key={m.id}
                  onClick={() => setMedicoFiltro(f => f === m.id ? "" : m.id)}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border transition text-[10px] font-bold"
                  style={{
                    borderColor: active ? color : `${color}40`,
                    background: active ? hexToRgb(color, 0.2) : hexToRgb(color, 0.06),
                    color: active ? "#fff" : `${color}cc`,
                  }}
                >
                  <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
                  {m.nome.replace(/^(Dr\.|Dra\.) /, "").split(" ")[0]}
                </button>
              );
            })}
          </div>

          <span className="text-white/25 text-xs ml-auto">
            {filtered.length} consulta{filtered.length !== 1 ? "s" : ""} este mês
          </span>
        </div>

        {/* Calendar + side panel */}
        <div className={`grid gap-4 ${selectedDay ? "xl:grid-cols-[1fr_300px]" : ""}`}>

          {/* Calendar */}
          <div className="rounded-2xl border border-white/8 overflow-hidden" style={{ background: "rgba(255,255,255,0.03)" }}>
            {/* Day headers */}
            <div className="grid grid-cols-7 border-b border-white/8">
              {DAYS_PT.map(d => (
                <div key={d} className="text-center text-white/20 text-[10px] font-black uppercase tracking-widest py-2.5">
                  {d}
                </div>
              ))}
            </div>

            {loading ? (
              <div className="text-white/20 text-sm text-center py-24">Carregando...</div>
            ) : (
              <div className="grid grid-cols-7 gap-px p-0" style={{ background: "rgba(255,255,255,0.04)" }}>
                {calDays.map((date, i) => {
                  if (!date) return (
                    <div key={`e${i}`} className="min-h-[90px]" style={{ background: "rgba(10,22,50,0.9)" }} />
                  );
                  const dateStr    = localStr(date);
                  const dayAg      = filtered.filter(a => a.data_hora.slice(0, 10) === dateStr);
                  const isToday    = dateStr === todayStr;
                  const isSelected = dateStr === selectedDay;
                  const isPast     = date < today && !isToday;

                  return (
                    <div
                      key={dateStr}
                      onClick={() => setSelectedDay(isSelected ? null : dateStr)}
                      className="min-h-[90px] cursor-pointer transition-all p-1.5"
                      style={{
                        background: isSelected
                          ? "rgba(5,150,105,0.12)"
                          : isToday
                          ? "rgba(5,150,105,0.06)"
                          : "rgba(10,22,50,0.9)",
                        outline: isSelected ? "2px solid rgba(5,150,105,0.5)" : isToday ? "1px solid rgba(5,150,105,0.2)" : "none",
                        outlineOffset: "-1px",
                        opacity: isPast && !dayAg.length ? 0.5 : 1,
                      }}
                    >
                      {/* Day number */}
                      <div className="flex items-center justify-between mb-1.5">
                        <div
                          className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-black"
                          style={{
                            background: isToday ? "#059669" : "transparent",
                            color: isToday ? "#fff" : isSelected ? "#6ee7b7" : isPast ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.55)",
                          }}
                        >
                          {date.getDate()}
                        </div>
                        {dayAg.length > 0 && (
                          <span className="text-[8px] font-black text-white/30">{dayAg.length}</span>
                        )}
                      </div>

                      {/* Mini appointment dots/chips */}
                      <div className="space-y-0.5">
                        {dayAg.slice(0, 3).map(a => {
                          const c = medicoColorMap[a.medico_id] || FALLBACK_COLORS[0];
                          const patientName = (a.lead?.name || a.lead?.whatsapp_name || a.lead?.phone || "—").split(" ")[0];
                          return (
                            <div
                              key={a.id}
                              className="flex items-center gap-1 px-1 py-0.5 rounded text-[8px] leading-tight truncate"
                              style={{ background: hexToRgb(c, 0.18), borderLeft: `2px solid ${c}` }}
                            >
                              <span className="font-black shrink-0" style={{ color: c }}>{a.data_hora.slice(11, 16)}</span>
                              <span className="truncate text-white/60">{patientName}</span>
                            </div>
                          );
                        })}
                        {dayAg.length > 3 && (
                          <div className="text-[8px] text-white/25 font-bold text-center">+{dayAg.length - 3} mais</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Side panel */}
          {selectedDay && (
            <div className="rounded-2xl border border-white/8 overflow-hidden flex flex-col" style={{ background: "rgba(255,255,255,0.03)" }}>
              {/* Panel header */}
              <div className="px-4 py-3.5 border-b border-white/8 flex items-start justify-between shrink-0">
                <div>
                  <p className="text-white font-black text-sm capitalize leading-tight">
                    {new Date(selectedDay + "T12:00:00").toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" })}
                  </p>
                  <p className="text-white/35 text-xs mt-0.5">
                    {selectedDayAg.length === 0
                      ? "Sem consultas agendadas"
                      : `${selectedDayAg.length} consulta${selectedDayAg.length !== 1 ? "s" : ""}`}
                  </p>
                </div>
                <button onClick={() => setSelectedDay(null)} className="p-1.5 rounded-lg hover:bg-white/10 text-white/25 hover:text-white transition shrink-0">
                  <X size={13} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
                {selectedDayAg.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <div className="w-12 h-12 rounded-2xl bg-white/5 flex items-center justify-center mb-3">
                      <Stethoscope size={20} className="text-white/15" />
                    </div>
                    <p className="text-white/20 text-xs font-semibold">Nenhuma consulta neste dia</p>
                  </div>
                ) : (
                  selectedDayAg.map(a => {
                    const color = medicoColorMap[a.medico_id] || FALLBACK_COLORS[0];
                    const patientName = a.lead?.name || a.lead?.whatsapp_name || "—";
                    const medNome = a.medico?.nome || "—";
                    const medEsp  = a.medico?.especialidade || null;
                    const medVal  = a.medico?.valor ?? null;
                    const medConv = a.medico?.aceita_convenio;

                    return (
                      <div
                        key={a.id}
                        className="group rounded-xl p-3.5 border relative"
                        style={{
                          background: hexToRgb(color, 0.07),
                          borderColor: `${color}30`,
                          borderLeftWidth: 3,
                          borderLeftColor: color,
                        }}
                      >
                        {/* Cancel button */}
                        <button
                          onClick={() => handleCancel(a.id)}
                          className="absolute top-2.5 right-2.5 opacity-0 group-hover:opacity-100 p-1 rounded-lg hover:bg-rose-500/20 text-white/20 hover:text-rose-400 transition"
                          title="Cancelar consulta"
                        >
                          <X size={11} />
                        </button>

                        {/* Time + duration */}
                        <div className="flex items-center gap-1.5 mb-2.5">
                          <div className="flex items-center gap-1" style={{ color }}>
                            <Clock size={11} />
                            <span className="font-black text-sm">{a.data_hora.slice(11, 16)}</span>
                          </div>
                          {a.duracao_min && (
                            <span className="text-[9px] text-white/25 font-semibold">{a.duracao_min}min</span>
                          )}
                        </div>

                        {/* Patient name */}
                        <p className="text-white font-black text-sm leading-tight truncate mb-1">
                          {patientName}
                        </p>
                        {a.lead?.phone && (
                          <p className="text-white/30 text-[10px] font-mono mb-2">+{a.lead.phone}</p>
                        )}

                        {/* Doctor card */}
                        <div
                          className="rounded-lg p-2 mb-1.5"
                          style={{ background: hexToRgb(color, 0.12) }}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="font-black text-[11px] leading-tight truncate" style={{ color }}>
                                {medNome}
                              </p>
                              {medEsp && (
                                <p className="text-white/40 text-[10px] mt-0.5 truncate">{medEsp}</p>
                              )}
                            </div>
                            <div className="shrink-0 text-right">
                              {medVal ? (
                                <p className="font-black text-[11px] text-emerald-300">{formatBRL(medVal)}</p>
                              ) : null}
                              {medConv && (
                                <div className="flex items-center gap-0.5 justify-end mt-0.5">
                                  <ShieldCheck size={9} className="text-sky-400" />
                                  <span className="text-[9px] text-sky-400 font-bold">Convênio</span>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Tipo / Observações */}
                        {(a.tipo_consulta || a.observacoes) && (
                          <div className="mt-1.5 space-y-0.5">
                            {a.tipo_consulta && (
                              <p className="text-[10px] text-white/35 font-semibold">{a.tipo_consulta}</p>
                            )}
                            {a.observacoes && (
                              <p className="text-[10px] text-white/25 italic">{a.observacoes}</p>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>

        {/* Doctor summary strip */}
        {medicos.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
            {medicos.map(m => {
              const color = medicoColorMap[m.id];
              const count = filtered.filter(a => a.medico_id === m.id).length;
              return (
                <button
                  key={m.id}
                  onClick={() => setMedicoFiltro(f => f === m.id ? "" : m.id)}
                  className="rounded-xl p-3 text-left border transition-all"
                  style={{
                    background: hexToRgb(color, medicoFiltro === m.id ? 0.15 : 0.06),
                    borderColor: medicoFiltro === m.id ? `${color}60` : `${color}20`,
                  }}
                >
                  <div className="w-2 h-2 rounded-full mb-2" style={{ backgroundColor: color }} />
                  <p className="text-white font-black text-xs truncate leading-tight">{m.nome.replace(/^(Dr\.|Dra\.) /, "")}</p>
                  {m.especialidade && (
                    <p className="text-white/35 text-[9px] mt-0.5 truncate">{m.especialidade}</p>
                  )}
                  <p className="font-black text-sm mt-1.5" style={{ color }}>
                    {count} <span className="text-[9px] text-white/30 font-semibold">este mês</span>
                  </p>
                  {m.valor && (
                    <p className="text-white/30 text-[9px] mt-0.5">{formatBRL(m.valor)}</p>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
