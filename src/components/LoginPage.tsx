import { useState } from "react";
import { signIn } from "../lib/api";

const SAVED_EMAIL_KEY = "pn-last-email";

export default function LoginPage() {
  const [email, setEmail]       = useState(() => localStorage.getItem(SAVED_EMAIL_KEY) || "");
  const [password, setPassword] = useState("");
  const [error, setError]       = useState("");
  const [loading, setLoading]   = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const { error: err } = await signIn(email, password);
    if (err) {
      setError("Email ou senha incorretos.");
    } else {
      localStorage.setItem(SAVED_EMAIL_KEY, email);
    }
    setLoading(false);
  }

  return (
    <div className="h-screen flex items-center justify-center" style={{ background: "linear-gradient(160deg,#0a1628 0%,#0f2057 100%)" }}>
      <div className="w-full max-w-sm mx-4">
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-emerald-400 to-teal-600 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-emerald-500/30">
            <span className="text-white font-black text-2xl">P</span>
          </div>
          <h1 className="text-white font-black text-2xl">ProNutro CRM</h1>
          <p className="text-blue-200/50 text-sm mt-1">Acesso restrito a funcionários</p>
        </div>

        <form onSubmit={handleSubmit} autoComplete="on" className="space-y-4">
          <div>
            <label className="block text-blue-200/60 text-xs font-bold mb-1.5 uppercase tracking-wide">Email</label>
            <input
              type="email"
              name="email"
              autoComplete="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/20 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500/50 transition text-sm"
              placeholder="seu@email.com"
            />
          </div>
          <div>
            <label className="block text-blue-200/60 text-xs font-bold mb-1.5 uppercase tracking-wide">Senha</label>
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/20 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500/50 transition text-sm"
              placeholder="••••••••"
            />
          </div>

          {error && <p className="text-rose-400 text-sm text-center">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-sm transition shadow-lg shadow-emerald-500/30 disabled:opacity-50 disabled:cursor-wait"
          >
            {loading ? "Entrando..." : "Entrar"}
          </button>
        </form>
      </div>
    </div>
  );
}
