import { useEffect, useState } from "react";
import { fetchUsuarios, fetchMedicos, fetchDisponibilidade, upsertDisponibilidade, upsertMedico, desativarMedico } from "../lib/api";
import { supabase } from "../lib/supabase";
import { Plus, RefreshCw, Save, Clock, Edit2, Trash2, X } from "lucide-react";
import ImportPage from "./ImportPage";

const DIAS = ["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"];
const DIAS_ORDER = [1,2,3,4,5,6,0]; // Seg→Dom

type Tab = "usuarios" | "medicos" | "horarios" | "importar";

export default function AdminPanel({ user }: { user: any }) {
  const [usuarios, setUsuarios] = useState<any[]>([]);
  const [medicos, setMedicos]   = useState<any[]>([]);
  const [tab, setTab]           = useState<Tab>("usuarios");
  const [loading, setLoading]   = useState(true);

  // Novo usuário
  const [novoEmail, setNovoEmail]   = useState("");
  const [novoNome, setNovoNome]     = useState("");
  const [novoSenha, setNovoSenha]   = useState("");
  const [novoRole, setNovoRole]     = useState("secretaria");
  const [savingUser, setSavingUser] = useState(false);
  const [userMsg, setUserMsg]       = useState("");

  // Médico form
  const MEDICO_BLANK = { id: "", nome: "", especialidade: "", valor: "", aceita_convenio: false, cor: "#059669" };
  const [medicoForm, setMedicoForm] = useState(MEDICO_BLANK);
  const [editingMedico, setEditingMedico] = useState(false);
  const [savingMedico, setSavingMedico]   = useState(false);
  const [medicoMsg, setMedicoMsg]         = useState("");

  // Horários
  const [medicoSel, setMedicoSel]   = useState("");
  const [disp, setDisp]             = useState<any[]>([]);
  const [loadingDisp, setLoadingDisp] = useState(false);
  const [savingDisp, setSavingDisp] = useState(false);
  const [dispMsg, setDispMsg]       = useState("");

  async function load() {
    setLoading(true);
    const [u, m] = await Promise.all([fetchUsuarios(), fetchMedicos()]);
    setUsuarios(u);
    setMedicos(m);
    if (!medicoSel && m.length > 0) setMedicoSel(m[0].id);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (tab !== "horarios" || !medicoSel) return;
    setLoadingDisp(true);
    setDispMsg("");
    fetchDisponibilidade(medicoSel).then(data => {
      // Garante que todos os dias estão presentes
      const map: Record<number, any> = {};
      data.forEach((d: any) => { map[d.dia_semana] = d; });
      setDisp(DIAS_ORDER.map(ds => map[ds] ?? {
        medico_id: medicoSel, dia_semana: ds,
        hora_inicio: "08:00", hora_fim: "17:00", ativo: false,
      }));
      setLoadingDisp(false);
    });
  }, [medicoSel, tab]);

  function updateDisp(ds: number, field: string, value: any) {
    setDisp(prev => prev.map(d => d.dia_semana === ds ? { ...d, [field]: value } : d));
  }

  async function saveDisp() {
    setSavingDisp(true);
    setDispMsg("");
    const results = await Promise.all(disp.map(d => upsertDisponibilidade(d)));
    setSavingDisp(false);
    setDispMsg(results.every(Boolean) ? "✅ Horários salvos!" : "⚠️ Erro ao salvar. Tente novamente.");
    setTimeout(() => setDispMsg(""), 3000);
  }

  async function handleSaveMedico(e: React.FormEvent) {
    e.preventDefault();
    setSavingMedico(true);
    setMedicoMsg("");
    const ok = await upsertMedico({
      id: medicoForm.id || undefined,
      nome: medicoForm.nome,
      especialidade: medicoForm.especialidade,
      valor: parseFloat(String(medicoForm.valor)) || 0,
      aceita_convenio: medicoForm.aceita_convenio,
      cor: medicoForm.cor,
    });
    setSavingMedico(false);
    if (ok) {
      setMedicoMsg("✅ Médico salvo!");
      setMedicoForm(MEDICO_BLANK);
      setEditingMedico(false);
      load();
    } else {
      setMedicoMsg("❌ Erro ao salvar.");
    }
    setTimeout(() => setMedicoMsg(""), 3000);
  }

  async function handleDesativarMedico(id: string, nome: string) {
    if (!confirm(`Desativar ${nome}?`)) return;
    await desativarMedico(id);
    load();
  }

  async function handleCreateUser(e: React.FormEvent) {
    e.preventDefault();
    setSavingUser(true);
    setUserMsg("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL?.trim() || "https://pvphgusjofufwtyiyviu.supabase.co"}/functions/v1/criar-usuario`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${session?.access_token}` },
          body: JSON.stringify({ nome: novoNome, email: novoEmail, password: novoSenha, role: novoRole }),
        }
      );
      const json = await res.json();
      if (!res.ok || json.error) {
        setUserMsg(`Erro: ${json.error || "tente novamente"}`);
      } else {
        setUserMsg("✅ Usuário criado com sucesso!");
        setNovoEmail(""); setNovoNome(""); setNovoSenha(""); setNovoRole("secretaria");
        load();
      }
    } catch {
      setUserMsg("Erro de conexão. Tente novamente.");
    }
    setSavingUser(false);
  }

  const roleLabel: Record<string, string> = { gerente: "Gerente", secretaria: "Secretária", medico: "Médico", admin: "Admin" };
  const roleColor: Record<string, string> = {
    gerente:    "bg-amber-500/20 text-amber-300 border-amber-500/30",
    secretaria: "bg-sky-500/20 text-sky-300 border-sky-500/30",
    medico:     "bg-violet-500/20 text-violet-300 border-violet-500/30",
    admin:      "bg-rose-500/20 text-rose-300 border-rose-500/30",
  };

  if (user.role !== "gerente" && user.role !== "admin") {
    return <div className="flex items-center justify-center h-full text-white/30 text-sm">Acesso restrito a gerentes.</div>;
  }

  return (
    <div className="h-full overflow-y-auto px-4 sm:px-6 py-4">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <h2 className="text-white font-black text-xl">Painel Admin</h2>
          <button onClick={load} className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 transition">
            <RefreshCw size={13} className="text-white/50" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-6">
          {(["usuarios", "medicos", "horarios", "importar"] as Tab[]).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-2 rounded-xl text-sm font-bold transition ${tab === t ? "bg-white/15 text-white" : "text-white/40 hover:text-white/60 hover:bg-white/5"}`}>
              {t === "usuarios" ? "👥 Usuários" : t === "medicos" ? "👨‍⚕️ Médicos" : t === "horarios" ? "🕐 Horários" : "📥 Importar"}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="text-white/30 text-sm text-center py-12">Carregando...</div>

        ) : tab === "usuarios" ? (
          <div className="space-y-4">
            <div className="space-y-2">
              {usuarios.map(u => (
                <div key={u.id} className="flex items-center gap-3 px-4 py-3 rounded-xl bg-white/5 border border-white/10">
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-400 to-teal-600 flex items-center justify-center text-white font-black text-sm flex-shrink-0">
                    {(u.nome || "U")[0].toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-white font-bold text-sm">{u.nome}</p>
                    <p className="text-white/40 text-xs">{u.email}</p>
                  </div>
                  <span className={`text-[10px] font-black px-2 py-0.5 rounded-full border ${roleColor[u.role] || "bg-white/10 text-white/50 border-white/10"}`}>
                    {roleLabel[u.role] || u.role}
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-6 p-4 rounded-xl bg-white/5 border border-white/10">
              <h3 className="text-white font-bold text-sm mb-4 flex items-center gap-2"><Plus size={14} /> Novo Funcionário</h3>
              <form onSubmit={handleCreateUser} className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-white/50 text-[10px] font-bold mb-1 uppercase">Nome</label>
                    <input value={novoNome} onChange={e => setNovoNome(e.target.value)} required placeholder="Monica Ferreira"
                      className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500/50" />
                  </div>
                  <div>
                    <label className="block text-white/50 text-[10px] font-bold mb-1 uppercase">Função</label>
                    <select value={novoRole} onChange={e => setNovoRole(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-xs focus:outline-none">
                      <option value="secretaria">Secretária</option>
                      <option value="gerente">Gerente</option>
                      <option value="medico">Médico</option>
                      <option value="admin">Admin</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-white/50 text-[10px] font-bold mb-1 uppercase">Email</label>
                  <input value={novoEmail} onChange={e => setNovoEmail(e.target.value)} required type="email" placeholder="funcionario@pronutro.com.br"
                    className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500/50" />
                </div>
                <div>
                  <label className="block text-white/50 text-[10px] font-bold mb-1 uppercase">Senha temporária</label>
                  <input value={novoSenha} onChange={e => setNovoSenha(e.target.value)} required type="password" placeholder="••••••••"
                    className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500/50" />
                </div>
                {userMsg && <p className="text-sm bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 text-xs text-amber-300">{userMsg}</p>}
                <button type="submit" disabled={savingUser}
                  className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition disabled:opacity-50">
                  {savingUser ? "Criando..." : "Criar Funcionário"}
                </button>
              </form>
            </div>
          </div>

        ) : tab === "medicos" ? (
          <div className="space-y-4">
            {/* Lista de médicos */}
            <div className="space-y-2">
              {medicos.map(m => (
                <div key={m.id} className="px-4 py-3 rounded-xl bg-white/5 border border-white/10">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: m.cor || "#059669" }} />
                      <div className="min-w-0">
                        <p className="text-white font-bold text-sm">{m.nome}</p>
                        <p className="text-violet-300/70 text-xs">{m.especialidade}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <div className="text-right text-xs mr-1">
                        <p className="text-emerald-300 font-bold">R$ {m.valor}</p>
                        {m.aceita_convenio && <p className="text-sky-300/70">Convênio</p>}
                      </div>
                      <button
                        onClick={() => { setMedicoForm({ id: m.id, nome: m.nome, especialidade: m.especialidade, valor: String(m.valor), aceita_convenio: m.aceita_convenio, cor: m.cor || "#059669" }); setEditingMedico(true); setMedicoMsg(""); }}
                        className="p-1.5 rounded-lg bg-white/5 hover:bg-white/15 border border-white/10 transition"
                        title="Editar">
                        <Edit2 size={12} className="text-white/50" />
                      </button>
                      <button
                        onClick={() => handleDesativarMedico(m.id, m.nome)}
                        className="p-1.5 rounded-lg bg-white/5 hover:bg-rose-500/20 border border-white/10 hover:border-rose-500/30 transition"
                        title="Desativar">
                        <Trash2 size={12} className="text-white/40 hover:text-rose-400" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Form criar / editar */}
            {editingMedico ? (
              <form onSubmit={handleSaveMedico} className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-4 space-y-3">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-white font-bold text-sm">{medicoForm.id ? "Editar Médico" : "Novo Médico"}</p>
                  <button type="button" onClick={() => { setEditingMedico(false); setMedicoForm(MEDICO_BLANK); }} className="p-1 rounded hover:bg-white/10"><X size={14} className="text-white/40" /></button>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <label className="block text-white/50 text-[10px] font-bold mb-1 uppercase">Nome completo</label>
                    <input required value={medicoForm.nome} onChange={e => setMedicoForm(p => ({ ...p, nome: e.target.value }))}
                      placeholder="Dr. Nome Sobrenome"
                      className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40" />
                  </div>
                  <div>
                    <label className="block text-white/50 text-[10px] font-bold mb-1 uppercase">Especialidade</label>
                    <input required value={medicoForm.especialidade} onChange={e => setMedicoForm(p => ({ ...p, especialidade: e.target.value }))}
                      placeholder="Nutrologia"
                      className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40" />
                  </div>
                  <div>
                    <label className="block text-white/50 text-[10px] font-bold mb-1 uppercase">Valor (R$)</label>
                    <input required type="number" value={medicoForm.valor} onChange={e => setMedicoForm(p => ({ ...p, valor: e.target.value }))}
                      placeholder="560"
                      className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40" />
                  </div>
                  <div className="flex items-center gap-2 pt-5">
                    <input type="checkbox" id="conv" checked={medicoForm.aceita_convenio} onChange={e => setMedicoForm(p => ({ ...p, aceita_convenio: e.target.checked }))}
                      className="w-4 h-4 rounded accent-emerald-500" />
                    <label htmlFor="conv" className="text-white/60 text-xs">Aceita convênio</label>
                  </div>
                  <div>
                    <label className="block text-white/50 text-[10px] font-bold mb-1 uppercase">Cor no calendário</label>
                    <div className="flex items-center gap-2">
                      <input type="color" value={medicoForm.cor} onChange={e => setMedicoForm(p => ({ ...p, cor: e.target.value }))}
                        className="w-9 h-9 rounded-lg cursor-pointer border border-white/10 bg-transparent" />
                      <span className="text-white/40 text-xs font-mono">{medicoForm.cor}</span>
                    </div>
                  </div>
                </div>
                {medicoMsg && <p className={`text-xs font-bold ${medicoMsg.startsWith("✅") ? "text-emerald-300" : "text-rose-300"}`}>{medicoMsg}</p>}
                <button type="submit" disabled={savingMedico}
                  className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition disabled:opacity-50">
                  {savingMedico ? "Salvando..." : medicoForm.id ? "Salvar alterações" : "Criar médico"}
                </button>
              </form>
            ) : (
              <button onClick={() => { setMedicoForm(MEDICO_BLANK); setEditingMedico(true); setMedicoMsg(""); }}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white/60 text-xs font-bold transition w-full justify-center">
                <Plus size={13} /> Novo Médico
              </button>
            )}
          </div>

        ) : tab === "horarios" ? (
          /* ── Aba Horários ── */
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <Clock size={15} className="text-emerald-400" />
              <p className="text-white/70 text-sm font-bold">Horários de Atendimento por Médico</p>
            </div>
            <p className="text-white/40 text-xs">
              Define os dias e horários em que cada médico atende. A Maria usa esses dados para oferecer horários disponíveis.
            </p>

            {/* Seletor de médico */}
            <div>
              <label className="block text-white/50 text-[10px] font-bold mb-1.5 uppercase">Selecionar Médico</label>
              <select value={medicoSel} onChange={e => setMedicoSel(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40">
                {medicos.map(m => <option key={m.id} value={m.id}>{m.nome}</option>)}
              </select>
            </div>

            {/* Grade de horários */}
            {loadingDisp ? (
              <div className="text-white/30 text-xs text-center py-8">Carregando horários...</div>
            ) : (
              <div className="rounded-xl border border-white/10 overflow-hidden" style={{ background: "rgba(255,255,255,0.04)" }}>
                {/* Header */}
                <div className="grid grid-cols-[80px_1fr_1fr_80px] px-4 py-2 border-b border-white/10 bg-white/[0.03]">
                  <span className="text-white/30 text-[10px] font-black uppercase">Dia</span>
                  <span className="text-white/30 text-[10px] font-black uppercase">Início</span>
                  <span className="text-white/30 text-[10px] font-black uppercase">Fim</span>
                  <span className="text-white/30 text-[10px] font-black uppercase text-center">Ativo</span>
                </div>

                {disp.map(d => (
                  <div key={d.dia_semana}
                    className={`grid grid-cols-[80px_1fr_1fr_80px] items-center px-4 py-3 border-b border-white/5 last:border-0 transition ${d.ativo ? "" : "opacity-40"}`}>
                    <span className={`text-sm font-black ${d.ativo ? "text-white" : "text-white/40"}`}>
                      {DIAS[d.dia_semana]}
                    </span>
                    <input
                      type="time"
                      value={d.hora_inicio}
                      disabled={!d.ativo}
                      onChange={e => updateDisp(d.dia_semana, "hora_inicio", e.target.value)}
                      className="w-28 px-2 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500/40 disabled:opacity-30"
                    />
                    <input
                      type="time"
                      value={d.hora_fim}
                      disabled={!d.ativo}
                      onChange={e => updateDisp(d.dia_semana, "hora_fim", e.target.value)}
                      className="w-28 px-2 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500/40 disabled:opacity-30"
                    />
                    <div className="flex justify-center">
                      <button
                        onClick={() => updateDisp(d.dia_semana, "ativo", !d.ativo)}
                        className={`w-10 h-6 rounded-full transition-all relative ${d.ativo ? "bg-emerald-500" : "bg-white/10"}`}>
                        <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${d.ativo ? "left-4.5" : "left-0.5"}`} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {dispMsg && (
              <p className={`text-xs rounded-lg px-3 py-2 font-bold ${dispMsg.startsWith("✅") ? "bg-emerald-500/10 text-emerald-300 border border-emerald-500/20" : "bg-amber-500/10 text-amber-300 border border-amber-500/20"}`}>
                {dispMsg}
              </p>
            )}

            <button onClick={saveDisp} disabled={savingDisp || loadingDisp}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-black transition shadow-lg shadow-emerald-500/30 disabled:opacity-50">
              <Save size={14} />
              {savingDisp ? "Salvando..." : "Salvar Horários"}
            </button>
          </div>

        ) : (
          <ImportPage />
        )}
      </div>
    </div>
  );
}
