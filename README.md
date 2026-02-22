# StatusMono — Dashboard Financeiro

Dashboard minimalista para ações e FIIs brasileiros, com dados do StatusInvest.

## Estrutura do Projeto

```
/
├── api/
│   └── proxy.js          ← Serverless function (proxy anti-Cloudflare)
├── src/
│   ├── App.jsx           ← Componente principal React
│   ├── main.jsx          ← Entry point
│   └── index.css         ← Estilos globais (Tailwind)
├── index.html
├── package.json
├── vite.config.js
├── tailwind.config.js
├── postcss.config.js
└── vercel.json
```

## Como Funciona o Proxy Anti-Cloudflare

O StatusInvest usa Cloudflare para bloquear bots. A solução:

1. O frontend chama `/api/proxy?url=<endpoint_do_statusinvest>`
2. A serverless function `api/proxy.js` faz o request com **headers de browser real** (User-Agent, Referer, sec-ch-ua, etc.)
3. O Cloudflare aceita porque os headers parecem legítimos
4. A resposta JSON é retornada ao frontend com cache de 5 minutos

## Deploy no Vercel

```bash
# 1. Instalar dependências
npm install

# 2. Testar localmente (requer Vercel CLI para a serverless function)
npx vercel dev

# 3. Deploy
npx vercel --prod
```

> **Importante:** Use `vercel dev` em vez de `vite` para testar localmente,
> pois assim a serverless function `/api/proxy` também fica disponível.

## Desenvolvimento Local (sem Vercel CLI)

Se quiser usar apenas `npm run dev`, adicione ao `vite.config.js`:

```js
server: {
  proxy: {
    '/api/proxy': {
      target: 'https://statusinvest.com.br',
      changeOrigin: true,
      rewrite: (path) => {
        const url = new URL('http://localhost' + path);
        return decodeURIComponent(url.searchParams.get('url')).replace('https://statusinvest.com.br', '');
      },
      headers: {
        'Referer': 'https://statusinvest.com.br/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
      }
    }
  }
}
```
