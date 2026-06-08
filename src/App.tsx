import { useEffect, useState } from "react";
import { supabase } from "./lib/supabase";
import { fetchCurrentUser } from "./lib/api";
import LoginPage from "./components/LoginPage";
import Dashboard from "./components/Dashboard";

export default function App() {
  const [user, setUser]       = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(!navigator.onLine);

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

    function buildFallback(session: any) {
      const email = session?.user?.email || "";
      const rawName = email.split("@")[0] || "Usuário";
      const nome = rawName.charAt(0).toUpperCase() + rawName.slice(1);
      return { id: session.user.id, email, nome, role: "staff", ativo: true };
    }

    async function loadUser(session: any) {
      if (!session) return;
      const fallback = buildFallback(session);
      try {
        const userPromise = fetchCurrentUser();
        const timeoutPromise = new Promise<null>(res => setTimeout(() => res(null), 6000));
        const u = await Promise.race([userPromise, timeoutPromise]);
        if (mounted) setUser(u || fallback);
      } catch {
        if (mounted) setUser(fallback);
      }
    }

    // getSession() aguarda o refresh do token expirado antes de resolver
    // evita o F5-logout causado pelo INITIAL_SESSION disparar antes do refresh
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
      if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
        await loadUser(session);
        setLoading(false);
      } else if (event === "SIGNED_OUT") {
        setUser(null);
        setLoading(false);
      }
    });

    return () => { mounted = false; subscription.unsubscribe(); };
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
      {user ? <Dashboard user={user} /> : <LoginPage />}
    </>
  );
}
