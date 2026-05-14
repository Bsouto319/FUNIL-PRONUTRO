import { useEffect, useState, useCallback, useRef } from "react";
import { Search, RefreshCw, Users, Calendar, BarChart3, FileText, LogOut, Settings, Bot } from "lucide-react";
import Pipeline from "./Pipeline";
import LeadModal from "./LeadModal";
import AgendaPage from "./AgendaPage";
import AdminPanel from "./AdminPanel";
import { fetchLeads, fetchStats, fetchMariaGlobalMode, setMariaGlobalMode, updateLeadAiMode, signOut } from "../lib/api";
import { supabase } from "../lib/supabase";

type Page = "kanban" | "agenda" | "admin";

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

  const searchRef = useRef(search);
  searchRef.current = search;

  const load = useCallback(async (q?: string) => {
    const query = q !== undefined ? q : searchRef.current;
    const [l, s] = await Promise.all([fetchLeads(query), fetchStats()]);
    setLeads(l);
    setStats(s);
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    load();
    fetchMariaGlobalMode().then(setMariaActive);
  }, []);

  useEffect(() => {
    const channel = supabase
      .channel("pn_leads_rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "pn_leads" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
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

  const statCards = [
    { label: "Leads Hoje",  value: stats.hoje,      icon: Users,    bg: "bg-sky-500",     shadow: "shadow-sky-500/30"     },
    { label: "Maria IA",    value: stats.maria,     icon: Bot,      bg: "bg-violet-500",  shadow: "shadow-violet-500/30"  },
    { label: "Agendados",   value: stats.agendados, icon: Calendar, bg: "bg-emerald-500", shadow: "shadow-emerald-500/30" },
    { label: "Total",       value: stats.total,     icon: BarChart3, bg: "bg-amber-500",  shadow: "shadow-amber-500/30"   },
  ];

  const roleLabel: Record<string, string> = { gerente: "GERENTE", secretaria: "SECRETÁRIA", medico: "MÉDICO", admin: "ADMIN" };

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

          {/* User badge */}
          <div className="hidden sm:flex items-center gap-2 ml-2 px-3 py-1.5 rounded-xl border border-emerald-500/25 bg-emerald-500/10">
            <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-emerald-400 to-teal-600 flex items-center justify-center">
              <span className="text-white font-black text-[10px]">{(user.nome || "U")[0].toUpperCase()}</span>
            </div>
            <div className="leading-tight">
              <p className="text-emerald-300 font-black text-xs leading-none">{user.nome}</p>
              <p className="text-emerald-500/60 text-[9px] font-bold">{roleLabel[user.role] || user.role?.toUpperCase()}</p>
            </div>
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          </div>

          {/* Nav tabs */}
          <div className="flex items-center gap-1 ml-2">
            {(["kanban", "agenda", "admin"] as Page[]).map(p => (
              <button
                key={p}
                onClick={() => setPage(p)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${page === p ? "bg-white/15 text-white" : "text-white/40 hover:text-white/70 hover:bg-white/5"}`}
              >
                {p === "kanban" ? "Kanban" : p === "agenda" ? "Agenda" : "Admin"}
              </button>
            ))}
          </div>

          {/* Search */}
          {page === "kanban" && (
            <div className="relative max-w-xs w-full hidden sm:block ml-2">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none" />
              <input
                value={search}
                onChange={handleSearch}
                placeholder="Buscar paciente..."
                className="w-full pl-9 pr-3 py-2 bg-white/5 border border-white/10 rounded-xl text-sm text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition"
              />
            </div>
          )}

          {/* Actions */}
          <div className="ml-auto flex items-center gap-2">
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
          {statCards.map(({ label, value, icon: Icon, bg, shadow }) => (
            <div key={label} className="border border-white/10 rounded-xl p-3 flex items-center gap-3 hover:bg-white/[0.06] transition" style={{ background: "rgba(255,255,255,0.05)" }}>
              <div className={`w-10 h-10 rounded-xl ${bg} flex items-center justify-center shadow-lg ${shadow} flex-shrink-0`}>
                <Icon size={18} className="text-white" />
              </div>
              <div>
                <p className="text-3xl font-black text-white leading-none">{loading ? "–" : value}</p>
                <p className="text-blue-200/60 text-[10px] font-black tracking-widest uppercase mt-0.5">{label}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Main content */}
      <main className="flex-1 overflow-hidden min-h-0">
        {page === "kanban" && (
          loading ? (
            <div className="flex items-center justify-center h-full text-white/30 text-sm">Carregando leads...</div>
          ) : (
            <div className="h-full px-4 sm:px-6 pb-6">
              <Pipeline leads={leads} onSelect={setSelected} onToggleAi={handleToggleAi} currentUser={user} />
            </div>
          )
        )}
        {page === "agenda" && <AgendaPage />}
        {page === "admin" && <AdminPanel user={user} />}
      </main>

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
