import { useEffect, useState } from "react";
import { supabase } from "./lib/supabase";
import { fetchCurrentUser } from "./lib/api";
import LoginPage from "./components/LoginPage";
import Dashboard from "./components/Dashboard";

export default function App() {
  const [user, setUser]       = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        fetchCurrentUser().then(u => { setUser(u); setLoading(false); });
      } else {
        setLoading(false);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) {
        fetchCurrentUser().then(setUser);
      } else {
        setUser(null);
      }
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

  return user ? <Dashboard user={user} /> : <LoginPage />;
}
