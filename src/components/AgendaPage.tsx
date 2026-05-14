import { useEffect, useState } from "react";
import { fetchAgendamentos, fetchMedicos, cancelAgendamento } from "../lib/api";
import { ChevronLeft, ChevronRight, X } from "lucide-react";

export default function AgendaPage() {
  const [agendamentos, setAgendamentos] = useState<any[]>([]);
  const [medicos, setMedicos]           = useState<any[]>([]);
  const [medicoFiltro, setMedicoFiltro] = useState("");
  const [week, setWeek]                 = useState(0);
  const [loading, setLoading]           = useState(true);

  function getWeekRange(offset: number) {
    const now = new Date();
    now.setDate(now.getDate() - now.getDay() + 1 + offset * 7);
    const start = new Date(now);
    const end   = new Date(now); end.setDate(now.getDate() + 6);
    return {
      from: start.toISOString().slice(0, 10),
      to:   end.toISOString().slice(0, 10),
      label: `${start.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })} – ${end.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}`,
    };
  }

  async function load() {
    setLoading(true);
    const { from, to } = getWeekRange(week);
    const [ag, med] = await Promise.all([
      fetchAgendamentos(from + "T00:00:00", to + "T23:59:59"),
      fetchMedicos(),
    ]);
    setAgendamentos(ag);
    setMedicos(med);
    setLoading(false);
  }

  useEffect(() => { load(); }, [week]);

  const filtered = medicoFiltro
    ? agendamentos.filter(a => a.medico_id === medicoFiltro)
    : agendamentos;

  const days = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
  const { from, label } = getWeekRange(week);
  const weekStart = new Date(from + "T12:00:00");

  async function handleCancel(id: string) {
    await cancelAgendamento(id);
    load();
  }

  return (
    <div className="h-full overflow-y-auto px-4 sm:px-6 py-4">
      {/* Toolbar */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="flex items-center gap-2">
          <button onClick={() => setWeek(w => w - 1)} className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 transition">
            <ChevronLeft size={14} className="text-white/60" />
          </button>
          <span className="text-white/70 text-sm font-bold min-w-[180px] text-center">{label}</span>
          <button onClick={() => setWeek(w => w + 1)} className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 transition">
            <ChevronRight size={14} className="text-white/60" />
          </button>
          {week !== 0 && (
            <button onClick={() => setWeek(0)} className="text-xs text-emerald-400 hover:text-emerald-300 font-bold ml-1">Hoje</button>
          )}
        </div>
        <select
          value={medicoFiltro}
          onChange={e => setMedicoFiltro(e.target.value)}
          className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white text-xs focus:outline-none"
        >
          <option value="">Todos os médicos</option>
          {medicos.map(m => <option key={m.id} value={m.id}>{m.nome}</option>)}
        </select>
        <span className="text-white/40 text-xs ml-auto">{filtered.length} consulta{filtered.length !== 1 ? "s" : ""}</span>
      </div>

      {/* Week grid */}
      {loading ? (
        <div className="text-white/30 text-sm text-center py-16">Carregando...</div>
      ) : (
        <div className="grid grid-cols-7 gap-2">
          {days.map((day, i) => {
            const date = new Date(weekStart);
            date.setDate(weekStart.getDate() + i);
            const dateStr = date.toISOString().slice(0, 10);
            const dayAg = filtered.filter(a => a.data_hora.slice(0, 10) === dateStr);
            const isToday = dateStr === new Date().toISOString().slice(0, 10);

            return (
              <div key={i} className={`rounded-xl p-2 border min-h-[120px] ${isToday ? "border-emerald-500/30 bg-emerald-500/5" : "border-white/10 bg-white/[0.03]"}`}>
                <div className="text-center mb-2">
                  <p className={`text-[10px] font-bold ${isToday ? "text-emerald-400" : "text-white/40"}`}>{day}</p>
                  <p className={`text-sm font-black ${isToday ? "text-emerald-300" : "text-white/60"}`}>{date.getDate()}</p>
                </div>
                <div className="space-y-1.5">
                  {dayAg.map(a => (
                    <div key={a.id} className="p-1.5 rounded-lg bg-violet-500/15 border border-violet-500/25 group relative">
                      <p className="text-violet-300 text-[10px] font-bold">{a.data_hora.slice(11, 16)}</p>
                      <p className="text-white/70 text-[9px] truncate">{a.lead?.name || a.lead?.phone}</p>
                      <p className="text-violet-400/60 text-[9px] truncate">{a.medico?.nome}</p>
                      <button
                        onClick={() => handleCancel(a.id)}
                        className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition"
                      >
                        <X size={10} className="text-rose-400" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* List view below */}
      {filtered.length > 0 && (
        <div className="mt-6">
          <h3 className="text-white/60 text-xs font-bold uppercase tracking-wide mb-3">Detalhes da semana</h3>
          <div className="space-y-2">
            {filtered.map(a => (
              <div key={a.id} className="flex items-center gap-4 px-4 py-3 rounded-xl bg-white/5 border border-white/10">
                <div className="text-center w-12">
                  <p className="text-white font-black text-sm">{a.data_hora.slice(11, 16)}</p>
                  <p className="text-white/40 text-[10px]">{new Date(a.data_hora).toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" })}</p>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white font-bold text-sm truncate">{a.lead?.name || a.lead?.phone}</p>
                  <p className="text-white/50 text-xs">{a.medico?.nome} · {a.tipo_consulta || "Consulta"}</p>
                </div>
                {a.observacoes && <p className="text-white/30 text-xs max-w-[200px] truncate">{a.observacoes}</p>}
                <button
                  onClick={() => handleCancel(a.id)}
                  className="text-rose-400/60 hover:text-rose-400 transition text-xs font-bold"
                >
                  Cancelar
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
