import React, { useState, useEffect } from 'react';
import { 
  LineChart, Line, BarChart, Bar, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from 'recharts';
import { Search, TrendingUp, AlertCircle, Info, Database, Activity, DollarSign, Briefcase, RefreshCw } from 'lucide-react';

// --- CONFIGURAÇÃO DA API ---
// Toda a comunicação passa pela serverless function /api/proxy
// que injeta os headers corretos para contornar o Cloudflare do StatusInvest.
const SI_BASE = 'https://statusinvest.com.br';

const proxyFetch = async (path) => {
  const targetUrl = `${SI_BASE}${path}`;
  const proxyUrl = `/api/proxy?url=${encodeURIComponent(targetUrl)}`;
  const res = await fetch(proxyUrl);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
};

// --- FUNÇÕES DE NORMALIZAÇÃO ---

const normalizeGenericChartData = (data) => {
  if (!data) return [];

  if (Array.isArray(data) && data.length > 0 && (data[0].date || data[0].d)) {
    return data.map(item => ({
      name: item.date || item.d || item.year,
      value: Number(item.value ?? item.v ?? 0)
    }));
  }

  if (data.categories && data.series && data.series.length > 0) {
    const categories = data.categories;
    const seriesData = data.series[0].data;
    return categories.map((cat, index) => ({
      name: String(cat),
      value: Number(seriesData[index] ?? 0)
    }));
  }

  return [];
};

const normalizeProventos = (data) => {
  if (!data || !data.assetEarningsModels) return [];
  return data.assetEarningsModels
    .map(item => ({
      name: item.ed || item.pd,
      value: Number(item.v || 0),
      type: item.et,
    }))
    .sort((a, b) => {
      const parse = (d) => {
        if (!d) return 0;
        const parts = d.split('/');
        if (parts.length === 3) return new Date(`${parts[2]}-${parts[1]}-${parts[0]}`).getTime();
        return new Date(d).getTime();
      };
      return parse(a.name) - parse(b.name);
    });
};

// --- DADOS SIMULADOS (FALLBACK) ---
const generateMockData = (ticker) => {
  const isFii = ticker.length === 6 && ticker.endsWith('11');
  const years = ['2019', '2020', '2021', '2022', '2023', '2024'];
  const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  return {
    patrimonio:  years.map((y, i) => ({ name: y, value: 1e9 + i * 1.5e8 + Math.random() * 5e7 })),
    receitas:    years.map((y, i) => ({ name: y, value: 2e8 + i * 2e7 + Math.random() * 1e7 })),
    despesas:    years.map((y, i) => ({ name: y, value: 1.5e8 + i * 1e7 + Math.random() * 5e6 })),
    caixa:       years.map((y) =>    ({ name: y, value: 5e7  + Math.random() * 2e7 })),
    resultado:   years.map((y, i) => ({ name: y, value: 5e7  + i * 1e7 + Math.random() * 5e6 })),
    proventos:   months.map((m) => ({
      name: m,
      value: isFii ? (0.8 + Math.random() * 0.4) : (Math.random() > 0.7 ? 1.5 + Math.random() * 2 : 0),
      type: isFii ? 'Rendimento' : 'Dividendo',
    })),
    isMock: true,
    categoria: isFii ? 'FII' : 'AÇÃO',
  };
};

// --- COMPONENTES UI ---

const Card = ({ title, icon: Icon, children }) => (
  <div className="bg-zinc-900 rounded-2xl p-6 flex flex-col h-full">
    <div className="flex items-center space-x-3 mb-6">
      {Icon && <Icon className="text-zinc-400 w-5 h-5 flex-shrink-0" />}
      <h3 className="text-zinc-100 font-medium text-lg tracking-wide">{title}</h3>
    </div>
    <div className="flex-grow w-full min-h-[250px]">
      {children}
    </div>
  </div>
);

const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-black border border-zinc-800 p-4 rounded-lg shadow-2xl">
        <p className="text-zinc-400 text-sm mb-1">{label}</p>
        {payload.map((entry, index) => (
          <p key={index} className="text-zinc-100 font-semibold text-lg">
            {new Intl.NumberFormat('pt-BR', {
              style: 'currency',
              currency: 'BRL',
              notation: 'compact',
              maximumFractionDigits: 2,
            }).format(entry.value)}
          </p>
        ))}
      </div>
    );
  }
  return null;
};

