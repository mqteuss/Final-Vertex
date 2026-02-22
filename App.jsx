import React, { useState, useEffect } from 'react';
import { 
  LineChart, Line, BarChart, Bar, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from 'recharts';
import { Search, TrendingUp, AlertCircle, Info, Database, Activity, DollarSign, Briefcase } from 'lucide-react';

// --- CONFIGURAÇÃO DA API (OTIMIZADA PARA VERCEL) ---
// Deteta se estamos num ambiente de produção (ex: Vercel) ou localmente
const IS_PRODUCTION = window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1';

// No Vercel, usamos o "Rewrite" nativo (configurado no vercel.json) para evitar bloqueios de CORS.
// Localmente, continuamos a usar o proxy público allorigins como fallback.
const BASE_URL = IS_PRODUCTION ? "/api/statusinvest" : "https://statusinvest.com.br";
const CORS_PROXY = IS_PRODUCTION ? "" : "https://api.allorigins.win/raw?url=";

// Função auxiliar para processar o URL final de acordo com o ambiente
const getFetchUrl = (url) => IS_PRODUCTION ? url : `${CORS_PROXY}${encodeURIComponent(url)}`;

// --- FUNÇÕES UTILITÁRIAS E DE NORMALIZAÇÃO DE DADOS ---

// O StatusInvest devolve JSONs com estruturas variáveis. 
// Estas funções tentam normalizar os dados para o formato que o Recharts espera: [{ name: 'Jan', value: 100 }, ...]
const normalizeGenericChartData = (data) => {
  if (!data) return [];
  
  // Caso 1: Array simples de objetos com data/value
  if (Array.isArray(data) && data.length > 0 && (data[0].date || data[0].d)) {
    return data.map(item => ({
      name: item.date || item.d || item.year,
      value: Number(item.value || item.v || 0)
    }));
  }

  // Caso 2: Estrutura com categories e series (muito comum em gráficos do SI)
  if (data.categories && data.series && data.series.length > 0) {
    const categories = data.categories;
    const seriesData = data.series[0].data; // Assume a primeira série principal
    return categories.map((cat, index) => ({
      name: String(cat),
      value: Number(seriesData[index] || 0)
    }));
  }

  return [];
};

const normalizeProventos = (data) => {
  if (!data || !data.assetEarningsModels) return [];
  return data.assetEarningsModels.map(item => ({
    name: item.ed || item.pd, // Data de com/pagamento
    value: Number(item.v || 0),
    type: item.et // Tipo (Dividendo, JCP, etc)
  })).sort((a, b) => new Date(a.name.split('/').reverse().join('-')) - new Date(b.name.split('/').reverse().join('-')));
};

// --- DADOS SIMULADOS (FALLBACK) ---
// Usados caso o StatusInvest bloqueie o pedido via proxy (Cloudflare/CORS)
const generateMockData = (ticker) => {
  const isFii = ticker.length === 6 && ticker.endsWith('11');
  const years = ['2019', '2020', '2021', '2022', '2023', '2024'];
  const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  
  return {
    patrimonio: years.map((y, i) => ({ name: y, value: 1000000000 + (i * 150000000) + (Math.random() * 50000000) })),
    receitas: years.map((y, i) => ({ name: y, value: 200000000 + (i * 20000000) + (Math.random() * 10000000) })),
    despesas: years.map((y, i) => ({ name: y, value: 150000000 + (i * 10000000) + (Math.random() * 5000000) })),
    caixa: years.map((y, i) => ({ name: y, value: 50000000 + (Math.random() * 20000000) })),
    resultado: years.map((y, i) => ({ name: y, value: 50000000 + (i * 10000000) + (Math.random() * 5000000) })),
    proventos: months.map((m) => ({ name: m, value: isFii ? (0.8 + Math.random() * 0.4) : (Math.random() > 0.7 ? (1.5 + Math.random() * 2) : 0) })),
    isMock: true
  };
};

// --- COMPONENTES UI MONOCROMÁTICOS ---

const Card = ({ title, icon: Icon, children }) => (
  // Design monocromático: Fundo muito escuro (zinc-900), sem bordas, cantos arredondados
  <div className="bg-zinc-900 rounded-2xl p-6 flex flex-col h-full ring-0 border-0 shadow-none">
    <div className="flex items-center space-x-3 mb-6">
      {Icon && <Icon className="text-zinc-400 w-5 h-5" />}
      <h3 className="text-zinc-100 font-medium text-lg tracking-wide">{title}</h3>
    </div>
    <div className="flex-grow w-full h-full min-h-[250px]">
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
            {new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'BRL', notation: 'compact' }).format(entry.value)}
          </p>
        ))}
      </div>
    );
  }
  return null;
};

