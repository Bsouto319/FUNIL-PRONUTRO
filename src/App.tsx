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
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session) {
        try {
          const u = await fetchCurrentUser();
          setUser(u || {
            id:    session.user.id,
            email: session.user.email,
            nome:  session.user.email?.split("@")[0] || "Usuário",
            role:  "staff",
            ativo: true,
          });
        } catch {
          setUser({
            id:    session.user.id,
            email: session.user.email,
            nome:  session.user.email?.split("@")[0] || "Usuário",
            role:  "staff",
            ativo: true,
          });
        }
      } else {
        setUser(null);
      }
      setLoading(false);
    });
    return () => subscription.unsubscribe();
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
