# Painel de administração — planejamento

Painel em `/admin` para o profissional editar a página sem mexer em código e acompanhar quem visita, de onde vem e o que clica.

## 1. Decisão de arquitetura

A página hoje é estática. Editar conteúdo e guardar métricas exige um servidor, então o projeto passa a ter um **servidor Node.js sem dependências** (mesma filosofia do projeto: nada para instalar).

```
server/
  index.mjs      HTTP: página pública, arquivos, API e /admin
  render.mjs     monta o HTML da página a partir do conteúdo
  content.mjs    conteúdo padrão, validação, histórico de versões
  analytics.mjs  grava eventos e calcula as métricas
  auth.mjs       senha (scrypt) e sessões do painel
admin/           painel (HTML, CSS e JS puros)
track.js         coletor de métricas da página pública (~2 KB)
data/            conteúdo salvo, eventos, senha (fora do git)
uploads/         fotos enviadas pelo painel
```

- A página pública é **renderizada no servidor** a partir de `data/content.json`: abre já com o conteúdo certo, sem "piscar".
- `npm run build` continua gerando um `dist/` estático com o conteúdo atual (sem métricas), para quem quiser hospedagem estática.
- Para ter painel + métricas em produção, é preciso hospedar o Node (Render, Railway, Fly.io, VPS...). Atrás do Cloudflare ou da Vercel o servidor aproveita os cabeçalhos de localização (país, estado e cidade).

## 2. Funcionalidades

### 2.1 Acesso
- Login por senha. Primeira execução local: tela "Criar senha". Em produção: variável `ADMIN_PASSWORD` (ou senha já criada).
- Sessão em cookie `HttpOnly` + `SameSite=Strict`, válida por 7 dias; limite de tentativas de login.
- Trocar senha em Configurações.

### 2.2 Conteúdo (edição livre)
| Seção | O que dá para mudar |
|---|---|
| Perfil | Nome, profissão, CREF, foto (upload) |
| Destaque | "Transforme seu", palavra grande ("treino"), frase de apoio |
| Contato e redes | WhatsApp, mensagem padrão, Instagram, TikTok (vazio = ícone some) |
| Serviços | Adicionar, remover, reordenar, ocultar; título, texto (com **negrito**), botão, mensagem do WhatsApp, foto, estilo do cartão (escuro / vermelho / claro), subtítulo no menu |
| Menu | Título da lista e texto do botão de contato |
| SEO e rodapé | Título da aba, descrição para o Google, texto do rodapé |

- **Prévia ao vivo** num celular ao lado do formulário (tema claro/escuro), atualizada a cada alteração.
- Barra fixa "Alterações não salvas · Descartar · Publicar".
- **Histórico de versões**: cada publicação guarda uma cópia (últimas 30); dá para restaurar qualquer uma.

### 2.3 Métricas
Filtro de período no topo (Hoje · 7 dias · 30 dias · 90 dias). Tudo compara com o período anterior.

| Bloco | Conteúdo |
|---|---|
| Ao vivo | Quantas pessoas estão no site agora (últimos 5 min) |
| Indicadores | Visitas, visitantes únicos, cliques no WhatsApp, taxa de conversão, tempo médio no site, rolagem média |
| Linha do tempo (gráfico) | Visitas e contatos por hora (Hoje) ou por dia |
| De onde vieram | Instagram, WhatsApp, Google, TikTok, Facebook, direto, outros sites + campanhas (`utm_campaign`) |
| Localização | País / estado / cidade quando a hospedagem informa; senão, fuso horário do aparelho |
| Dispositivos | Celular / computador / tablet, sistema e navegador (inclui "navegador do Instagram") |
| Links mais clicados | Ranking de cada botão: cartões de serviço, WhatsApp do topo, menu, Instagram, TikTok, copiar link... com cliques e pessoas únicas |
| Onde mais clicam | **Mapa de calor** dos cliques desenhado sobre a própria página |
| Horários de pico | Grade dia da semana × hora |
| Linha do tempo de visitas | Últimas visitas com a jornada de cada uma: origem, local, aparelho, cliques em ordem e tempo de permanência |

- Exportar eventos em CSV e apagar métricas (com confirmação).
- **Links de divulgação**: gerador de links com `utm_source` (bio do Instagram, stories, status do WhatsApp...) para saber exatamente de onde veio cada visita.

### 2.4 Como as métricas são coletadas
- `track.js` envia, via `sendBeacon`: visualização, cada clique (elemento + posição) e um sinal periódico com tempo ativo (só conta com a aba visível) e rolagem máxima.
- Identificadores aleatórios: visitante em `localStorage`, visita em `sessionStorage`. Sem cookies no site público, **sem guardar IP**, sem serviços de terceiros.
- O servidor descarta robôs, visitas do próprio admin logado e a prévia do painel.

## 3. Design

- Mesma identidade do site: vermelho `#d10000`, fontes Unbounded (títulos) e Instrument Sans (texto e números), tema claro e escuro.
- **Desktop**: barra lateral (Visão geral · Conteúdo · Configurações · Ver site · tema · sair) e conteúdo em grade de cartões.
- **Celular**: barra superior + navegação inferior; cartões em uma coluna.
- Gráficos em SVG próprio (sem bibliotecas): linhas de 2 px, área a 10 %, barras de no máximo 24 px com ponta arredondada, grade discreta, dica (tooltip) ao passar o dedo/mouse. Cores: azul para visitas, laranja para contatos, escala de um só tom para calor.
- Estados vazios com orientação ("Compartilhe seu link para começar a ver dados").

## 4. Ordem de implementação
1. Servidor, conteúdo e renderização da página (site idêntico ao atual).
2. Coletor `track.js` + API de eventos + agregação.
3. Painel: login, layout, métricas.
4. Editor de conteúdo com prévia, upload e histórico.
5. Configurações, build estático, README e verificação no navegador.
