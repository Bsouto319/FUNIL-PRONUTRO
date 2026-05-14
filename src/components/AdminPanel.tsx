import { useEffect, useState } from "react";
import { fetchUsuarios, fetchMedicos } from "../lib/api";
import { supabase } from "../lib/supabase";
import { Plus, RefreshCw } from "lucide-react";

export default function AdminPanel({ user }: { user: any }) {
  const [usuarios, setUsuarios] = useState<any[]>([]);
  const [medicos, setMedicos]   = useState<any[]>([]);
  const [tab, setTab]           = useState<"usuarios" | "medicos">("usuarios");
  const [loading, setLoading]   = useState(true);

  // Novo usuario
  const [novoEmail, setNovoEmail]     = useState("");
  const [novoNome, setNovoNome]       = useState("");
  const [novoSenha, setNovoSenha]     = useState("");
  const [novoRole, setNovoRole]       = useState("secretaria");
  const [savingUser, setSavingUser]   = useState(false);
  const [userMsg, setUserMsg]         = useState("");

  async function load() {
    setLoading(true);
    const [u, m] = await Promise.all([fetchUsuarios(), fetchMedicos()]);
    setUsuarios(u);
    setMedicos(m);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function handleCreateUser(e: React.FormEvent) {
    e.preventDefault();
    setSavingUser(true);
    setUserMsg("");
    try {
      const { data, error: signUpErr } = await supabase.auth.admin?.createUser
        ? await (supabase.auth as any).admin.createUser({ email: novoEmail, password: novoSenha, email_confirm: true })
        : { data: null, error: new Error("Admin API não disponível no client") };

      if (signUpErr || !data?.user) {
        // Fallback: instrução manual
        setUserMsg(`Crie o usuário manualmente no Supabase Auth e insira o perfil na tabela pn_usuarios com role="${novoRole}" e nome="${novoNome}"`);
        setSavingUser(false);
        return;
      }

      await supabase.from("pn_usuarios").insert({
        id: data.user.id,
        nome: novoNome,
        email: novoEmail,
        role: novoRole,
      });
      setUserMsg("Usuário criado com sucesso!");
      setNovoEmail(""); setNovoNome(""); setNovoSenha(""); setNovoRole("secretaria");
      load();
    } catch {
      setUserMsg("Erro ao criar usuário. Crie manualmente no Supabase Auth.");
    }
    setSavingUser(false);
  }

  const roleLabel: Record<string, string> = { gerente: "Gerente", secretaria: "Secretária", medico: "Médico", admin: "Admin" };
  const roleColor: Record<string, string> = {
    gerente: "bg-amber-500/20 text-amber-300 border-amber-500/30",
    secretaria: "bg-sky-500/20 text-sky-300 border-sky-500/30",
    medico: "bg-violet-500/20 text-violet-300 border-violet-500/30",
    admin: "bg-rose-500/20 text-rose-300 border-rose-500/30",
  };

  if (user.role !== "gerente" && user.role !== "admin") {
    return (
      <div className="flex items-center justify-center h-full text-white/30 text-sm">
        Acesso restrito a gerentes.
      </div>
    );
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
          {(["usuarios", "medicos"] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 rounded-xl text-sm font-bold transition ${tab === t ? "bg-white/15 text-white" : "text-white/40 hover:text-white/60 hover:bg-white/5"}`}
            >
              {t === "usuarios" ? "👥 Usuários" : "👨‍⚕️ Médicos"}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="text-white/30 text-sm text-center py-12">Carregando...</div>
        ) : tab === "usuarios" ? (
          <div className="space-y-4">
            {/* User list */}
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

            {/* Create user form */}
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
                {userMsg && <p className="text-sm text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 text-xs">{userMsg}</p>}
                <button type="submit" disabled={savingUser}
                  className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition disabled:opacity-50">
                  {savingUser ? "Criando..." : "Criar Funcionário"}
                </button>
              </form>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {medicos.map(m => (
              <div key={m.id} className="px-4 py-3 rounded-xl bg-white/5 border border-white/10">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-white font-bold text-sm">{m.nome}</p>
                    <p className="text-violet-300/70 text-xs">{m.especialidade}</p>
                    {m.sub_especialidade && <p className="text-white/30 text-xs">{m.sub_especialidade}</p>}
                  </div>
                  <div className="text-right text-xs">
                    <p className="text-emerald-300 font-bold">R$ {m.valor_particular}</p>
                    {m.aceita_convenio && <p className="text-sky-300/70">Aceita convênio</p>}
                  </div>
                </div>
              </div>
            ))}
            <p className="text-white/30 text-xs text-center pt-2">Para editar médicos, acesse o Supabase diretamente na tabela pn_medicos.</p>
          </div>
        )}
      </div>
    </div>
  );
}
