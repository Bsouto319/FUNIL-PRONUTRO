import { useEffect, useRef, useState, useCallback } from "react";
import { MessageSquare, X, Send, ChevronLeft, Circle } from "lucide-react";
import { supabase } from "../lib/supabase";
import {
  fetchUsuarios, fetchChatMessages, sendChatMessage,
  marcarMensagensLidas, fetchUnreadCounts,
} from "../lib/api";

interface Props {
  currentUser: any;
}

function initials(nome: string) {
  return nome.split(" ").slice(0,2).map((n:string)=>n[0]).join("").toUpperCase();
}

function timeAgo(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const diffMin = Math.floor((now.getTime() - d.getTime()) / 60000);
  if (diffMin < 1)  return "agora";
  if (diffMin < 60) return `${diffMin}min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h`;
  return d.toLocaleDateString("pt-BR", { day:"2-digit", month:"2-digit" });
}

const COLORS = ["#7c3aed","#0284c7","#059669","#d97706","#dc2626","#0891b2","#db2777","#65a30d"];
function userColor(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) & 0xffffffff;
  return COLORS[Math.abs(h) % COLORS.length];
}

export default function TeamChat({ currentUser }: Props) {
  const [open,      setOpen]      = useState(false);
  const [usuarios,  setUsuarios]  = useState<any[]>([]);
  const [chatWith,  setChatWith]  = useState<any | null>(null);
  const [messages,  setMessages]  = useState<any[]>([]);
  const [text,      setText]      = useState("");
  const [sending,   setSending]   = useState(false);
  const [unread,    setUnread]    = useState<Record<string,number>>({});
  const bottomRef = useRef<HTMLDivElement>(null);

  const totalUnread = Object.values(unread).reduce((a,b)=>a+b,0);

  // Load users & unread counts
  const loadUsers = useCallback(async () => {
    const [u, counts] = await Promise.all([
      fetchUsuarios(),
      fetchUnreadCounts(currentUser.id),
    ]);
    setUsuarios(u.filter((u: any) => u.id !== currentUser.id && u.ativo !== false));
    setUnread(counts);
  }, [currentUser.id]);

  useEffect(() => { if (open) loadUsers(); }, [open, loadUsers]);

  // Load messages when chatWith changes
  const loadMessages = useCallback(async () => {
    if (!chatWith) return;
    const msgs = await fetchChatMessages(currentUser.id, chatWith.id);
    setMessages(msgs);
    await marcarMensagensLidas(currentUser.id, chatWith.id);
    setUnread(p => ({ ...p, [chatWith.id]: 0 }));
  }, [chatWith, currentUser.id]);

  useEffect(() => { loadMessages(); }, [loadMessages]);

  // Scroll to bottom
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Realtime subscription
  useEffect(() => {
    if (!open) return;
    const ch = supabase.channel("team_chat")
      .on("postgres_changes", {
        event: "INSERT", schema: "public", table: "pn_chat_mensagens",
      }, (payload: any) => {
        const msg = payload.new;
        const isForMe = msg.destinatario_id === currentUser.id;
        const isFromChatWith = chatWith && msg.remetente_id === chatWith.id;
        const isFromMe = msg.remetente_id === currentUser.id;

        if (chatWith && (isFromChatWith || isFromMe) &&
            (msg.destinatario_id === chatWith.id || msg.remetente_id === chatWith.id)) {
          setMessages(p => [...p, msg]);
          if (isForMe) marcarMensagensLidas(currentUser.id, msg.remetente_id);
        } else if (isForMe) {
          setUnread(p => ({ ...p, [msg.remetente_id]: (p[msg.remetente_id] || 0) + 1 }));
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [open, chatWith, currentUser.id]);

  // Realtime for unread when panel closed
  useEffect(() => {
    if (open) return;
    const ch = supabase.channel("team_chat_bg")
      .on("postgres_changes", {
        event: "INSERT", schema: "public", table: "pn_chat_mensagens",
        filter: `destinatario_id=eq.${currentUser.id}`,
      }, (payload: any) => {
        const msg = payload.new;
        setUnread(p => ({ ...p, [msg.remetente_id]: (p[msg.remetente_id] || 0) + 1 }));
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [open, currentUser.id]);

  // Load initial unread counts
  useEffect(() => {
    fetchUnreadCounts(currentUser.id).then(setUnread);
  }, [currentUser.id]);

  async function handleSend() {
    if (!text.trim() || !chatWith || sending) return;
    setSending(true);
    await sendChatMessage(currentUser.id, chatWith.id, text.trim());
    setText("");
    setSending(false);
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  }

  const myColor = userColor(currentUser.id);

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setOpen(o => !o)}
        className="fixed bottom-5 right-5 z-40 w-13 h-13 rounded-full flex items-center justify-center shadow-2xl transition-all hover:scale-110 active:scale-95"
        style={{ background:"linear-gradient(135deg,#1e3a5f,#0f2240)", border:"1.5px solid rgba(255,255,255,0.15)", width:52, height:52 }}
        title="Chat da equipe"
      >
        <MessageSquare size={22} className="text-white/80" />
        {totalUnread > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] rounded-full bg-emerald-500 text-white text-[10px] font-black flex items-center justify-center px-1 shadow">
            {totalUnread > 9 ? "9+" : totalUnread}
          </span>
        )}
      </button>

      {/* Chat panel */}
      {open && (
        <div
          className="fixed bottom-20 right-5 z-50 w-80 rounded-2xl border border-white/10 flex flex-col overflow-hidden shadow-2xl"
          style={{ background:"rgba(8,18,45,0.97)", backdropFilter:"blur(12px)", maxHeight:"520px" }}
        >
          {!chatWith ? (
            /* ── Contacts list ── */
            <>
              <div className="flex items-center justify-between px-4 py-3.5 border-b border-white/8 shrink-0">
                <div>
                  <p className="text-white font-black text-sm">Chat da Equipe</p>
                  <p className="text-white/30 text-[10px] mt-0.5">{usuarios.length} membros</p>
                </div>
                <button onClick={() => setOpen(false)} className="p-1.5 rounded-lg hover:bg-white/10 text-white/30 transition">
                  <X size={14}/>
                </button>
              </div>

              <div className="flex-1 overflow-y-auto [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:bg-white/10">
                {usuarios.length === 0 ? (
                  <div className="text-center py-10 text-white/25 text-xs">Nenhum membro cadastrado</div>
                ) : (
                  usuarios.map(u => {
                    const color = userColor(u.id);
                    const cnt   = unread[u.id] || 0;
                    return (
                      <button key={u.id} onClick={() => setChatWith(u)}
                        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/5 transition text-left border-b border-white/5">
                        <div className="relative shrink-0">
                          <div className="w-10 h-10 rounded-full flex items-center justify-center font-black text-sm text-white"
                            style={{ background:`${color}30`, border:`1.5px solid ${color}60` }}>
                            {initials(u.nome)}
                          </div>
                          <Circle size={10} className="absolute bottom-0 right-0 text-emerald-400 fill-emerald-400"/>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-white font-bold text-sm truncate">{u.nome}</p>
                          <p className="text-white/30 text-[10px] truncate capitalize">{u.role || "membro"}</p>
                        </div>
                        {cnt > 0 && (
                          <span className="min-w-[20px] h-5 rounded-full bg-emerald-500 text-white text-[10px] font-black flex items-center justify-center px-1 shrink-0">
                            {cnt}
                          </span>
                        )}
                      </button>
                    );
                  })
                )}
              </div>
            </>
          ) : (
            /* ── Chat window ── */
            <>
              {/* Chat header */}
              <div className="flex items-center gap-3 px-4 py-3 border-b border-white/8 shrink-0">
                <button onClick={() => setChatWith(null)} className="p-1 rounded-lg hover:bg-white/10 text-white/40 transition shrink-0">
                  <ChevronLeft size={15}/>
                </button>
                <div className="w-8 h-8 rounded-full flex items-center justify-center font-black text-xs text-white shrink-0"
                  style={{ background:`${userColor(chatWith.id)}30`, border:`1.5px solid ${userColor(chatWith.id)}60` }}>
                  {initials(chatWith.nome)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white font-black text-sm truncate">{chatWith.nome}</p>
                  <p className="text-white/30 text-[10px] capitalize">{chatWith.role || "membro"}</p>
                </div>
                <button onClick={() => setOpen(false)} className="p-1.5 rounded-lg hover:bg-white/10 text-white/30 transition shrink-0">
                  <X size={14}/>
                </button>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:bg-white/10" style={{ minHeight:0 }}>
                {messages.length === 0 && (
                  <div className="text-center py-8 text-white/20 text-xs">Nenhuma mensagem. Diga olá! 👋</div>
                )}
                {messages.map((msg, i) => {
                  const isMe = msg.remetente_id === currentUser.id;
                  const prevMsg = messages[i-1];
                  const showTime = !prevMsg || new Date(msg.created_at).getTime() - new Date(prevMsg.created_at).getTime() > 5 * 60 * 1000;
                  return (
                    <div key={msg.id}>
                      {showTime && (
                        <p className="text-center text-white/20 text-[10px] my-1">{timeAgo(msg.created_at)}</p>
                      )}
                      <div className={`flex ${isMe?"justify-end":"justify-start"}`}>
                        <div className="max-w-[85%] px-3 py-2 rounded-2xl text-sm leading-relaxed"
                          style={{
                            background: isMe ? `${myColor}30` : "rgba(255,255,255,0.08)",
                            borderRadius: isMe ? "18px 18px 4px 18px" : "18px 18px 18px 4px",
                            color: isMe ? "#fff" : "rgba(255,255,255,0.85)",
                            border: isMe ? `1px solid ${myColor}50` : "1px solid rgba(255,255,255,0.08)",
                          }}>
                          {msg.body}
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div ref={bottomRef}/>
              </div>

              {/* Input */}
              <div className="px-3 py-3 border-t border-white/8 shrink-0">
                <div className="flex items-end gap-2">
                  <textarea
                    value={text}
                    onChange={e => setText(e.target.value)}
                    onKeyDown={handleKey}
                    placeholder="Digite uma mensagem..."
                    rows={1}
                    className="flex-1 px-3 py-2 rounded-xl bg-white/8 border border-white/10 text-white text-sm placeholder-white/25 focus:outline-none focus:ring-1 focus:ring-emerald-500/40 resize-none"
                    style={{ maxHeight: 80 }}
                  />
                  <button onClick={handleSend} disabled={!text.trim() || sending}
                    className="p-2.5 rounded-xl transition disabled:opacity-30"
                    style={{ background:"#059669" }}>
                    <Send size={15} className="text-white"/>
                  </button>
                </div>
                <p className="text-white/15 text-[10px] mt-1.5 text-center">Enter para enviar · Shift+Enter nova linha</p>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}
