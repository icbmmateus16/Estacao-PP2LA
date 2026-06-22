const API    = "/.netlify/functions/weather";
const AI_API = "/.netlify/functions/groq-analysis";

const $ = id => document.getElementById(id);
const num = v => {
  if(v == null || v === "") return null;
  const n = parseFloat(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
};
const fmt = (n, d = 1) => n == null ? "--" : n.toFixed(d);

const state = {
  period: "24h",
  lastWeather: { rain: 0, temp: null, umi: null },
  sky3d: null
};

// Cache de dados e controle de estado da IA
const aiState = {
  lastData: null,
  busy: false
};

async function getData(period){
  const r = await fetch(`${API}?period=${encodeURIComponent(period)}`, { cache:"no-store" });
  if(!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

function stats(arr){
  const v = (arr || []).map(num).filter(x => x != null);
  if(!v.length) return null;
  const sum = v.reduce((a,b) => a + b, 0);
  return { min:Math.min(...v), max:Math.max(...v), avg:sum / v.length, last:v[v.length - 1] };
}

function brasiliaHour(){
  const parts = new Intl.DateTimeFormat("pt-BR", {
    timeZone:"America/Sao_Paulo",
    hour:"2-digit",
    minute:"2-digit",
    hour12:false
  }).formatToParts(new Date());
  const hour = parseInt(parts.find(p => p.type === "hour")?.value || "0", 10) % 24;
  const minute = parseInt(parts.find(p => p.type === "minute")?.value || "0", 10);
  return hour + minute / 60;
}

function brasiliaClock(){
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone:"America/Sao_Paulo",
    hour:"2-digit",
    minute:"2-digit"
  }).format(new Date());
}

function dayPhase(hour){
  if(hour >= 5 && hour < 6.5) return "dawn";
  if(hour >= 6.5 && hour < 10) return "morning";
  if(hour >= 10 && hour < 15) return "noon";
  if(hour >= 15 && hour < 17) return "afternoon";
  if(hour >= 17 && hour < 18) return "golden";
  if(hour >= 18 && hour < 18.75) return "dusk";
  if(hour >= 18.75 && hour < 19.75) return "twilight";
  if(hour >= 19.75 && hour < 22) return "evening";
  return "night";
}

function skyMode(hour, rain, temp, umi){
  const r = rain || 0;
  const phase = dayPhase(hour);
  const night = phase === "night" || phase === "evening" || phase === "twilight";
  let condition = "clear";

  if(r >= 42) condition = "storm";
  else if(r >= 5) condition = "rain";
  else if((umi || 0) >= 82) condition = "cloudy";
  else if((umi || 100) <= 35 || ((temp || 0) >= 31 && (umi || 100) <= 45)) condition = "dry";

  const conditionClouds = {
    clear: phase === "noon" ? .05 : .12,
    dry: .02,
    cloudy: .82,
    rain: .92,
    storm: 1
  };
  const phaseStars = {
    dawn:.08,
    morning:0,
    noon:0,
    afternoon:0,
    golden:.05,
    dusk:.18,
    twilight:.38,
    evening:.58,
    night:1
  };
  const labels = {
    clear:{
      dawn:"Amanhecer claro",
      morning:"Manhã clara",
      noon:"Dia claro",
      afternoon:"Tarde clara",
      golden:"Fim de tarde",
      dusk:"Anoitecendo",
      twilight:"Crepúsculo",
      evening:"Noite chegando",
      night:"Noite limpa"
    },
    dry:"Céu seco",
    cloudy:"Nublado",
    rain:"Chuva / garoa",
    storm:"Chuva forte"
  };

  const sunPos = {
    dawn:{ x:-9, y:1.8 },
    morning:{ x:-4, y:5.2 },
    noon:{ x:2.5, y:8.2 },
    afternoon:{ x:8, y:5.8 },
    golden:{ x:10.5, y:2.6 },
    dusk:{ x:11, y:.9 },
    twilight:{ x:10, y:6.4 },
    evening:{ x:10, y:6.6 },
    night:{ x:10, y:6.8 }
  };

  let stars = phaseStars[phase];
  if(condition === "storm") stars = 0;
  if(condition === "rain") stars = Math.min(stars, .08);
  if(condition === "cloudy") stars = Math.min(stars, .18);

  return {
    key:phase,
    phase,
    condition,
    label:typeof labels[condition] === "string" ? labels[condition] : labels.clear[phase],
    celestial:night ? "moon" : "sun",
    showSun:condition !== "rain" && condition !== "storm",
    clouds:conditionClouds[condition],
    stars,
    rain:condition === "storm" ? .92 : condition === "rain" ? Math.min(.85, r / 72 + .18) : 0,
    sunX:sunPos[phase].x,
    sunY:sunPos[phase].y
  };
}

function weatherText(temp, umi, rain, hour){
  const mode = skyMode(hour, rain, temp, umi);
  if(mode.condition === "storm") return "Chuva intensa";
  if(mode.condition === "rain") return "Chuva / garoa";
  if(mode.condition === "cloudy") return "Nublado";
  if(mode.condition === "dry") return "Céu seco";
  if(mode.phase === "night") return "Noite limpa";
  if(mode.phase === "dawn") return "Amanhecendo";
  if(mode.phase === "dusk") return "Anoitecendo";
  if(mode.phase === "twilight") return "Crepúsculo";
  if(mode.phase === "evening") return "Noite chegando";
  return "Céu limpo";
}

function applySky(hour, rain, temp, umi){
  const mode = skyMode(hour, rain, temp, umi);
  document.body.dataset.sky = mode.phase;
  document.body.dataset.weather = mode.condition;
  document.body.style.setProperty("--rain-opacity", mode.rain);
  document.body.style.setProperty("--star-opacity", mode.stars);
  document.body.style.setProperty("--cloud-amount", mode.clouds);

  const skyLabel = $("skyLabel");
  const clockTxt = $("clockTxt");
  if(skyLabel) skyLabel.textContent = mode.label;
  if(clockTxt) clockTxt.textContent = `${brasiliaClock()} BRT`;

  updateSky3D(mode);
}

function updateClock(){
  // Apenas o relógio BRT do card principal. A pílula mostra o horário da última
  // leitura recebida (definido em updateCurrent), não o relógio atual.
  const clockTxt = $("clockTxt");
  if(clockTxt) clockTxt.textContent = `${brasiliaClock()} BRT`;
}

function buildDecor(){
  const stars = $("stars");
  const rain = $("rain");
  if(stars){
    for(let i = 0; i < 90; i++){
      const s = document.createElement("span");
      s.className = "star";
      s.style.left = `${Math.random() * 100}%`;
      s.style.top = `${Math.random() * 72}%`;
      s.style.animationDelay = `${Math.random() * 4}s`;
      stars.appendChild(s);
    }
  }
  if(rain){
    for(let i = 0; i < 120; i++){
      const d = document.createElement("span");
      d.className = "drop";
      d.style.left = `${Math.random() * 112}%`;
      d.style.animationDuration = `${.48 + Math.random() * .42}s`;
      d.style.animationDelay = `${-Math.random() * 2.4}s`;
      d.style.opacity = .25 + Math.random() * .55;
      rain.appendChild(d);
    }
  }
}

function initSky3D(){
  const canvas = $("sky3d");
  if(!canvas || !window.THREE) return;

  try{
    const T = window.THREE;
    const renderer = new T.WebGLRenderer({
      canvas,
      alpha:true,
      antialias:true,
      preserveDrawingBuffer:true,
      powerPreference:"high-performance"
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    const scene = new T.Scene();
    const camera = new T.PerspectiveCamera(42, 1, .1, 120);
    camera.position.set(0, 0, 34);

    const ambient = new T.AmbientLight(0xffffff, 1.25);
    const key = new T.DirectionalLight(0xffffff, 2.4);
    key.position.set(-6, 8, 14);
    scene.add(ambient, key);

    const root = new T.Group();
    scene.add(root);

    const sun = makeCelestial(T, {
      core:["rgba(255,249,216,1)", "rgba(255,206,92,.96)", "rgba(255,170,40,0)"],
      halo:["rgba(255,222,138,.38)", "rgba(255,179,73,.16)", "rgba(255,179,73,0)"],
      glare:["rgba(255,255,255,.32)", "rgba(255,221,142,.08)", "rgba(255,221,142,0)"],
      scale:8.6
    });
    sun.position.set(11, 8, -8);
    root.add(sun);

    const moon = makeCelestial(T, {
      core:["rgba(255,255,255,.95)", "rgba(198,213,242,.9)", "rgba(198,213,242,0)"],
      halo:["rgba(191,211,255,.26)", "rgba(137,171,255,.12)", "rgba(137,171,255,0)"],
      glare:["rgba(255,255,255,.12)", "rgba(197,214,255,.05)", "rgba(197,214,255,0)"],
      scale:7.2
    });
    moon.position.set(11, 8, -8);
    moon.visible = false;
    root.add(moon);

    const clouds = [
      makeCloud(T, -14, 5.5, -16, 1.7, .26),
      makeCloud(T, 9, -1, -15, 2.35, .34),
      makeCloud(T, -2, -6.7, -18, 2.1, .24),
      makeCloud(T, 18, 4.8, -22, 1.45, .18)
    ];
    clouds.forEach(cloud => root.add(cloud));

    const haze = makeHaze(T);
    haze.position.set(0, -11, -24);
    root.add(haze);

    const rainGeo = new T.BufferGeometry();
    const rainPositions = [];
    for(let i = 0; i < 110; i++){
      const x = -22 + Math.random() * 44;
      const y = -15 + Math.random() * 30;
      const z = -20 + Math.random() * 12;
      rainPositions.push(x, y, z, x - .45, y - 1.8, z);
    }
    rainGeo.setAttribute("position", new T.Float32BufferAttribute(rainPositions, 3));
    const rainMesh = new T.LineSegments(
      rainGeo,
      new T.LineBasicMaterial({ color:0xbdefff, transparent:true, opacity:0 })
    );
    root.add(rainMesh);

    const starGeo = new T.BufferGeometry();
    const starPositions = [];
    for(let i = 0; i < 140; i++){
      starPositions.push(-28 + Math.random() * 56, -9 + Math.random() * 24, -24 + Math.random() * 8);
    }
    starGeo.setAttribute("position", new T.Float32BufferAttribute(starPositions, 3));
    const starMesh = new T.Points(
      starGeo,
      new T.PointsMaterial({ color:0xffffff, size:.08, transparent:true, opacity:0 })
    );
    root.add(starMesh);

    const resize = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    window.addEventListener("resize", resize);

    state.sky3d = { T, renderer, scene, camera, sun, moon, clouds, haze, rainMesh, starMesh, t:0 };

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const animate = () => {
      if(!state.sky3d) return;
      const s = state.sky3d;
      s.t += reduce ? .002 : .007;
      s.sun.rotation.z += .0008;
      s.moon.rotation.z += .0005;
      s.clouds.forEach((cloud, i) => {
        const home = cloud.userData.home;
        cloud.position.x = home.x + Math.sin(s.t * .42 + i) * .35;
        cloud.position.y = home.y + Math.cos(s.t * .34 + i) * .14;
        cloud.rotation.z = Math.sin(s.t * .24 + i) * .018;
      });
      s.rainMesh.position.y -= .08;
      if(s.rainMesh.position.y < -4) s.rainMesh.position.y = 0;
      s.renderer.render(s.scene, s.camera);
      requestAnimationFrame(animate);
    };
    animate();
  }catch(e){
    console.warn("Cena 3D indisponivel", e);
  }
}

function makeRadialTexture(T, stops, size = 512){
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const g = ctx.createRadialGradient(size * .5, size * .48, 0, size * .5, size * .5, size * .5);
  stops.forEach(([p, color]) => g.addColorStop(p, color));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const texture = new T.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

function makeCloudTexture(T, seed = 1, size = 768){
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, size, size);
  ctx.filter = "blur(16px)";

  const blobs = [
    [.18, .55, .32, .62],
    [.35, .42, .38, .75],
    [.55, .48, .46, .88],
    [.74, .55, .34, .66],
    [.46, .66, .58, .52],
    [.64, .34, .28, .45]
  ];

  blobs.forEach(([x, y, r, a], i) => {
    const wobble = Math.sin(seed * 11 + i * 3.7) * .045;
    const gx = size * (x + wobble);
    const gy = size * (y - wobble * .6);
    const radius = size * r;
    const g = ctx.createRadialGradient(gx, gy, 0, gx, gy, radius);
    g.addColorStop(0, `rgba(255,255,255,${a})`);
    g.addColorStop(.5, `rgba(230,244,250,${a * .42})`);
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(gx, gy, radius, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.filter = "blur(38px)";
  const shadow = ctx.createRadialGradient(size * .52, size * .7, 0, size * .52, size * .68, size * .44);
  shadow.addColorStop(0, "rgba(35,66,80,.28)");
  shadow.addColorStop(1, "rgba(35,66,80,0)");
  ctx.fillStyle = shadow;
  ctx.fillRect(0, 0, size, size);
  ctx.globalCompositeOperation = "destination-in";
  const mask = ctx.createRadialGradient(size * .5, size * .54, size * .1, size * .5, size * .54, size * .62);
  mask.addColorStop(0, "rgba(0,0,0,1)");
  mask.addColorStop(.68, "rgba(0,0,0,.86)");
  mask.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = mask;
  ctx.fillRect(0, 0, size, size);
  ctx.globalCompositeOperation = "source-over";

  const texture = new T.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

function makeCelestial(T, palette){
  const group = new T.Group();
  const coreTexture = makeRadialTexture(T, [
    [0, palette.core[0]],
    [.34, palette.core[1]],
    [1, palette.core[2]]
  ]);
  const haloTexture = makeRadialTexture(T, [
    [0, palette.halo[0]],
    [.45, palette.halo[1]],
    [1, palette.halo[2]]
  ]);
  const glareTexture = makeRadialTexture(T, [
    [0, palette.glare[0]],
    [.26, palette.glare[1]],
    [1, palette.glare[2]]
  ]);

  const halo = new T.Sprite(new T.SpriteMaterial({ map:haloTexture, transparent:true, depthWrite:false, opacity:.92 }));
  halo.scale.set(palette.scale * 2.6, palette.scale * 2.6, 1);
  group.add(halo);

  const glare = new T.Sprite(new T.SpriteMaterial({ map:glareTexture, transparent:true, depthWrite:false, opacity:.7 }));
  glare.scale.set(palette.scale * 3.9, palette.scale * 1.2, 1);
  glare.rotation.z = -.36;
  group.add(glare);

  const core = new T.Sprite(new T.SpriteMaterial({ map:coreTexture, transparent:true, depthWrite:false, opacity:.95 }));
  core.scale.set(palette.scale, palette.scale, 1);
  group.add(core);
  return group;
}

function makeHaze(T){
  const texture = makeRadialTexture(T, [
    [0, "rgba(210,242,250,.18)"],
    [.42, "rgba(170,218,228,.1)"],
    [1, "rgba(170,218,228,0)"]
  ], 768);
  const material = new T.SpriteMaterial({ map:texture, transparent:true, depthWrite:false, opacity:.82 });
  const haze = new T.Sprite(material);
  haze.scale.set(92, 24, 1);
  return haze;
}

function makeCloud(T, x, y, z, scale, opacity){
  const group = new T.Group();
  group.position.set(x, y, z);
  group.scale.setScalar(1);
  group.userData.home = { x, y, z };
  group.userData.baseScale = scale;
  group.userData.baseOpacity = opacity;

  for(let i = 0; i < 3; i++){
    const material = new T.SpriteMaterial({
      map:makeCloudTexture(T, scale * 10 + i),
      transparent:true,
      depthWrite:false,
      opacity:opacity * (1 - i * .18)
    });
    const sprite = new T.Sprite(material);
    sprite.position.set((i - 1) * 2.4, (i % 2) * .36, -i * .45);
    sprite.scale.set(13 * scale * (1 + i * .16), 4.8 * scale * (1 + i * .1), 1);
    sprite.rotation.z = (i - 1) * .035;
    group.add(sprite);
  }
  return group;
}

function updateSky3D(mode){
  const s = state.sky3d;
  if(!s) return;

  const cloudy = mode.condition === "cloudy" || mode.condition === "rain" || mode.condition === "storm";
  const night = mode.phase === "night" || mode.phase === "evening" || mode.phase === "twilight";
  const lowSun = mode.phase === "dawn" || mode.phase === "golden" || mode.phase === "dusk";

  s.sun.visible = mode.celestial === "sun" && mode.showSun;
  s.moon.visible = mode.celestial === "moon" && mode.showSun;
  s.sun.position.set(mode.sunX, mode.sunY, -10);
  s.moon.position.set(11, 6.8, -10);
  s.clouds.forEach((cloud, i) => {
    cloud.visible = mode.clouds > .015;
    const base = cloud.userData.baseOpacity || .26;
    cloud.children.forEach(part => {
      part.material.opacity = Math.min(.82, base * (.25 + mode.clouds * 1.65) * (night ? .58 : 1));
    });
    cloud.scale.setScalar((cloudy ? 1.12 : .92) * (mode.condition === "storm" ? 1.24 : 1));
  });
  if(s.haze) s.haze.material.opacity = mode.condition === "clear" || mode.condition === "dry" ? 0 : night ? .18 : cloudy ? .34 : .22;
  s.rainMesh.visible = mode.rain > .01;
  s.rainMesh.material.opacity = mode.rain ? Math.min(.72, mode.rain + .08) : 0;
  s.starMesh.visible = mode.stars > .01;
  s.starMesh.material.opacity = mode.stars ? .62 : 0;
  s.sun.children.forEach((part, index) => {
    part.material.opacity = lowSun ? [.74, .44, .9][index] || .7 : [.55, .26, .82][index] || .6;
  });
}

function updateCurrent(d){
  if(!d || !d.time || !d.time.length) return;
  const i = d.time.length - 1;
  const temp = num(d.temp?.[i]);
  const feel = num(d.feel?.[i]);
  const dew = num(d.dew?.[i]);
  const umi = num(d.umi?.[i]);
  const pabs = num(d.pabs?.[i]);
  const qnh = num(d.qnh?.[i]);
  const rain = num(d.rain?.[i]);
  const hour = brasiliaHour();

  state.lastWeather = { rain, temp, umi };

  $("heroTemp").textContent = fmt(temp, 1);
  $("heroDesc").textContent = weatherText(temp, umi, rain, hour);

  const ts = stats(d.temp);
  if(ts) $("heroMM").innerHTML = `máx <b>${fmt(ts.max, 1)}°</b> · mín <b>${fmt(ts.min, 1)}°</b>`;

  $("vFeel").textContent = fmt(feel, 1);
  $("sFeel").textContent = (feel != null && temp != null) ? (feel >= temp + .6 ? "mais abafado" : feel <= temp - .6 ? "mais ameno" : "igual ao real") : "";
  $("vUmi").textContent = fmt(umi, 0);
  $("sUmi").textContent = umi == null ? "" : (umi >= 80 ? "ar úmido" : umi <= 30 ? "ar muito seco" : "confortável");
  $("vDew").textContent = fmt(dew, 1);
  $("vRain").textContent = fmt(rain, 0);
  $("sRain").textContent = rain == null ? "" : (rain < 5 ? "sem chuva" : rain < 25 ? "chuvisco" : "chovendo");
  $("vQnh").textContent = fmt(qnh, 1);
  $("vPabs").textContent = fmt(pabs, 1);

  if(d.trend && d.trend.length) $("trendTxt").textContent = d.trend[d.trend.length - 1] || "—";

  const liveTxt = $("liveTxt");
  if(liveTxt) liveTxt.textContent = `atualizado às ${d.time[i]}`;

  applySky(hour, rain, temp, umi);
}

const charts = { line:{}, hist:{}, fore:{} };
const AXIS = "rgba(246,250,255,.78)";
const GRID = "rgba(255,255,255,.105)";

const VARS = [
  {
    id:"temp", label:"Temperatura", unit:"°C", short:"°", dec:1, color:"#ff7043",
    kind:"linha", full:true,
    overlay:{ field:"feel", label:"Sensação", color:"#ffd54f" },
    bands:[
      { from:-20, to:18, color:"rgba(64,196,255,.08)" },
      { from:18, to:30, color:"rgba(105,240,174,.07)" },
      { from:30, to:60, color:"rgba(255,112,67,.08)" }
    ]
  },
  {
    id:"umi", label:"Umidade relativa", unit:"%", short:"%", dec:0, color:"#29b6f6",
    kind:"faixas", min:0, max:100,
    bands:[
      { from:0, to:30, color:"rgba(255,209,102,.09)" },
      { from:30, to:70, color:"rgba(105,240,174,.07)" },
      { from:70, to:100, color:"rgba(41,182,246,.09)" }
    ]
  },
  {
    id:"dew", label:"Ponto de orvalho", unit:"°C", short:"°", dec:1, color:"#b388ff",
    kind:"linha"
  },
  {
    id:"rain", label:"Intensidade de chuva", unit:"%", short:"%", dec:0, color:"#4fc3f7",
    kind:"barras", mainType:"bar", min:0
  },
  {
    id:"qnh", label:"Pressão QNH", unit:"hPa", short:" hPa", dec:1, color:"#66bb6a",
    kind:"pressão"
  },
  {
    id:"pabs", label:"Pressão absoluta", unit:"hPa", short:" hPa", dec:1, color:"#90a4ae",
    kind:"pressão"
  }
];

const plotBackdrop = {
  id:"plotBackdrop",
  beforeDraw(chart, args, opts){
    const { ctx, chartArea, scales } = chart;
    if(!chartArea) return;
    ctx.save();
    ctx.fillStyle = "rgba(2,8,18,.24)";
    ctx.fillRect(chartArea.left, chartArea.top, chartArea.width, chartArea.height);
    if(opts?.bands && scales.y){
      opts.bands.forEach(b => {
        const y1 = scales.y.getPixelForValue(b.from);
        const y2 = scales.y.getPixelForValue(b.to);
        const top = Math.min(y1, y2);
        const height = Math.abs(y2 - y1);
        if(Number.isFinite(top) && Number.isFinite(height)){
          ctx.fillStyle = b.color;
          ctx.fillRect(chartArea.left, top, chartArea.width, height);
        }
      });
    }
    ctx.restore();
  }
};

function setupChartDefaults(){
  if(!window.Chart) return;
  Chart.defaults.font.family = "'SF Pro Display','Inter','Segoe UI',system-ui,-apple-system,Roboto,sans-serif";
  Chart.defaults.color = AXIS;
  Chart.register(plotBackdrop);
}

function findExtremes(series){
  let maxV = -Infinity, minV = Infinity, maxIdx = -1, minIdx = -1;
  series.forEach((v, i) => {
    if(v == null) return;
    if(v > maxV){ maxV = v; maxIdx = i; }
    if(v < minV){ minV = v; minIdx = i; }
  });
  return { maxIdx, minIdx };
}

function histogram(values, bins = 22){
  if(!values.length) return { labels:[], data:[] };
  const min = Math.min(...values);
  const max = Math.max(...values);
  const width = (max - min) / bins || 1;
  const counts = new Array(bins).fill(0);
  const labels = new Array(bins);
  for(let i = 0; i < bins; i++) labels[i] = (min + i * width).toFixed(1);
  values.forEach(v => {
    let k = Math.floor((v - min) / width);
    if(k >= bins) k = bins - 1;
    if(k < 0) k = 0;
    counts[k]++;
  });
  return { labels, data:counts };
}

function linReg(x, y){
  const n = x.length;
  let sx = 0, sy = 0, sxy = 0, sxx = 0;
  for(let i = 0; i < n; i++){
    sx += x[i]; sy += y[i]; sxy += x[i] * y[i]; sxx += x[i] * x[i];
  }
  const denom = (n * sxx - sx * sx) || 1e-9;
  const slope = (n * sxy - sx * sy) / denom;
  return { slope, intercept:(sy - slope * sx) / n };
}

function forecasts(valid, horizon = 15){
  const n = valid.length;
  if(n < 30) return null;
  const last = valid[n - 1];
  const { slope:phi, intercept:c } = linReg(valid.slice(0, -1), valid.slice(1));
  const projAR = [];
  let cur = last;
  for(let i = 0; i < horizon; i++){
    cur = phi * cur + c;
    projAR.push(cur);
  }
  const win = Math.min(30, n);
  const recent = valid.slice(-win);
  const { slope:m, intercept:b } = linReg(Array.from({ length:win }, (_, i) => i), recent);
  const projLin = [];
  for(let i = 0; i < horizon; i++) projLin.push(m * (win + i) + b);
  return { projAR, projLin };
}

function gradient(ctx, color, strength = "55"){
  const g = ctx.createLinearGradient(0, 0, 0, 320);
  g.addColorStop(0, `${color}${strength}`);
  g.addColorStop(1, `${color}00`);
  return g;
}

const extColor = c => c.dataIndex === c.dataset.customMaxIdx ? "#ff5252" : c.dataIndex === c.dataset.customMinIdx ? "#40c4ff" : "rgba(0,0,0,0)";
const extRadius = c => (c.dataIndex === c.dataset.customMaxIdx || c.dataIndex === c.dataset.customMinIdx) ? 5 : 0;

function baseOpts(v = {}){
  return {
    responsive:true,
    maintainAspectRatio:false,
    animation:{ duration:320 },
    interaction:{ mode:"index", intersect:false },
    plugins:{
      plotBackdrop:{ bands:v.bands || [] },
      legend:{
        labels:{
          color:AXIS,
          usePointStyle:true,
          pointStyle:"line",
          boxWidth:24,
          padding:14,
          font:{ weight:"700" }
        }
      },
      tooltip:{
        backgroundColor:"rgba(5,10,18,.94)",
        titleColor:"#fff",
        bodyColor:"#fff",
        borderColor:"rgba(255,255,255,.18)",
        borderWidth:1,
        padding:11,
        displayColors:true
      }
    },
    scales:{
      x:{
        ticks:{ color:AXIS, maxTicksLimit:8, autoSkip:true, maxRotation:0 },
        grid:{ color:GRID, drawTicks:false }
      },
      y:{
        min:v.min,
        max:v.max,
        ticks:{ color:AXIS },
        grid:{ color:GRID, drawTicks:false }
      }
    },
    elements:{
      point:{ radius:0, hoverRadius:5 },
      line:{ borderWidth:2.4, capBezierPoints:true }
    }
  };
}

function histOpts(v){
  const o = baseOpts(v);
  o.plugins.legend.display = false;
  o.plugins.plotBackdrop = { bands:[] };
  o.scales.x.grid.display = false;
  o.scales.y.ticks.precision = 0;
  return o;
}

function buildCards(){
  const labels = { line:"serie", hist:"freq.", fore:"prev." };
  const mk = (gridId, section, v) => {
    const card = document.createElement("article");
    const title = `${v.label}${section === "line" && v.overlay ? " & sensação" : ""}`;
    card.className = `chart-card glass${v.full && section === "line" ? " wide" : ""}`;
    card.innerHTML = `
      <div class="chart-head">
        <h3 class="chart-title">${title}</h3>
        <span class="chart-kind">${section === "line" ? v.kind : labels[section]}</span>
      </div>
      <p class="meta" id="meta-${section}-${v.id}">—</p>
      <div class="canvas-box"><canvas id="cv-${section}-${v.id}"></canvas></div>
    `;
    $(gridId).appendChild(card);
  };

  VARS.forEach(v => {
    mk("gridLine", "line", v);
    mk("gridHist", "hist", v);
    mk("gridFore", "fore", v);
  });
}

function initCharts(){
  if(!window.Chart) return;

  VARS.forEach(v => {
    const lc = $(`cv-line-${v.id}`).getContext("2d");
    const primary = v.mainType === "bar"
      ? {
        type:"bar",
        label:`${v.label} (${v.unit})`,
        data:[],
        backgroundColor:`${v.color}88`,
        borderColor:v.color,
        borderWidth:1,
        borderRadius:5,
        barPercentage:.78,
        categoryPercentage:.82
      }
      : {
        type:"line",
        label:`${v.label} (${v.unit})`,
        data:[],
        borderColor:v.color,
        tension:v.kind === "pressão" ? .18 : .36,
        fill:true,
        backgroundColor:gradient(lc, v.color),
        pointBackgroundColor:extColor,
        pointBorderColor:extColor,
        pointRadius:extRadius,
        pointHoverRadius:6,
        customMaxIdx:-1,
        customMinIdx:-1
      };

    const lineSets = [primary];
    if(v.overlay){
      lineSets.push({
        type:"line",
        label:`${v.overlay.label} (${v.unit})`,
        data:[],
        borderColor:v.overlay.color,
        borderDash:[5, 4],
        tension:.36,
        pointRadius:0,
        fill:false
      });
    }
    lineSets.push(
      { type:"line", label:"Média", data:[], borderColor:"#69f0ae", borderDash:[6, 5], pointRadius:0, fill:false },
      { type:"line", label:"Mínima", data:[], borderColor:"#40c4ff", borderDash:[3, 4], pointRadius:0, fill:false, hidden:true },
      { type:"line", label:"Máxima", data:[], borderColor:"#ff5252", borderDash:[3, 4], pointRadius:0, fill:false, hidden:true }
    );

    charts.line[v.id] = new Chart(lc, {
      type:v.mainType === "bar" ? "bar" : "line",
      data:{ labels:[], datasets:lineSets },
      options:baseOpts(v)
    });

    const hc = $(`cv-hist-${v.id}`).getContext("2d");
    charts.hist[v.id] = new Chart(hc, {
      type:"bar",
      data:{
        labels:[],
        datasets:[{
          label:"Frequência",
          data:[],
          backgroundColor:`${v.color}9a`,
          borderColor:v.color,
          borderWidth:1,
          borderRadius:4,
          barPercentage:.92,
          categoryPercentage:.92
        }]
      },
      options:histOpts(v)
    });

    const fc = $(`cv-fore-${v.id}`).getContext("2d");
    charts.fore[v.id] = new Chart(fc, {
      type:"line",
      data:{ labels:[], datasets:[
        { label:"Histórico recente", data:[], borderColor:v.color, tension:v.kind === "pressão" ? .18 : .34, pointRadius:0, fill:false },
        { label:"Inércia AR(1)", data:[], borderColor:"#ec407a", borderDash:[5, 4], tension:.34, pointRadius:0, fill:false },
        { label:"Tendência linear", data:[], borderColor:"#42a5f5", borderDash:[2, 3], tension:.34, pointRadius:0, fill:false }
      ]},
      options:baseOpts(v)
    });
  });
}

function renderCharts(d){
  VARS.forEach(v => {
    const raw = d[v.id] || [];
    const series = raw.map(num);
    const st = stats(raw);
    const dec = v.dec;
    const sh = v.short;

    const validIdx = [];
    series.forEach((x, i) => { if(x != null) validIdx.push(i); });
    const valid = validIdx.map(i => series[i]);
    const validTime = validIdx.map(i => d.time[i]);

    const lc = charts.line[v.id];
    lc.data.labels = d.time;
    lc.data.datasets[0].data = series;
    if(v.mainType !== "bar"){
      const ext = findExtremes(series);
      lc.data.datasets[0].customMaxIdx = ext.maxIdx;
      lc.data.datasets[0].customMinIdx = ext.minIdx;
    }

    let di = 1;
    if(v.overlay){
      lc.data.datasets[di].data = (d[v.overlay.field] || []).map(num);
      di++;
    }

    const flat = val => series.map(() => st ? val : null);
    lc.data.datasets[di].data = flat(st && st.avg);
    lc.data.datasets[di + 1].data = flat(st && st.min);
    lc.data.datasets[di + 2].data = flat(st && st.max);
    lc.update();

    $(`meta-line-${v.id}`).textContent = st
      ? `mín ${st.min.toFixed(dec)}${sh} · méd ${st.avg.toFixed(dec)}${sh} · máx ${st.max.toFixed(dec)}${sh}`
      : "sem dados";

    const h = histogram(valid, 22);
    const hc = charts.hist[v.id];
    hc.data.labels = h.labels;
    hc.data.datasets[0].data = h.data;
    hc.update();
    $(`meta-hist-${v.id}`).textContent = valid.length ? `${valid.length} leituras · ${h.labels.length} faixas` : "sem dados";

    const fc = charts.fore[v.id];
    const f = forecasts(valid, 15);
    if(f){
      const zoom = Math.min(60, valid.length);
      const recent = valid.slice(-zoom);
      const recentTime = validTime.slice(-zoom);
      const lastVal = recent[recent.length - 1];
      const futLabels = Array.from({ length:15 }, (_, i) => `+${i + 1}`);
      fc.data.labels = [...recentTime, ...futLabels];
      fc.data.datasets[0].data = [...recent, ...Array(15).fill(null)];
      fc.data.datasets[1].data = [...Array(zoom - 1).fill(null), lastVal, ...f.projAR];
      fc.data.datasets[2].data = [...Array(zoom - 1).fill(null), lastVal, ...f.projLin];
      fc.update();
      $(`meta-fore-${v.id}`).textContent = "15 passos à frente · real + tendência";
    }else{
      fc.data.labels = [];
      fc.data.datasets.forEach(s => { s.data = []; });
      fc.update();
      $(`meta-fore-${v.id}`).textContent = "dados insuficientes";
    }
  });
}

async function loadHistory(period){
  state.period = period;
  document.querySelectorAll(".pbtn").forEach(b => {
    const active = b.dataset.p === period;
    b.classList.toggle("active", active);
    b.setAttribute("aria-pressed", active ? "true" : "false");
  });

  const status = $("status");
  status.classList.remove("err");
  status.textContent = "Processando dados...";

  try{
    const d = await getData(period);
    if(!d || !d.time || !d.time.length){
      status.textContent = "Nenhum registro neste período.";
      return;
    }
    renderCharts(d);
    if(period === "24h") updateCurrent(d);

    // Salva para uso da IA e dispara análise
    aiState.lastData = d;
    fetchAIAnalysis(d);

    const periodNames = { "24h":"Últimas 24 h", week:"Última semana", month:"Último mês", year:"Último ano", decade:"Última década" };
    const last = d.time[d.time.length - 1];
    status.textContent = `${periodNames[period] || period} · ${d.time.length} leituras · atualizado ${last}`;
  }catch(e){
    console.error(e);
    status.classList.add("err");
    status.textContent = "Falha ao buscar dados. Verifique a função da Netlify e a variável WEATHER_API_URL.";
  }
}

async function liveTick(){
  try{
    const d = await getData("24h");
    updateCurrent(d);
  }catch(e){
    console.warn("Atualização ao vivo falhou", e);
  }
}

function runIntroMotion(){
  if(!window.gsap) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if(reduce) return;
  gsap.from(".topbar", { y:-10, opacity:0, duration:.7, ease:"power2.out" });
  gsap.from(".current-content > *", { y:18, opacity:0, duration:.9, ease:"power3.out", stagger:.08, delay:.1 });
  gsap.from(".trend-card, .stat-card", { y:16, opacity:0, duration:.65, ease:"power2.out", stagger:.035, delay:.25 });
}

// Progresso animado da abertura: sobe com easing até ~92% e fecha em 100% ao concluir.
function createLoader(){
  const fill = document.querySelector(".intro-bar-fill");
  const pct = $("introPct");
  let value = 0;
  let done = false;
  let raf = 0;

  const tick = () => {
    const target = done ? 100 : 92;
    value += (target - value) * (done ? 0.12 : 0.05);
    if(done && value > 99.5) value = 100;
    if(fill) fill.style.width = `${value}%`;
    if(pct) pct.textContent = `${Math.round(value)}%`;
    if(done && value >= 100) return;        // chegou a 100% — encerra o loop
    raf = requestAnimationFrame(tick);
  };
  tick();

  return { finish(){ done = true; }, stop(){ cancelAnimationFrame(raf); } };
}

function finishIntro(){
  const intro = $("intro");
  document.body.classList.remove("booting");
  runIntroMotion();                       // stagger das cards ao revelar o painel
  if(!intro) return;
  intro.classList.add("intro--done");
  const remove = () => intro.remove();
  intro.addEventListener("transitionend", remove, { once:true });
  setTimeout(remove, 1300);               // garantia, caso o transitionend não dispare
}

async function boot(){
  // Pré-carrega a logo para evitar flash/delay na abertura
  const logoPreload = new Image();
  logoPreload.src = "./assets/logo.webp";

  document.body.classList.add("booting");

  buildDecor();
  initSky3D();
  setupChartDefaults();
  applySky(brasiliaHour(), 0, null, null);
  buildCards();
  initCharts();

  document.querySelectorAll(".pbtn").forEach(b => {
    b.addEventListener("click", () => loadHistory(b.dataset.p));
  });

  updateClock();
  setInterval(updateClock, 1000);                         // relógio BRT em tempo real

  const loader = createLoader();

  // Status que evolui durante o carregamento.
  const introStatus = $("introStatus");
  const msgs = ["Conectando à base PP2LA…", "Recebendo telemetria…", "Processando séries…"];
  let mi = 0;
  if(introStatus) introStatus.textContent = msgs[0];
  const msgTimer = setInterval(() => {
    if(mi < msgs.length - 1 && introStatus) introStatus.textContent = msgs[++mi];
  }, 850);

  // Mínimo ~2,4 s (impacto), segura até os dados carregarem, teto de 8 s.
  const minShow = new Promise(r => setTimeout(r, 1800));
  const maxWait = new Promise(r => setTimeout(r, 8000));
  let ok = true;
  const dataReady = loadHistory("24h").then(() => { ok = true; }).catch(() => { ok = false; });

  await Promise.all([minShow, Promise.race([dataReady, maxWait])]);

  clearInterval(msgTimer);
  if(introStatus) introStatus.textContent = ok ? "Telemetria sincronizada" : "Sem conexão com a base";
  loader.finish();
  await new Promise(r => setTimeout(r, 620));             // deixa a barra chegar a 100%
  finishIntro();

  setInterval(liveTick, 60000);                           // leitura atual a cada 1 min
  setInterval(() => loadHistory(state.period), 600000);   // recarrega o período exibido a cada 10 min
  setInterval(() => {
    const { rain, temp, umi } = state.lastWeather;
    applySky(brasiliaHour(), rain, temp, umi);
  }, 600000);
  setInterval(() => fetchAIAnalysis(), 600000);           // análise IA a cada 10 min
}


// ─── Integração IA (Groq) ─────────────────────────────────────────────────────

/**
 * Anima o texto caractere a caractere no elemento alvo.
 * Resolve quando termina.
 */
function typewriter(el, text, speed = 14) {
  return new Promise(resolve => {
    el.textContent = "";
    let i = 0;
    const tick = () => {
      if (i < text.length) {
        el.textContent += text[i++];
        setTimeout(tick, speed + Math.random() * 8);
      } else {
        resolve();
      }
    };
    tick();
  });
}

function aiSetLoading() {
  $(\"aiLoading\").removeAttribute(\"aria-hidden\");
  $(\"aiContent\").hidden  = true;
  $(\"aiError\").hidden    = true;
  $(\"aiRefresh\").disabled = true;
  $(\"aiRefresh\").classList.add(\"spinning\");
  $(\"aiTimestamp\").textContent = \"Consultando IA…\";
}

function aiSetError(msg) {
  $(\"aiLoading\").setAttribute(\"aria-hidden\", \"true\");
  $(\"aiContent\").hidden  = true;
  $(\"aiError\").hidden    = false;
  $(\"aiErrorText\").textContent = msg || \"Não foi possível gerar análise.\";
  $(\"aiRefresh\").disabled = false;
  $(\"aiRefresh\").classList.remove(\"spinning\");
  $(\"aiTimestamp\").textContent = \"Falhou · tente novamente\";
}

async function aiSetContent(resumo, tendencia, alerta) {
  $(\"aiLoading\").setAttribute(\"aria-hidden\", \"true\");
  $(\"aiError\").hidden   = true;
  $(\"aiContent\").hidden = false;

  // Blocos paralelos → sequencial para efeito narrativo
  await typewriter($(\"aiResumoText\"),    resumo    || \"\", 13);
  if (tendencia) {
    await typewriter($(\"aiTendenciaText\"), tendencia, 13);
  } else {
    $(\"aiTendencia\").hidden = true;
  }

  const semAlerta = !alerta || /sem alert/i.test(alerta);
  if (!semAlerta) {
    $(\"aiAlerta\").hidden = false;
    await typewriter($(\"aiAlertaText\"), alerta, 13);
  } else {
    $(\"aiAlerta\").hidden = true;
  }

  $(\"aiRefresh\").disabled = false;
  $(\"aiRefresh\").classList.remove(\"spinning\");

  const now = new Intl.DateTimeFormat(\"pt-BR\", {
    timeZone: \"America/Sao_Paulo\",
    hour: \"2-digit\", minute: \"2-digit\"
  }).format(new Date());
  $(\"aiTimestamp\").textContent = `Gerado às ${now} BRT`;
}

/**
 * Extrai os valores mais recentes de cada série para enviar à IA.
 */
function extractCurrent(d) {
  if (!d || !d.time || !d.time.length) return {};
  const i = d.time.length - 1;
  return {
    temp: num(d.temp?.[i]),
    feel: num(d.feel?.[i]),
    umi:  num(d.umi?.[i]),
    dew:  num(d.dew?.[i]),
    rain: num(d.rain?.[i]),
    qnh:  num(d.qnh?.[i]),
    pabs: num(d.pabs?.[i])
  };
}

async function fetchAIAnalysis(data) {
  if (aiState.busy) return;
  aiState.busy = true;

  // Usa dados passados ou do cache
  const d = data || aiState.lastData;
  if (!d) {
    aiState.busy = false;
    return;
  }

  aiSetLoading();

  try {
    const res = await fetch(AI_API, {
      method: \"POST\",
      headers: { \"Content-Type\": \"application/json\" },
      body: JSON.stringify({
        current: extractCurrent(d),
        history: {
          temp: d.temp,
          feel: d.feel,
          umi:  d.umi,
          dew:  d.dew,
          rain: d.rain,
          qnh:  d.qnh,
          pabs: d.pabs
        },
        period: state.period
      })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }

    const json = await res.json();
    await aiSetContent(json.resumo, json.tendencia, json.alerta);

  } catch (e) {
    console.warn(\"[AI] Falha na análise:\", e.message);
    aiSetError(\"Análise temporariamente indisponível. Tente novamente.\");
  } finally {
    aiState.busy = false;
  }
}

// Botão de atualizar análise
document.addEventListener(\"DOMContentLoaded\", () => {
  const btn = $(\"aiRefresh\");
  if (btn) btn.addEventListener(\"click\", () => fetchAIAnalysis());
});

boot();