// --- COMPONENTE PRINCIPAL ---

export default function App() {
  const [tickerInput, setTickerInput] = useState('MXRF11');
  const [currentTicker, setCurrentTicker] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState(null);

  const fetchFinancialData = async (tickerToFetch) => {
    if (!tickerToFetch) return;
    
    setLoading(true);
    setError('');
    setData(null);
    setCurrentTicker(tickerToFetch.toUpperCase());

    try {
      // 1. Procurar a Categoria (Pesquisa Global)
      const searchUrl = `${BASE_URL}/home/mainsearchquery?q=${tickerToFetch}`;
      const searchRes = await fetch(getFetchUrl(searchUrl));
      
      if (!searchRes.ok) throw new Error("Falha ao comunicar com a API.");
      
      const searchData = await searchRes.json();
      
      // Tenta extrair a categoria com base no URL retornado pelo StatusInvest
      let categoria = 'acoes'; // Default
      if (Array.isArray(searchData) && searchData.length > 0) {
        const urlStr = searchData[0].url || '';
        if (urlStr.includes('fundos-imobiliarios')) categoria = 'fii';
        else if (urlStr.includes('fiagros')) categoria = 'fiagro';
        else if (urlStr.includes('acoes')) categoria = 'acoes';
      }

      // 2. Construir URLs para os endpoints
      const endpoints = {
        patrimonio: `${BASE_URL}/${categoria}/getpatrimonioliquido?code=${tickerToFetch}&type=0`,
        receitas: `${BASE_URL}/${categoria}/getreceitas?code=${tickerToFetch}&type=0`,
        despesas: `${BASE_URL}/${categoria}/getdespesas?code=${tickerToFetch}&type=0`,
        caixa: `${BASE_URL}/${categoria}/getcaixa?code=${tickerToFetch}&type=0`,
        resultado: `${BASE_URL}/${categoria}/getresultado?code=${tickerToFetch}&type=0`,
        proventos: `${BASE_URL}/${categoria}/companytickerprovents?companyName=${tickerToFetch}&chartProventsType=1`
      };

      // 3. Efetuar pedidos em paralelo (com tratamento de erro individual para não quebrar tudo se um falhar)
      const fetchEndpoint = async (url) => {
        try {
          const res = await fetch(getFetchUrl(url));
          if (!res.ok) return null;
          return await res.json();
        } catch (e) {
          return null;
        }
      };

      const results = await Promise.all([
        fetchEndpoint(endpoints.patrimonio),
        fetchEndpoint(endpoints.receitas),
        fetchEndpoint(endpoints.despesas),
        fetchEndpoint(endpoints.caixa),
        fetchEndpoint(endpoints.resultado),
        fetchEndpoint(endpoints.proventos)
      ]);

      // Verificar se algum dado útil retornou. Se tudo for null/vazio, significa bloqueio.
      if (results.every(r => r === null || Object.keys(r).length === 0)) {
        throw new Error("API retornou dados vazios (possível bloqueio Cloudflare).");
      }

      // 4. Normalizar Dados
      setData({
        patrimonio: normalizeGenericChartData(results[0]),
        receitas: normalizeGenericChartData(results[1]),
        despesas: normalizeGenericChartData(results[2]),
        caixa: normalizeGenericChartData(results[3]),
        resultado: normalizeGenericChartData(results[4]),
        proventos: normalizeProventos(results[5]),
        isMock: false,
        categoria: categoria.toUpperCase()
      });

    } catch (err) {
      console.warn("Erro ao buscar dados reais, ativando fallback simulado.", err);
      // Fallback elegante para dados simulados para demonstrar a UI
      setData(generateMockData(tickerToFetch));
      setError('A API original bloqueou o pedido (CORS/Bot). A apresentar dados estruturais simulados para demonstração.');
    } finally {
      setLoading(false);
    }
  };

  // Buscar dados iniciais
  useEffect(() => {
    fetchFinancialData('MXRF11');
  }, []);

  const handleSubmit = (e) => {
    e.preventDefault();
    fetchFinancialData(tickerInput);
  };

  return (
    <div className="min-h-screen bg-black text-zinc-300 font-sans selection:bg-zinc-700 selection:text-white pb-20">
      
      {/* HEADER E BARRA DE PESQUISA */}
      <header className="border-b border-zinc-900 bg-black sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-6 flex flex-col sm:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-zinc-100 rounded-full flex items-center justify-center">
              <Activity className="text-black w-6 h-6" />
            </div>
            <h1 className="text-2xl font-bold text-zinc-100 tracking-tight">StatusMono</h1>
          </div>
          
          <form onSubmit={handleSubmit} className="w-full sm:w-96 relative">
            <input
              type="text"
              value={tickerInput}
              onChange={(e) => setTickerInput(e.target.value)}
              placeholder="Pesquisar Ticker (ex: PETR4, MXRF11)"
              className="w-full bg-zinc-900 text-zinc-100 px-5 py-3 rounded-full outline-none focus:ring-2 focus:ring-zinc-700 placeholder-zinc-600 transition-all border-none"
            />
            <button 
              type="submit" 
              disabled={loading}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-2 bg-zinc-800 rounded-full text-zinc-300 hover:text-white hover:bg-zinc-700 transition-colors disabled:opacity-50"
            >
              <Search className="w-4 h-4" />
            </button>
          </form>
        </div>
      </header>

      {/* ÁREA PRINCIPAL DE CONTEÚDO */}
      <main className="max-w-7xl mx-auto px-6 mt-10">
        
        {/* CABEÇALHO DO ATIVO */}
        {currentTicker && !loading && (
          <div className="mb-10 flex flex-col sm:flex-row items-baseline gap-4">
            <h2 className="text-5xl font-black text-white tracking-tighter">{currentTicker}</h2>
            {data?.categoria && (
              <span className="bg-zinc-800 text-zinc-300 px-3 py-1 rounded-md text-sm font-medium tracking-widest">
                {data.categoria}
              </span>
            )}
          </div>
        )}

        {/* MENSAGEM DE ERRO / AVISO DE MOCK */}
        {error && (
          <div className="mb-8 p-4 bg-zinc-900/50 border border-zinc-800 rounded-xl flex items-start gap-3 text-zinc-400">
            <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5 text-zinc-500" />
            <p className="text-sm leading-relaxed">{error}</p>
          </div>
        )}

        {/* ESTADO DE CARREGAMENTO */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-32 space-y-4">
            <div className="w-12 h-12 border-4 border-zinc-800 border-t-zinc-100 rounded-full animate-spin"></div>
            <p className="text-zinc-500 font-medium animate-pulse">A extrair dados do mercado...</p>
          </div>
        ) : data ? (
          
          /* GRELHA DE DASHBOARD - DESIGN MONOCROMÁTICO */
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-6">
            
            {/* GRÁFICO: Património Líquido */}
            <Card title="Património Líquido" icon={Database}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data.patrimonio} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorPat" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#ffffff" stopOpacity={0.15}/>
                      <stop offset="95%" stopColor="#ffffff" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                  <XAxis dataKey="name" stroke="#52525b" tick={{fill: '#a1a1aa', fontSize: 12}} axisLine={false} tickLine={false} />
                  <YAxis stroke="#52525b" tick={{fill: '#a1a1aa', fontSize: 12}} axisLine={false} tickLine={false} tickFormatter={(value) => `${(value / 1000000).toFixed(0)}M`} />
                  <Tooltip content={<CustomTooltip />} />
                  <Area type="monotone" dataKey="value" stroke="#ffffff" strokeWidth={2} fillOpacity={1} fill="url(#colorPat)" />
                </AreaChart>
              </ResponsiveContainer>
            </Card>

            {/* GRÁFICO: Receitas vs Despesas */}
            <Card title="Receitas & Despesas" icon={TrendingUp}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                  {/* Usando dados de receitas para o eixo X, assumindo que as datas coincidem */}
                  <XAxis dataKey="name" data={data.receitas} stroke="#52525b" tick={{fill: '#a1a1aa', fontSize: 12}} axisLine={false} tickLine={false} />
                  <YAxis stroke="#52525b" tick={{fill: '#a1a1aa', fontSize: 12}} axisLine={false} tickLine={false} tickFormatter={(value) => `${(value / 1000000).toFixed(0)}M`} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ paddingTop: '20px', fontSize: '12px', color: '#a1a1aa' }} iconType="circle" />
                  <Line type="monotone" data={data.receitas} dataKey="value" name="Receitas" stroke="#ffffff" strokeWidth={2} dot={false} />
                  <Line type="monotone" data={data.despesas} dataKey="value" name="Despesas" stroke="#52525b" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </Card>

            {/* GRÁFICO: Resultado Líquido */}
            <Card title="Resultado Líquido" icon={Briefcase}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.resultado} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                  <XAxis dataKey="name" stroke="#52525b" tick={{fill: '#a1a1aa', fontSize: 12}} axisLine={false} tickLine={false} />
                  <YAxis stroke="#52525b" tick={{fill: '#a1a1aa', fontSize: 12}} axisLine={false} tickLine={false} tickFormatter={(value) => `${(value / 1000000).toFixed(0)}M`} />
                  <Tooltip content={<CustomTooltip />} cursor={{fill: '#27272a'}} />
                  <Bar dataKey="value" fill="#d4d4d8" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </Card>

            {/* GRÁFICO: Histórico de Proventos / Dividendos */}
            <Card title="Histórico de Proventos" icon={DollarSign}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.proventos} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                  <XAxis dataKey="name" stroke="#52525b" tick={{fill: '#a1a1aa', fontSize: 12}} axisLine={false} tickLine={false} />
                  <YAxis stroke="#52525b" tick={{fill: '#a1a1aa', fontSize: 12}} axisLine={false} tickLine={false} />
                  <Tooltip content={<CustomTooltip />} cursor={{fill: '#27272a'}} />
                  <Bar dataKey="value" fill="#ffffff" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </Card>

            {/* LISTA/TABELA: Últimos Proventos (Apenas visível se houver dados de proventos) */}
            {data.proventos && data.proventos.length > 0 && (
              <div className="md:col-span-2 bg-zinc-900 rounded-2xl p-6 border-0 shadow-none">
                <div className="flex items-center space-x-3 mb-6">
                  <Info className="text-zinc-400 w-5 h-5" />
                  <h3 className="text-zinc-100 font-medium text-lg tracking-wide">Tabela de Proventos Recentes</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-zinc-800 text-zinc-500 text-sm">
                        <th className="pb-4 font-normal">Data</th>
                        <th className="pb-4 font-normal">Tipo</th>
                        <th className="pb-4 font-normal text-right">Valor (R$)</th>
                      </tr>
                    </thead>
                    <tbody className="text-zinc-300">
                      {data.proventos.slice(-6).reverse().map((prov, idx) => (
                        <tr key={idx} className="border-b border-zinc-800/50 hover:bg-zinc-800/20 transition-colors">
                          <td className="py-4">{prov.name}</td>
                          <td className="py-4 text-zinc-400">{prov.type || 'Rendimento'}</td>
                          <td className="py-4 text-right font-medium text-zinc-100">
                            {new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'BRL' }).format(prov.value)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

          </div>
        ) : null}
      </main>
    </div>
  );
}