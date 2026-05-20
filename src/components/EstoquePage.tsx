import { useEffect, useState } from "react";
import { fetchEstoque, upsertEstoque, desativarEstoque, fetchEstoqueMovimentos, insertEstoqueMovimento } from "../lib/api";
import { Package, Plus, AlertTriangle, TrendingDown, TrendingUp, RotateCcw, X, ChevronDown, ChevronUp, Edit2, Trash2, Activity } from "lucide-react";

const CATEGORIAS = ["Suplemento", "Medicamento", "Material", "Embalagem", "Higiene", "Outros"];
const UNIDADES   = ["un", "cx", "frasco", "kg", "g", "ml", "L", "pct", "par"];
const TIPOS_MOV  = [
  { key: "entrada",  label: "Entrada",  color: "#10b981", icon: TrendingUp  },
  { key: "saida",    label: "Saída",    color: "#ef4444", icon: TrendingDown },
  { key: "consumo",  label: "Consumo",  color: "#f59e0b", icon: Activity     },
  { key: "ajuste",   label: "Ajuste",   color: "#6366f1", icon: RotateCcw   },
];

function formatBRL(v: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
}
function stockColor(atual: number, min: number) {
  if (atual <= 0)       return { bg: "rgba(239,68,68,0.15)", border: "rgba(239,68,68,0.4)", text: "#f87171" };
  if (atual <= min)     return { bg: "rgba(245,158,11,0.12)", border: "rgba(245,158,11,0.4)", text: "#fbbf24" };
  return                       { bg: "rgba(16,185,129,0.1)",  border: "rgba(16,185,129,0.3)", text: "#34d399" };
}

const EMPTY_ITEM = { nome: "", categoria: "Suplemento", unidade: "un", estoque_atual: 0, estoque_min: 5, valor_unitario: 0 };

