# Estacao PP2LA

Interface web para visualizacao meteorologica da Estacao PP2LA, com foco em uma experiencia moderna, responsiva e imersiva para acompanhar as condicoes atuais e as series historicas da base.

Este README descreve apenas o sistema de visualizacao: layout, componentes, experiencia visual, graficos e publicacao da interface.

## Visao Geral

A aplicacao apresenta um painel meteorologico em tempo real com visual inspirado em interfaces premium de clima. O primeiro contato do usuario e uma abertura animada com transicao de ceu, sol, lua e logo da estacao. Em seguida, o painel principal exibe a condicao atual, leituras principais, tendencia atmosferica e graficos historicos organizados por periodo.

O design acompanha o horario de Brasilia e adapta a atmosfera da pagina conforme o momento do dia:

- amanhecer;
- manha;
- meio-dia;
- tarde;
- fim de tarde;
- anoitecer;
- crepusculo;
- noite chegando;
- noite.

A estetica tambem muda conforme a condicao meteorologica representada na interface, com variacoes para ceu claro, seco, nublado, chuva e chuva forte.

## Experiencia Visual

O visual foi construido para parecer um painel meteorologico profissional, com fundo atmosferico dinamico, elementos 3D e graficos integrados ao ambiente da pagina.

Principais pontos da interface:

- abertura animada com timelapse de ceu;
- animacao invertida quando o sistema e aberto durante a noite;
- sol e lua com acabamento visual mais realista;
- camada 3D em Three.js para elementos atmosfericos;
- chuva, estrelas e nuvens variando de acordo com o contexto visual;
- fundo da pagina adaptavel ao horario e ao clima;
- cards translucidos com leitura forte dos valores;
- rodape com contraste preservado;
- graficos com fundo integrado ao layout sem perder legibilidade.

## Painel Principal

A primeira area da interface mostra a condicao atual de forma direta:

- temperatura em destaque;
- descricao visual do ceu;
- horario BRT em tempo real;
- maxima e minima do periodo;
- status de atualizacao;
- tendencia atmosferica;
- principais leituras meteorologicas em cards.

Os cards foram desenhados para leitura rapida, com valores grandes, unidades claras e textos auxiliares discretos.

## Graficos

A secao de series historicas organiza a visualizacao por periodos:

- 24 horas;
- 1 semana;
- 1 mes;
- 1 ano;
- 1 decada.

Cada variavel usa uma representacao mais adequada para facilitar a leitura:

- temperatura e sensacao em linha;
- umidade com faixas de conforto;
- ponto de orvalho em linha;
- intensidade de chuva em barras;
- pressoes com visual focado em tendencia;
- histogramas para distribuicao;
- previsoes visuais para comportamento recente.

Os graficos usam Chart.js e foram ajustados para manter contraste, grid leve, tooltip escuro e integracao com o fundo do painel.

## Responsividade

A interface foi pensada para funcionar bem em telas grandes e tambem em dispositivos menores.

Ela adapta:

- espacamento dos blocos;
- tamanho dos valores;
- largura dos graficos;
- organizacao dos cards;
- area util do painel;
- legibilidade dos textos.

## Tecnologias

- HTML5;
- CSS3;
- JavaScript puro;
- Three.js;
- GSAP;
- Chart.js;
- Netlify Functions;
- Netlify Hosting.

## Estrutura Visual do Projeto

```txt
.
├── index.html
├── styles.css
├── app.js
├── assets/
│   └── logo.png
├── netlify/
│   └── functions/
│       └── weather.js
├── netlify.toml
└── README.md
```

## Publicacao

O projeto pode ser publicado diretamente na Netlify.

Configuracao recomendada:

```txt
Build command: vazio
Publish directory: .
Functions directory: netlify/functions
```

O arquivo `netlify.toml` ja define a publicacao da raiz do projeto e a pasta de Functions.

## Objetivo do Sistema

O objetivo da interface e transformar leituras meteorologicas em uma experiencia visual clara, bonita e facil de acompanhar. A proposta nao e apenas listar numeros, mas criar um painel atmosferico que comunique rapidamente o estado do tempo, a variacao das condicoes e o historico recente.

