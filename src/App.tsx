import { useEffect, useState } from "react";
import { supabase } from "./lib/supabase";
import { fetchCurrentUser, setClinicContext } from "./lib/api";
import LoginPage from "./components/LoginPage";
import Dashboard from "./components/Dashboard";

export default function App() {
  const [user, setUser]             = useState<any>(null);
  const [clinicConfig, setClinicConfig] = useState<any>(null);
  const [loading, setLoading]       = useState(true);
  const [offline, setOffline]       = useState(!navigator.onLine);
  const [passwordRecovery, setPasswordRecovery] = useState(false);

  useEffect(() => {
    const goOffline = () => setOffline(true);
    const goOnline  = () => setOffline(false);
    window.addEventListener("offline", goOffline);
    window.addEventListener("online",  goOnline);
    return () => {
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online",  goOnline);
    };
  }, []);

  useEffect(() => {
    let mounted = true;

    // Safety net: se após 10s ainda estiver carregando, mostra login
    const safetyTimer = setTimeout(() => {
      if (mounted) setLoading(false);
    }, 10000);

    function buildFallback(session: any) {
      const email = session?.user?.email || "";
      // Extrai apenas letras do prefixo do email, capitaliza a primeira palavra
      const prefix = email.split("@")[0].replace(/[^a-zA-ZÀ-ÿ]/g, " ").trim();
      const firstWord = prefix.split(/\s+/)[0] || "Usuário";
      const nome = firstWord.charAt(0).toUpperCase() + firstWord.slice(1).toLowerCase();
      return { id: session.user.id, email, nome, role: "staff", ativo: true };
    }

    async function loadUser(session: any) {
      if (!session) return;
      const fallback = buildFallback(session);
      try {
        const userPromise = fetchCurrentUser();
        const timeoutPromise = new Promise<null>(res => setTimeout(() => res(null), 6000));
        const u = await Promise.race([userPromise, timeoutPromise]);
        const finalUser = u || fallback;
        if (mounted) {
          setUser(finalUser);
          // Se o timeout venceu a corrida (conexão lenta), o usuário real
          // (com o role de verdade) ainda está a caminho -- quando chegar,
          // corrige a sessão em vez de deixar travado no fallback "staff"
          // pra sempre (bug real: Monica, role=admin no banco, ficava sem
          // acesso ao Admin porque a busca demorou mais que 6s).
          if (!u) {
            userPromise.then(real => {
              if (mounted && real) setUser(real);
            }).catch(() => {});
          }
          const slug = finalUser?.clinic_slug || "pronutro";
          // Seta defaults imediatos — app abre sem esperar o banco
          setClinicContext(slug, "ProNutro CRM", "Maria");
          setClinicConfig({ slug, clinic_name: "ProNutro CRM", agent_name: "Maria" });
          // Atualiza config da clínica em background — não bloqueia o carregamento
          supabase.from("clinic_configs")
            .select("slug, clinic_name, agent_name")
            .eq("slug", slug)
            .maybeSingle()
            .then(({ data: cfg }) => {
              if (!mounted || !cfg) return;
              const name  = cfg.clinic_name || "ProNutro CRM";
              const agent = cfg.agent_name  || "Maria";
              setClinicContext(slug, name, agent);
              setClinicConfig({ slug, clinic_name: name, agent_name: agent });
            });
        }
      } catch {
        if (mounted) {
          setUser(fallback);
          setClinicContext("pronutro", "ProNutro CRM", "Maria");
          setClinicConfig({ slug: "pronutro", clinic_name: "ProNutro CRM", agent_name: "Maria" });
        }
      }
    }

    // getSession() aguarda o refresh do token expirado antes de resolver
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!mounted) return;
      if (session) {
        await loadUser(session);
      } else {
        setUser(null);
      }
      setLoading(false);
    });

    // Escuta mudanças subsequentes (login, logout, token refresh)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!mounted) return;
      if (event === "PASSWORD_RECOVERY") {
        // Veio do link de "esqueci minha senha" -- pede a senha nova antes
        // de liberar o resto do app.
        setPasswordRecovery(true);
        setLoading(false);
      } else if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
        await loadUser(session);
        setLoading(false);
      } else if (event === "SIGNED_OUT") {
        setUser(null);
        setLoading(false);
      }
    });

    // Quando Monica volta pra aba, re-valida a sessão sem forçar logout
    async function handleVisibility() {
      if (document.visibilityState !== "visible") return;
      const { data: { session } } = await supabase.auth.getSession();
      if (!mounted) return;
      if (!session) {
        setUser(null);
      }
      // Se tiver sessão, onAuthStateChange cuida do TOKEN_REFRESHED
    }
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      mounted = false;
      clearTimeout(safetyTimer);
      subscription.unsubscribe();
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center" style={{ background: "linear-gradient(160deg,#0a1628 0%,#0f2057 100%)" }}>
        <div className="text-white/40 text-sm animate-pulse">Carregando...</div>
      </div>
    );
  }

  return (
    <>
      {offline && (
        <div className="fixed top-0 left-0 right-0 z-[9999] flex items-center justify-center gap-2 py-1.5 text-xs font-black"
          style={{ background: "rgba(239,68,68,0.92)", backdropFilter: "blur(4px)" }}>
          <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
          MODO OFFLINE — exibindo dados salvos anteriormente
        </div>
      )}
      {passwordRecovery ? (
        <NewPasswordForm onDone={async () => {
          setPasswordRecovery(false);
          const u = await fetchCurrentUser();
          if (u) setUser(u);
        }} />
      ) : user ? (
        <Dashboard user={user} clinicConfig={clinicConfig} />
      ) : (
        <LoginPage />
      )}
    </>
  );
}

function NewPasswordForm({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 6) { setError("A senha precisa ter pelo menos 6 caracteres."); return; }
    setSaving(true);
    setError("");
    const { error: err } = await supabase.auth.updateUser({ password });
    setSaving(false);
    if (err) { setError(err.message); return; }
    onDone();
  }

  return (
    <div className="h-screen flex items-center justify-center" style={{ background: "linear-gradient(160deg, #f0f9ff 0%, #e8f4fd 40%, #f1f5f9 100%)" }}>
      <div className="w-full max-w-sm mx-4">
        <div className="text-center mb-8">
          <h1 className="text-slate-800 font-black text-2xl">Defina sua nova senha</h1>
          <p className="text-slate-500 text-sm mt-1">Pra terminar a recuperação de acesso</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Nova senha (mín. 6 caracteres)"
            autoFocus
            className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 text-sm shadow-sm"
          />
          {error && <p className="text-rose-500 text-sm text-center">{error}</p>}
          <button type="submit" disabled={saving}
            className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-sm transition shadow-lg shadow-emerald-500/30 disabled:opacity-50">
            {saving ? "Salvando..." : "Salvar senha e entrar"}
          </button>
        </form>
      </div>
    </div>
  );
}