const StatusBadge = ({ isMock }) => (
  <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium ${
    isMock
      ? 'bg-amber-950 text-amber-400 border border-amber-900'
      : 'bg-emerald-950 text-emerald-400 border border-emerald-900'
  }`}>
    <span className={`w-1.5 h-1.5 rounded-full ${isMock ? 'bg-amber-400' : 'bg-emerald-400'} animate-pulse`} />
    {isMock ? 'Dados Simulados' : 'Dados Reais'}
  </span>
);

// --- COMPONENTE PRINCIPAL ---

export default function App() {
  const [tickerInput, setTickerInput] = useState('MXRF11');
  const [currentTicker, setCurrentTicker] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState(null);

  const fetchFinancialData = async (tickerRaw) => {
    const ticker = tickerRaw.trim().toUpperCase();
    if (!ticker) return;

    setLoading(true);
    setError('');
    setData(null);
    setCurrentTicker(ticker);

    try {
      // 1. Descobrir categoria do ativo
      const searchData = await proxyFetch(`/home/mainsearchquery?q=${ticker}`);

      let categoria = 'acoes';
      if (Array.isArray(searchData) && searchData.length > 0) {
        const urlStr = searchData[0].url || '';
        if (urlStr.includes('fundos-imobiliarios')) categoria = 'fii';
        else if (urlStr.includes('fiagros'))         categoria = 'fiagro';
        else if (urlStr.includes('acoes'))           categoria = 'acoes';
      }

      // 2. Endpoints a buscar
      const endpoints = {
        patrimonio: `/${categoria}/getpatrimonioliquido?code=${ticker}&type=0`,
        receitas:   `/${categoria}/getreceitas?code=${ticker}&type=0`,
        despesas:   `/${categoria}/getdespesas?code=${ticker}&type=0`,
        caixa:      `/${categoria}/getcaixa?code=${ticker}&type=0`,
        resultado:  `/${categoria}/getresultado?code=${ticker}&type=0`,
        proventos:  `/${categoria}/companytickerprovents?companyName=${ticker}&chartProventsType=1`,
      };

      // 3. Buscar em paralelo (falhas individuais não quebram os outros)
      const safeFetch = async (path) => {
        try { return await proxyFetch(path); }
        catch { return null; }
      };

      const [pat, rec, desp, caixa, res, prov] = await Promise.all([
        safeFetch(endpoints.patrimonio),
        safeFetch(endpoints.receitas),
        safeFetch(endpoints.despesas),
        safeFetch(endpoints.caixa),
        safeFetch(endpoints.resultado),
        safeFetch(endpoints.proventos),
      ]);

      // Se absolutamente tudo falhou, cai no mock
      const allNull = [pat, rec, desp, caixa, res, prov].every(r => r === null || (typeof r === 'object' && !Array.isArray(r) && Object.keys(r).length === 0));
      if (allNull) throw new Error('Todos os endpoints retornaram vazios.');

      setData({
        patrimonio: normalizeGenericChartData(pat),
        receitas:   normalizeGenericChartData(rec),
        despesas:   normalizeGenericChartData(desp),
        caixa:      normalizeGenericChartData(caixa),
        resultado:  normalizeGenericChartData(res),
        proventos:  normalizeProventos(prov),
        isMock: false,
        categoria: categoria === 'fii' ? 'FII' : categoria === 'fiagro' ? 'FIAGRO' : 'AÇÃO',
      });

    } catch (err) {
      console.warn('[App] Fallback para dados simulados:', err.message);
      setData(generateMockData(ticker));
      setError(
        `Não foi possível obter dados reais para ${ticker} (${err.message}). ` +
        `A exibir dados simulados para demonstração da interface.`
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchFinancialData('MXRF11'); }, []);

  const handleSubmit = (e) => {
    e.preventDefault();
    fetchFinancialData(tickerInput);
  };

  return (
    <div className="min-h-screen bg-black text-zinc-300 font-sans pb-20">

      {/* HEADER */}
      <header className="border-b border-zinc-900 bg-black sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-5 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-zinc-100 rounded-full flex items-center justify-center flex-shrink-0">
              <Activity className="text-black w-6 h-6" />
            </div>
            <h1 className="text-2xl font-bold text-zinc-100 tracking-tight">StatusMono</h1>
          </div>

          <form onSubmit={handleSubmit} className="w-full sm:w-96 relative">
            <input
              type="text"
              value={tickerInput}
              onChange={(e) => setTickerInput(e.target.value.toUpperCase())}
              placeholder="Pesquisar ticker (ex: PETR4, MXRF11)"
              className="w-full bg-zinc-900 text-zinc-100 px-5 py-3 rounded-full outline-none focus:ring-2 focus:ring-zinc-700 placeholder-zinc-600 transition-all border-none"
            />
            <button
              type="submit"
              disabled={loading}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-2 bg-zinc-800 rounded-full text-zinc-300 hover:text-white hover:bg-zinc-700 transition-colors disabled:opacity-50"
            >
              {loading
                ? <RefreshCw className="w-4 h-4 animate-spin" />
                : <Search className="w-4 h-4" />
              }
            </button>
          </form>
        </div>
      </header>

      {/* CONTEÚDO PRINCIPAL */}
      <main className="max-w-7xl mx-auto px-6 mt-10">

        {/* CABEÇALHO DO ATIVO */}
        {currentTicker && !loading && (
          <div className="mb-8 flex flex-wrap items-baseline gap-4">
            <h2 className="text-5xl font-black text-white tracking-tighter">{currentTicker}</h2>
            {data?.categoria && (
              <span className="bg-zinc-800 text-zinc-300 px-3 py-1 rounded-md text-sm font-medium tracking-widest">
                {data.categoria}
              </span>
            )}
            {data && <StatusBadge isMock={data.isMock} />}
          </div>
        )}

        {/* AVISO DE ERRO / MOCK */}
        {error && (
          <div className="mb-8 p-4 bg-amber-950/30 border border-amber-900/50 rounded-xl flex items-start gap-3">
            <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5 text-amber-500" />
            <p className="text-sm text-amber-400/80 leading-relaxed">{error}</p>
          </div>
        )}

        {/* LOADING */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-32 space-y-4">
            <div className="w-12 h-12 border-4 border-zinc-800 border-t-zinc-100 rounded-full animate-spin" />
            <p className="text-zinc-500 font-medium animate-pulse">Extraindo dados do mercado…</p>
          </div>

        ) : data ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

            {/* Património Líquido */}
            <Card title="Património Líquido" icon={Database}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data.patrimonio} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gradPat" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#ffffff" stopOpacity={0.15} />
                      <stop offset="95%" stopColor="#ffffff" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                  <XAxis dataKey="name" stroke="#52525b" tick={{ fill: '#a1a1aa', fontSize: 12 }} axisLine={false} tickLine={false} />
                  <YAxis stroke="#52525b" tick={{ fill: '#a1a1aa', fontSize: 12 }} axisLine={false} tickLine={false}
                    tickFormatter={(v) => `${(v / 1e6).toFixed(0)}M`} />
                  <Tooltip content={<CustomTooltip />} />
                  <Area type="monotone" dataKey="value" stroke="#ffffff" strokeWidth={2} fillOpacity={1} fill="url(#gradPat)" />
                </AreaChart>
              </ResponsiveContainer>
            </Card>

            {/* Receitas & Despesas */}
            <Card title="Receitas & Despesas" icon={TrendingUp}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                  <XAxis dataKey="name" data={data.receitas} stroke="#52525b" tick={{ fill: '#a1a1aa', fontSize: 12 }} axisLine={false} tickLine={false} />
                  <YAxis stroke="#52525b" tick={{ fill: '#a1a1aa', fontSize: 12 }} axisLine={false} tickLine={false}
                    tickFormatter={(v) => `${(v / 1e6).toFixed(0)}M`} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ paddingTop: '20px', fontSize: '12px', color: '#a1a1aa' }} iconType="circle" />
                  <Line type="monotone" data={data.receitas}  dataKey="value" name="Receitas" stroke="#ffffff" strokeWidth={2} dot={false} />
                  <Line type="monotone" data={data.despesas} dataKey="value" name="Despesas" stroke="#52525b" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </Card>

            {/* Resultado Líquido */}
            <Card title="Resultado Líquido" icon={Briefcase}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.resultado} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                  <XAxis dataKey="name" stroke="#52525b" tick={{ fill: '#a1a1aa', fontSize: 12 }} axisLine={false} tickLine={false} />
                  <YAxis stroke="#52525b" tick={{ fill: '#a1a1aa', fontSize: 12 }} axisLine={false} tickLine={false}
                    tickFormatter={(v) => `${(v / 1e6).toFixed(0)}M`} />
                  <Tooltip content={<CustomTooltip />} cursor={{ fill: '#27272a' }} />
                  <Bar dataKey="value" fill="#d4d4d8" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </Card>

            {/* Histórico de Proventos */}
            <Card title="Histórico de Proventos" icon={DollarSign}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.proventos} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                  <XAxis dataKey="name" stroke="#52525b" tick={{ fill: '#a1a1aa', fontSize: 12 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                  <YAxis stroke="#52525b" tick={{ fill: '#a1a1aa', fontSize: 12 }} axisLine={false} tickLine={false} />
                  <Tooltip content={<CustomTooltip />} cursor={{ fill: '#27272a' }} />
                  <Bar dataKey="value" fill="#ffffff" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </Card>

            {/* Tabela de Proventos Recentes */}
            {data.proventos && data.proventos.length > 0 && (
              <div className="md:col-span-2 bg-zinc-900 rounded-2xl p-6">
                <div className="flex items-center space-x-3 mb-6">
                  <Info className="text-zinc-400 w-5 h-5" />
                  <h3 className="text-zinc-100 font-medium text-lg tracking-wide">Últimos Proventos</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-zinc-800 text-zinc-500 text-sm">
                        <th className="pb-4 font-normal">Data (Com)</th>
                        <th className="pb-4 font-normal">Tipo</th>
                        <th className="pb-4 font-normal text-right">Valor (R$)</th>
                      </tr>
                    </thead>
                    <tbody className="text-zinc-300">
                      {data.proventos.slice(-12).reverse().map((prov, idx) => (
                        <tr key={idx} className="border-b border-zinc-800/50 hover:bg-zinc-800/20 transition-colors">
                          <td className="py-4">{prov.name}</td>
                          <td className="py-4 text-zinc-400">{prov.type || 'Rendimento'}</td>
                          <td className="py-4 text-right font-medium text-zinc-100">
                            {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(prov.value)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

          </div>
        ) : (
          !loading && !currentTicker && (
            <div className="flex flex-col items-center justify-center py-32 space-y-2 text-zinc-600">
              <Activity className="w-12 h-12 mb-4" />
              <p className="text-lg font-medium">Pesquise um ticker para começar</p>
              <p className="text-sm">Ex: MXRF11, PETR4, HGLG11</p>
            </div>
          )
        )}
      </main>
    </div>
  );
}