export default function EstoquePage() {
  const [itens,       setItens]       = useState<any[]>([]);
  const [movimentos,  setMovimentos]  = useState<any[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [search,      setSearch]      = useState("");
  const [catFilter,   setCatFilter]   = useState("");
  const [showForm,    setShowForm]    = useState(false);
  const [editItem,    setEditItem]    = useState<any>(null);
  const [formData,    setFormData]    = useState<any>(EMPTY_ITEM);
  const [saving,      setSaving]      = useState(false);
  const [showMov,     setShowMov]     = useState(false);
  const [movItemId,   setMovItemId]   = useState<string | null>(null);
  const [movForm,     setMovForm]     = useState({ tipo: "entrada" as any, quantidade: "", obs: "", valor_unit: "" });
  const [savingMov,   setSavingMov]   = useState(false);
  const [showLog,     setShowLog]     = useState(false);

  async function load() {
    setLoading(true);
    const [items, movs] = await Promise.all([fetchEstoque(), fetchEstoqueMovimentos(undefined, 60)]);
    setItens(items);
    setMovimentos(movs);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const filtered = itens.filter(i => {
    const q = search.toLowerCase();
    const matchSearch = !q || i.nome.toLowerCase().includes(q) || (i.categoria || "").toLowerCase().includes(q);
    const matchCat = !catFilter || i.categoria === catFilter;
    return matchSearch && matchCat;
  });

  const baixoEstoque = itens.filter(i => i.estoque_atual <= i.estoque_min);
  const valorTotal   = itens.reduce((acc, i) => acc + (i.estoque_atual * (i.valor_unitario || 0)), 0);

  function openNew() {
    setEditItem(null);
    setFormData(EMPTY_ITEM);
    setShowForm(true);
  }
  function openEdit(item: any) {
    setEditItem(item);
    setFormData({ nome: item.nome, categoria: item.categoria, unidade: item.unidade,
      estoque_atual: item.estoque_atual, estoque_min: item.estoque_min, valor_unitario: item.valor_unitario });
    setShowForm(true);
  }
  async function handleSaveItem() {
    setSaving(true);
    await upsertEstoque({ ...formData, id: editItem?.id });
    setShowForm(false);
    await load();
    setSaving(false);
  }
  async function handleDelete(id: string) {
    if (!confirm("Desativar este item do estoque?")) return;
    await desativarEstoque(id);
    await load();
  }
  function openMov(itemId: string) {
    setMovItemId(itemId);
    setMovForm({ tipo: "entrada", quantidade: "", obs: "", valor_unit: "" });
    setShowMov(true);
  }
  async function handleSaveMov() {
    if (!movItemId || !movForm.quantidade) return;
    setSavingMov(true);
    await insertEstoqueMovimento({
      estoque_id: movItemId,
      tipo:       movForm.tipo,
      quantidade: parseFloat(movForm.quantidade.replace(",", ".")),
      valor_unit: movForm.valor_unit ? parseFloat(movForm.valor_unit.replace(",", ".")) : undefined,
      obs:        movForm.obs || undefined,
    });
    setShowMov(false);
    await load();
    setSavingMov(false);
  }

  return (
    <div className="h-full overflow-y-auto [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-white/10 [&::-webkit-scrollbar-thumb]:rounded-full"
      style={{ background: "linear-gradient(160deg,#0a1628 0%,#0f2240 35%,#071830 100%)" }}>
      <div className="px-5 py-5 space-y-5 max-w-6xl mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-400 to-orange-600 flex items-center justify-center shadow-lg shadow-amber-500/30">
              <Package size={18} className="text-white" />
            </div>
            <div>
              <h1 className="text-white font-black text-lg leading-none">Controle de Estoque</h1>
              <p className="text-white/35 text-[10px] font-bold tracking-wide mt-0.5">INVENTÁRIO DA CLÍNICA</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setShowLog(s => !s)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-black border transition ${showLog ? "bg-violet-500/20 border-violet-500/40 text-violet-300" : "bg-white/5 border-white/10 text-white/50 hover:text-white/80"}`}>
              <Activity size={12} />
              {showLog ? "Ocultar" : "Histórico"}
            </button>
            <button onClick={openNew}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-black border bg-amber-500/20 border-amber-500/40 text-amber-300 hover:bg-amber-500/30 transition">
              <Plus size={13} />
              Novo Item
            </button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Itens Ativos",    value: itens.length,              color: "#3b82f6", icon: Package      },
            { label: "Baixo Estoque",   value: baixoEstoque.length,       color: "#ef4444", icon: AlertTriangle },
            { label: "Itens Zerados",   value: itens.filter(i => i.estoque_atual <= 0).length, color: "#f59e0b", icon: TrendingDown },
            { label: "Valor em Estoque",value: formatBRL(valorTotal),     color: "#10b981", icon: TrendingUp   },
          ].map(({ label, value, color, icon: Icon }) => (
            <div key={label} className="rounded-xl border border-white/8 p-3.5 flex items-center gap-3" style={{ background: "rgba(255,255,255,0.04)" }}>
              <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: `${color}22` }}>
                <Icon size={18} style={{ color }} />
              </div>
              <div>
                <p className="text-white font-black text-xl leading-none">{value}</p>
                <p className="text-white/35 text-[10px] font-bold uppercase tracking-wide mt-0.5">{label}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Low stock alert */}
        {baixoEstoque.length > 0 && (
          <div className="rounded-xl border border-red-500/25 px-4 py-3 flex items-start gap-3" style={{ background: "rgba(239,68,68,0.08)" }}>
            <AlertTriangle size={15} className="text-red-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-red-300 font-black text-sm">Atenção: {baixoEstoque.length} item{baixoEstoque.length !== 1 ? "s" : ""} com estoque baixo ou zerado</p>
              <p className="text-red-400/70 text-[11px] mt-0.5">
                {baixoEstoque.slice(0, 5).map(i => i.nome).join(" · ")}
                {baixoEstoque.length > 5 && ` · +${baixoEstoque.length - 5} mais`}
              </p>
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="flex items-center gap-2 flex-wrap">
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Buscar item..."
            className="px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-white text-sm placeholder-white/25 focus:outline-none focus:ring-2 focus:ring-amber-500/40 min-w-[200px]" />
          <div className="flex items-center gap-1 flex-wrap">
            <button onClick={() => setCatFilter("")}
              className={`px-2.5 py-1.5 rounded-lg text-[10px] font-black border transition ${!catFilter ? "bg-white/15 border-white/25 text-white" : "border-white/8 text-white/35 hover:text-white/60"}`}>
              Todos
            </button>
            {CATEGORIAS.map(c => (
              <button key={c} onClick={() => setCatFilter(catFilter === c ? "" : c)}
                className={`px-2.5 py-1.5 rounded-lg text-[10px] font-black border transition ${catFilter === c ? "bg-amber-500/20 border-amber-500/40 text-amber-300" : "border-white/8 text-white/35 hover:text-white/60"}`}>
                {c}
              </button>
            ))}
          </div>
        </div>

        {/* Items table */}
        <div className="rounded-2xl border border-white/8 overflow-hidden" style={{ background: "rgba(255,255,255,0.03)" }}>
          <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_auto] gap-0 border-b border-white/8">
            {["Item / Categoria", "Unidade", "Estoque Atual", "Estoque Mín.", "Valor Unit.", "Ações"].map(h => (
              <div key={h} className="px-4 py-2.5 text-white/25 text-[9px] font-black uppercase tracking-widest">{h}</div>
            ))}
          </div>

          {loading ? (
            <div className="text-white/20 text-sm text-center py-16">Carregando...</div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Package size={28} className="text-white/10 mb-3" />
              <p className="text-white/20 text-sm font-semibold">Nenhum item encontrado</p>
              <button onClick={openNew} className="mt-3 text-amber-400 text-xs font-black hover:text-amber-300 transition">+ Adicionar primeiro item</button>
            </div>
          ) : (
            filtered.map((item, idx) => {
              const sc = stockColor(item.estoque_atual, item.estoque_min);
              return (
                <div key={item.id} className={`grid grid-cols-[2fr_1fr_1fr_1fr_1fr_auto] items-center gap-0 border-b border-white/5 hover:bg-white/[0.03] transition ${idx % 2 === 0 ? "" : ""}`}>
                  <div className="px-4 py-3">
                    <p className="text-white font-black text-sm leading-tight">{item.nome}</p>
                    <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full mt-0.5 inline-block" style={{ background: "rgba(99,102,241,0.15)", color: "#a5b4fc" }}>{item.categoria}</span>
                  </div>
                  <div className="px-4 py-3 text-white/50 text-sm font-bold">{item.unidade}</div>
                  <div className="px-4 py-3">
                    <span className="font-black text-sm px-2 py-0.5 rounded-lg border" style={{ background: sc.bg, borderColor: sc.border, color: sc.text }}>
                      {item.estoque_atual}
                    </span>
                  </div>
                  <div className="px-4 py-3 text-white/40 text-sm">{item.estoque_min}</div>
                  <div className="px-4 py-3 text-emerald-300 text-sm font-black">{formatBRL(item.valor_unitario || 0)}</div>
                  <div className="px-3 py-3 flex items-center gap-1">
                    <button onClick={() => openMov(item.id)} title="Registrar movimento"
                      className="p-1.5 rounded-lg bg-amber-500/15 text-amber-400 hover:bg-amber-500/25 border border-amber-500/25 transition">
                      <Plus size={12} />
                    </button>
                    <button onClick={() => openEdit(item)} title="Editar"
                      className="p-1.5 rounded-lg bg-white/5 text-white/40 hover:bg-white/10 border border-white/10 transition">
                      <Edit2 size={12} />
                    </button>
                    <button onClick={() => handleDelete(item.id)} title="Desativar"
                      className="p-1.5 rounded-lg bg-red-500/10 text-red-400/60 hover:bg-red-500/20 border border-red-500/20 transition">
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Movement log */}
        {showLog && (
          <div className="rounded-2xl border border-white/8 overflow-hidden" style={{ background: "rgba(255,255,255,0.03)" }}>
            <div className="px-4 py-3 border-b border-white/8 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Activity size={13} className="text-violet-400" />
                <p className="text-white font-black text-sm">Histórico de Movimentos</p>
                <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full bg-white/10 text-white/40">últimos 60</span>
              </div>
              <button onClick={() => setShowLog(false)} className="p-1 rounded hover:bg-white/10 text-white/30 hover:text-white/60 transition">
                <X size={13} />
              </button>
            </div>
            <div className="divide-y divide-white/5 max-h-64 overflow-y-auto [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:bg-white/10]">
              {movimentos.length === 0 ? (
                <p className="text-white/20 text-xs text-center py-8">Nenhum movimento registrado</p>
              ) : movimentos.map(mv => {
                const tipoMeta = TIPOS_MOV.find(t => t.key === mv.tipo) || TIPOS_MOV[0];
                const Icon = tipoMeta.icon;
                return (
                  <div key={mv.id} className="px-4 py-2.5 flex items-center gap-3">
                    <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${tipoMeta.color}20` }}>
                      <Icon size={12} style={{ color: tipoMeta.color }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-white font-black text-xs truncate">{mv.item?.nome || "—"}</p>
                      {mv.obs && <p className="text-white/35 text-[10px] truncate">{mv.obs}</p>}
                    </div>
                    <div className="text-right shrink-0">
                      <span className="font-black text-sm" style={{ color: tipoMeta.color }}>
                        {mv.tipo === "saida" || mv.tipo === "consumo" ? "-" : mv.tipo === "ajuste" ? "=" : "+"}
                        {mv.quantidade} {mv.item?.unidade || ""}
                      </span>
                      <p className="text-white/25 text-[9px] mt-0.5">{new Date(mv.created_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Modal: Add/Edit Item */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(6px)" }}>
          <div className="w-full max-w-md rounded-2xl border border-white/10 shadow-2xl overflow-hidden" style={{ background: "rgba(10,20,55,0.98)" }}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
              <p className="text-white font-black text-sm">{editItem ? "Editar Item" : "Novo Item"}</p>
              <button onClick={() => setShowForm(false)} className="p-1.5 rounded-lg hover:bg-white/10 text-white/40 transition"><X size={15} /></button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div>
                <label className="text-white/40 text-[10px] font-black uppercase mb-1 block">Nome do Item *</label>
                <input value={formData.nome} onChange={e => setFormData((p: any) => ({ ...p, nome: e.target.value }))}
                  placeholder="Ex: Whey Protein 1kg"
                  className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white text-sm placeholder-white/20 focus:outline-none focus:ring-2 focus:ring-amber-500/40" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-white/40 text-[10px] font-black uppercase mb-1 block">Categoria</label>
                  <select value={formData.categoria} onChange={e => setFormData((p: any) => ({ ...p, categoria: e.target.value }))}
                    className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white text-sm focus:outline-none">
                    {CATEGORIAS.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-white/40 text-[10px] font-black uppercase mb-1 block">Unidade</label>
                  <select value={formData.unidade} onChange={e => setFormData((p: any) => ({ ...p, unidade: e.target.value }))}
                    className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white text-sm focus:outline-none">
                    {UNIDADES.map(u => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-white/40 text-[10px] font-black uppercase mb-1 block">Qtd. Atual</label>
                  <input type="number" value={formData.estoque_atual} onChange={e => setFormData((p: any) => ({ ...p, estoque_atual: parseFloat(e.target.value) || 0 }))}
                    className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/40" />
                </div>
                <div>
                  <label className="text-white/40 text-[10px] font-black uppercase mb-1 block">Estoque Mín.</label>
                  <input type="number" value={formData.estoque_min} onChange={e => setFormData((p: any) => ({ ...p, estoque_min: parseFloat(e.target.value) || 0 }))}
                    className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/40" />
                </div>
                <div>
                  <label className="text-white/40 text-[10px] font-black uppercase mb-1 block">Valor Unit.</label>
                  <input type="number" step="0.01" value={formData.valor_unitario} onChange={e => setFormData((p: any) => ({ ...p, valor_unitario: parseFloat(e.target.value) || 0 }))}
                    className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/40" />
                </div>
              </div>
            </div>
            <div className="px-5 pb-4 flex gap-2">
              <button onClick={() => setShowForm(false)}
                className="flex-1 py-2.5 rounded-xl text-xs font-black border border-white/10 text-white/40 hover:bg-white/5 transition">
                Cancelar
              </button>
              <button onClick={handleSaveItem} disabled={!formData.nome || saving}
                className="flex-1 py-2.5 rounded-xl text-xs font-black border bg-amber-500/20 border-amber-500/40 text-amber-300 hover:bg-amber-500/30 transition disabled:opacity-40">
                {saving ? "Salvando..." : "Salvar Item"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Registrar Movimento */}
      {showMov && movItemId && (() => {
        const item = itens.find(i => i.id === movItemId);
        const tipoMeta = TIPOS_MOV.find(t => t.key === movForm.tipo) || TIPOS_MOV[0];
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(6px)" }}>
            <div className="w-full max-w-sm rounded-2xl border border-white/10 shadow-2xl overflow-hidden" style={{ background: "rgba(10,20,55,0.98)" }}>
              <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
                <div>
                  <p className="text-white font-black text-sm">Registrar Movimento</p>
                  <p className="text-white/35 text-[10px] mt-0.5">{item?.nome}</p>
                </div>
                <button onClick={() => setShowMov(false)} className="p-1.5 rounded-lg hover:bg-white/10 text-white/40 transition"><X size={15} /></button>
              </div>
              <div className="px-5 py-4 space-y-3">
                {/* Tipo */}
                <div>
                  <label className="text-white/40 text-[10px] font-black uppercase mb-1.5 block">Tipo de Movimento</label>
                  <div className="grid grid-cols-2 gap-2">
                    {TIPOS_MOV.map(t => {
                      const Icon = t.icon;
                      const active = movForm.tipo === t.key;
                      return (
                        <button key={t.key} onClick={() => setMovForm(p => ({ ...p, tipo: t.key }))}
                          className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-black border transition"
                          style={{ background: active ? `${t.color}22` : "rgba(255,255,255,0.04)", borderColor: active ? `${t.color}60` : "rgba(255,255,255,0.08)", color: active ? t.color : "rgba(255,255,255,0.35)" }}>
                          <Icon size={11} />{t.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
                {/* Quantidade */}
                <div>
                  <label className="text-white/40 text-[10px] font-black uppercase mb-1 block">
                    {movForm.tipo === "ajuste" ? "Novo Estoque (definir para)" : "Quantidade"}
                    <span className="ml-1 normal-case text-white/25">({item?.unidade})</span>
                    {item && <span className="ml-2 text-white/20">atual: {item.estoque_atual}</span>}
                  </label>
                  <input type="number" value={movForm.quantidade} onChange={e => setMovForm(p => ({ ...p, quantidade: e.target.value }))}
                    placeholder="0"
                    className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white text-sm placeholder-white/20 focus:outline-none focus:ring-2"
                    style={{ "--tw-ring-color": tipoMeta.color } as any} />
                </div>
                {/* Valor unitário (opcional) */}
                <div>
                  <label className="text-white/40 text-[10px] font-black uppercase mb-1 block">Valor Unit. (opcional)</label>
                  <input type="number" step="0.01" value={movForm.valor_unit} onChange={e => setMovForm(p => ({ ...p, valor_unit: e.target.value }))}
                    placeholder="0,00"
                    className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white text-sm placeholder-white/20 focus:outline-none" />
                </div>
                {/* Observação */}
                <div>
                  <label className="text-white/40 text-[10px] font-black uppercase mb-1 block">Observação</label>
                  <input value={movForm.obs} onChange={e => setMovForm(p => ({ ...p, obs: e.target.value }))}
                    placeholder="Ex: Compra fornecedor X"
                    className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white text-sm placeholder-white/20 focus:outline-none" />
                </div>
              </div>
              <div className="px-5 pb-4 flex gap-2">
                <button onClick={() => setShowMov(false)}
                  className="flex-1 py-2.5 rounded-xl text-xs font-black border border-white/10 text-white/40 hover:bg-white/5 transition">
                  Cancelar
                </button>
                <button onClick={handleSaveMov} disabled={!movForm.quantidade || savingMov}
                  className="flex-1 py-2.5 rounded-xl text-xs font-black border transition disabled:opacity-40"
                  style={{ background: `${tipoMeta.color}22`, borderColor: `${tipoMeta.color}60`, color: tipoMeta.color }}>
                  {savingMov ? "Salvando..." : "Confirmar"}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
