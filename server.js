#!/usr/bin/env node
/**
 * Claude Voice — bridge de voz para Claude Code (solo navegador, sin dependencias).
 *
 * El navegador hace STT + TTS (Web Speech API, gratis). Este servidor arranca UN
 * proceso `claude` caliente en el workspace y le habla por stream-json, devolviendo
 * la voz por `/say` y la traza de trabajo en vivo por SSE `/proc`. Sesiones,
 * explorador de ficheros y botón de Stop incluidos.
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const os = require('os');

const PORT = parseInt(process.env.VOICE_PORT || '8765', 10);
const HOST = process.env.VOICE_HOST || '127.0.0.1';
const TOKEN = process.env.VOICE_TOKEN || ''; // si se define, exige token en cada petición (para exponer en remoto de forma segura)
let WORKSPACE = process.env.VOICE_WORKSPACE || path.resolve(__dirname, '..');
let MODEL = process.env.VOICE_MODEL || 'default';
let PERMISSION_MODE = process.env.VOICE_PERMISSION_MODE || 'bypassPermissions';
let RESOLVED_MODEL = ''; // el modelo real al que resuelve el CLI (del evento init)
// Alias REALES del CLI: `claude --model` los acepta y resuelven a la versión instalada. 'default' = el modelo por defecto de tu cuenta (no se pasa --model).
const VOICE_MODELS = [
  { id: 'default', label: 'Default (de tu cuenta)' },
  { id: 'opus', label: 'Opus' },
  { id: 'sonnet', label: 'Sonnet' },
  { id: 'haiku', label: 'Haiku' },
];
const PERM_MODES = ['default', 'acceptEdits', 'plan', 'bypassPermissions'];
const BROWSE_ROOT = process.env.VOICE_BROWSE_ROOT ? path.resolve(process.env.VOICE_BROWSE_ROOT) : os.homedir();
const CONFIG_FILE = path.join(__dirname, 'voice-config.json');
// la elección hecha en la UI persiste y pisa los defaults/env en el siguiente arranque
let RECENTS = [];
try {
  const c = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  if (c.model) MODEL = c.model;
  if (PERM_MODES.includes(c.permissionMode)) PERMISSION_MODE = c.permissionMode;
  if (c.workspace) { try { if (fs.statSync(c.workspace).isDirectory()) WORKSPACE = c.workspace; } catch (e) {} }
  if (Array.isArray(c.recents)) RECENTS = c.recents.slice(0, 6);
} catch (e) {}
function saveConfig() { try { fs.writeFileSync(CONFIG_FILE, JSON.stringify({ model: MODEL, permissionMode: PERMISSION_MODE, workspace: WORKSPACE, recents: RECENTS }, null, 2)); } catch (e) {} }
function rememberWorkspace(prev) {
  RECENTS = [...new Set([prev, ...RECENTS])].filter(w => { try { return w && fs.statSync(w).isDirectory(); } catch (e) { return false; } }).slice(0, 6);
}
const LOG_DIR = path.join(__dirname, 'logs');
const SESSIONS_DIR = path.join(__dirname, 'sessions');
const SCREENS_DIR = path.join(__dirname, 'screens');
const pendingShots = new Map(); // capturas de pantalla pendientes (id → {res, timer})
const TRIPWIRE = process.env.VOICE_TRIPWIRE === '1';
const DANGER = [/rm\s+-rf\s+(\/|~|\.|\$HOME)(\s|$)/i, /\bmkfs\b/i, /\bdd\s+if=/i, /:\s*\(\)\s*\{.*\}/, /\bdrop\s+database\b/i, /git\s+push\s+.*--force/i];
function cookieVal(req, name) { const m = (req.headers.cookie || '').match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)')); return m ? m[1] : ''; }

// p.ej. "hey-claude" o "scripts/voice"; si la interfaz vive FUERA del workspace, ruta absoluta
function selfDir() { const r = path.relative(WORKSPACE, __dirname); return (!r || r.startsWith('..')) ? __dirname : r; }

function buildPersona() {
  const SELF_DIR = selfDir();
  return [
  'Eres el agente de voz de Claude Code. Hablas por voz, en español de España.',
  '',
  'QUIÉN ERES Y DÓNDE VIVES (auto-contexto — léelo bien):',
  '- Eres Claude Code corriendo como AGENTE DE VOZ dentro de una interfaz web que el usuario abre en su navegador. Lo que dices se convierte en voz; lo que él dice llega como texto reconocido por el navegador.',
  `- Tu interfaz vive en "${SELF_DIR}/": "server.js" es el puente Node que te ejecuta y "public/index.html" es la web (orbe + terminal de traza + sesiones).`,
  '- Cuando el usuario diga "esta web", "tu interfaz", "tu voz", "el orbe", "la terminal", "donde estás montado", se refiere a ESA interfaz.',
  `- PUEDES MODIFICARTE: editar "${SELF_DIR}/public/index.html" (surte efecto al RECARGAR la página) o "${SELF_DIR}/server.js" (exige reiniciar el servidor, lo que corta la conversación: avisa antes).`,
  '- Tienes acceso completo al workspace y a su CLAUDE.md. Eres su Claude Code, pero hablado.',
  '',
  'IDIOMA (REGLA ABSOLUTA): hablas SIEMPRE en español de España. JAMÁS en inglés, ni cuando programas o razonas. Si te deslizas al inglés ("Let me…", "Now add…"), párate y reescríbelo en español.',
  '',
  'REGLAS DE VOZ:',
  '- Responde MUY breve: 1 a 3 frases. Lenguaje hablado natural.',
  '- NUNCA uses markdown, listas, viñetas, tablas, bloques de código ni emojis.',
  '- No leas URLs largas ni rutas completas: resúmelas.',
  '- Términos técnicos en inglés (funnel, deploy, frontend): di el equivalente español o escríbelos como suenan (funnel→"fánel", deploy→"diplói", router→"rúter", cache→"cash"). La voz lee en español; el inglés crudo suena mal.',
  '',
  'TRABAJOS QUE TARDAN: si una petición requiere trabajo real (editar ficheros, varios pasos), tu PRIMERA frase, antes de usar herramientas, avisa EN ESPAÑOL de que te pones con ello y avisarás al terminar. Después TRABAJA EN SILENCIO (no narres pasos: el usuario los ve en la terminal). Al acabar, una sola frase de cierre; si tocaste la interfaz, recuérdale que RECARGUE.',
  '',
  'PANTALLA COMPARTIDA (tu visión): el usuario puede compartir su pantalla o una ventana desde la web (botón de pantalla). Mientras comparte, cada mensaje suyo llega con una captura adjunta: MÍRALA, es lo que él está viendo en ese momento. Además puedes mirar TÚ MISMO cuando lo necesites a mitad de tarea: ejecuta `curl -s ' + (TOKEN ? '-H "x-voice-token: $HEY_CLAUDE_TOKEN" ' : '') + 'http://127.0.0.1:' + PORT + '/screen/now` — devuelve un JSON con "path"; LEE ese fichero con la herramienta Read (soporta imágenes) y verás su pantalla actual. Si devuelve error es que no está compartiendo: pídele que pulse el botón de pantalla. Úsalo cuando diga "mira mi pantalla", "qué ves", "este error", "lo que tengo abierto".',
  ].join('\n');
}

function log(...a) { console.log(`[voice ${new Date().toISOString()}]`, ...a); }
function ensureDir(d) { fs.mkdirSync(d, { recursive: true }); }
function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

function appendLog(entry) {
  try {
    ensureDir(LOG_DIR);
    const f = path.join(LOG_DIR, `voice-${new Date().toISOString().slice(0, 10)}.jsonl`);
    fs.appendFileSync(f, JSON.stringify({ t: new Date().toISOString(), ...entry }) + '\n');
  } catch (e) {}
}

function readBody(req, cb, limit) {
  let body = ''; const max = limit || 1e5;
  req.on('data', c => { body += c; if (body.length > max) req.destroy(); });
  req.on('end', () => { try { cb(JSON.parse(body)); } catch (e) { cb({}); } });
}

// ── Auto-contexto: inyecta/actualiza un bloque en el CLAUDE.md del workspace ──
function ensureClaudeContext() {
  if (process.env.VOICE_NO_CLAUDEMD === '1') return; // opt-out de escribir en CLAUDE.md
  try {
    const SELF_DIR = selfDir();
    const f = path.join(WORKSPACE, 'CLAUDE.md');
    const START = '<!-- claude-voice:start -->', END = '<!-- claude-voice:end -->';
    const block = [START,
      '## 🎙️ Claude Voice — interfaz de voz montada en este workspace',
      '',
      'Hay una web de voz corriendo que te ejecuta a TI (Claude Code) en este workspace. El usuario te habla por el micro del navegador y oye tu respuesta; ve tu traza de trabajo en una terminal en vivo.',
      '',
      `- Código de la interfaz: \`${SELF_DIR}/\` (server.js = puente Node; public/index.html = la web del orbe).`,
      '- Cuando el usuario diga "esta web", "tu interfaz", "el orbe", "la terminal" o "tu voz", se refiere a ESA interfaz.',
      `- **Puedes autogestionarla**: editar \`${SELF_DIR}/public/index.html\` (el usuario recarga para verlo) o \`${SELF_DIR}/server.js\` (requiere reiniciar el servidor, corta la conversación — avisa antes).`,
      '- Arranque: `node ' + SELF_DIR + '/server.js` (o start.sh / start.bat).',
      END].join('\n');
    let content = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
    if (content.includes(START)) {
      content = content.replace(new RegExp(START.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[\\s\\S]*?' + END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'm'), block);
    } else {
      content = (content ? content.replace(/\s*$/, '') + '\n\n' : '') + block + '\n';
    }
    fs.writeFileSync(f, content);
    log('CLAUDE.md actualizado con el contexto de la interfaz de voz');
  } catch (e) { log('ensureClaudeContext error:', e.message); }
}

// ── Sesiones ─────────────────────────────────────────────────────────────────
let sessions = [];
let activeId = null;

function loadSessions() {
  ensureDir(SESSIONS_DIR);
  try {
    const f = path.join(SESSIONS_DIR, 'index.json');
    if (fs.existsSync(f)) {
      const data = JSON.parse(fs.readFileSync(f, 'utf8'));
      sessions = (data.sessions || []).map(s => ({ ...s, messages: loadMessages(s.id) }));
      activeId = data.activeId || (sessions[0]?.id || null);
    }
  } catch (e) { log('loadSessions error:', e.message); }
}
function loadMessages(id) {
  try {
    const f = path.join(SESSIONS_DIR, id + '.jsonl');
    if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
  } catch (e) {}
  return [];
}
function saveIndex() {
  ensureDir(SESSIONS_DIR);
  const meta = sessions.map(({ id, name, createdAt, named }) => ({ id, name, createdAt, named }));
  fs.writeFileSync(path.join(SESSIONS_DIR, 'index.json'), JSON.stringify({ sessions: meta, activeId }, null, 2));
}
function appendMsg(sessionId, msg) {
  const s = sessions.find(x => x.id === sessionId);
  if (!s) return;
  s.messages.push(msg);
  try { fs.appendFileSync(path.join(SESSIONS_DIR, sessionId + '.jsonl'), JSON.stringify(msg) + '\n'); } catch (e) {}
}
function createSession(name) {
  const id = genId();
  const s = { id, name: name || `Sesión ${sessions.length + 1}`, createdAt: new Date().toISOString(), messages: [] };
  sessions.unshift(s); activeId = id; saveIndex(); return s;
}
function deleteSession(id) {
  sessions = sessions.filter(s => s.id !== id);
  try { fs.unlinkSync(path.join(SESSIONS_DIR, id + '.jsonl')); } catch (e) {}
  if (activeId === id) activeId = sessions[0]?.id || null;
  saveIndex(); return activeId;
}
function autoName(sessionId, userText) {
  if (!userText) return;
  const s = sessions.find(x => x.id === sessionId);
  if (s && !s.named && s.messages.length <= 2) { s.name = userText.slice(0, 45) + (userText.length > 45 ? '…' : ''); saveIndex(); }
}

// ── Proceso claude ───────────────────────────────────────────────────────────
let child = null, ready = false, busy = false, current = null, stdoutBuf = '';
const procClients = new Set();

function startClaude() {
  const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
    '--permission-mode', PERMISSION_MODE, '--strict-mcp-config'];
  if (MODEL && MODEL !== 'default') args.push('--model', MODEL); // 'default' = sin --model → modelo de la cuenta
  args.push('--append-system-prompt', buildPersona());
  log('arrancando claude:', MODEL, PERMISSION_MODE, 'cwd', WORKSPACE);
  child = spawn('claude', args, { cwd: WORKSPACE, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, HEY_CLAUDE_TOKEN: TOKEN, HEY_CLAUDE_PORT: String(PORT) } });
  ready = true; stdoutBuf = '';
  child.stdout.on('data', onStdout);
  child.stderr.on('data', d => log('stderr:', d.toString().trim().slice(0, 300)));
  child.on('exit', code => {
    log('claude salió, code', code);
    ready = false; busy = false;
    if (current) { try { current.res.end(JSON.stringify({ end: true, error: 'reinicio' }) + '\n'); } catch (e) {} current = null; }
    setTimeout(startClaude, 1500); // solo se llega aquí en caídas (en restart se quitan los listeners)
  });
}
function restartClaude() {
  if (child) {
    try { child.stdout.removeAllListeners(); child.stderr.removeAllListeners(); child.removeAllListeners('exit'); child.kill('SIGKILL'); } catch (e) {}
    child = null;
  }
  ready = false; busy = false;
  if (current) { try { current.res.end(JSON.stringify({ end: true, error: 'detenido' }) + '\n'); } catch (e) {} current = null; }
  startClaude();
}

function onStdout(data) {
  stdoutBuf += data.toString();
  let nl;
  while ((nl = stdoutBuf.indexOf('\n')) >= 0) {
    const line = stdoutBuf.slice(0, nl).trim(); stdoutBuf = stdoutBuf.slice(nl + 1);
    if (line) handleEvent(line);
  }
}

function handleEvent(line) {
  let ev; try { ev = JSON.parse(line); } catch (e) { return; }

  if (ev.type === 'system' && ev.subtype === 'init') { ready = true; if (ev.model) RESOLVED_MODEL = String(ev.model).replace(/\[.*\]$/, ''); broadcastProc({ type: 'system', detail: `${RESOLVED_MODEL || MODEL} conectado` }); return; }

  if (ev.type === 'assistant' && ev.message && Array.isArray(ev.message.content)) {
    for (const b of ev.message.content) {
      if (b.type === 'text' && b.text && b.text.trim()) {
        const txt = b.text.trim();
        if (current && !current.spokeFirst) { current.spokeFirst = true; current.firstText = txt; sendToClient({ say: txt }); }
        else broadcastProc({ type: 'thinking', detail: txt.slice(0, 400) });
      } else if (b.type === 'tool_use') {
        if (TRIPWIRE && b.name === 'Bash' && DANGER.some(re => re.test((b.input && b.input.command) || ''))) broadcastProc({ type: 'err', detail: '⚠ comando peligroso detectado' });
        broadcastProc({ type: 'tool_call', name: b.name, detail: summarizeInput(b.name, b.input), id: b.id });
      } else if (b.type === 'thinking' && b.thinking) {
        broadcastProc({ type: 'thinking', detail: b.thinking.replace(/\s+/g, ' ').trim().slice(0, 300) });
      }
    }
    return;
  }
  if (ev.type === 'user' && ev.message && Array.isArray(ev.message.content)) {
    for (const b of ev.message.content) {
      if (b.type === 'tool_result') broadcastProc({ type: b.is_error ? 'err' : 'tool_result', id: b.tool_use_id, detail: summarizeResult(b.content) });
    }
    return;
  }
  if (ev.type === 'result') {
    const finalText = (ev.result || '').trim();
    if (current && finalText && finalText !== current.firstText) sendToClient({ say: finalText });
    if (activeId && current) {
      appendMsg(activeId, { who: 'me', text: current.userText, ts: Date.now() });
      appendMsg(activeId, { who: 'ai', text: finalText || '…', ts: Date.now() });
      autoName(activeId, current.userText);
    }
    appendLog({ kind: 'turn', user: current?.userText, reply: finalText, cost: ev.total_cost_usd, ms: ev.duration_ms });
    if (current && current.timer) clearTimeout(current.timer);
    sendToClient({ end: true, cost: ev.total_cost_usd, ms: ev.duration_ms });
    broadcastProc({ type: 'result', detail: `${(ev.total_cost_usd || 0).toFixed(3)} $ · ${((ev.duration_ms || 0) / 1000).toFixed(1)} s` });
    if (current) { try { current.res.end(); } catch (e) {} }
    current = null; busy = false;
    return;
  }
}

function summarizeInput(name, input) {
  if (!input) return '';
  switch (name) {
    case 'Read': case 'Write': case 'Edit': case 'MultiEdit': case 'NotebookEdit': return input.file_path || '';
    case 'Bash': return (input.command || '').slice(0, 140);
    case 'Grep': return `"${input.pattern || ''}" ${input.path || ''}`.trim();
    case 'Glob': return input.pattern || '';
    case 'Task': case 'Agent': return (input.subagent_type ? input.subagent_type + ': ' : '') + (input.description || '');
    case 'WebSearch': return input.query || '';
    case 'WebFetch': return (input.url || '').slice(0, 80);
    case 'Skill': return input.command || input.skill || input.name || '';
    case 'TodoWrite': return 'actualiza la lista de tareas';
    default: return JSON.stringify(input).slice(0, 90);
  }
}
function summarizeResult(content) {
  if (!content) return '';
  if (typeof content === 'string') return content.replace(/\s+/g, ' ').trim().slice(0, 160);
  if (Array.isArray(content)) { for (const b of content) if (b && b.type === 'text' && b.text) return b.text.replace(/\s+/g, ' ').trim().slice(0, 160); }
  return '';
}

function sendToClient(obj) { if (current && !current.res.writableEnded) { try { current.res.write(JSON.stringify(obj) + '\n'); } catch (e) {} } }
function broadcastProc(obj) {
  const data = JSON.stringify({ ...obj, ts: Date.now() });
  for (const c of procClients) { try { c.write(`data: ${data}\n\n`); } catch (e) { procClients.delete(c); } }
}

function ask(userText, res, files) {
  if (TRIPWIRE && DANGER.some(re => re.test(userText))) {
    res.end(JSON.stringify({ say: 'He bloqueado eso por seguridad.', end: true }) + '\n');
    appendLog({ kind: 'tripwire', user: userText }); return;
  }
  busy = true;
  current = { res, userText, spokeFirst: false, firstText: '' };
  current.timer = setTimeout(() => { if (current && current.res === res) { try { res.end(JSON.stringify({ end: true, error: 'timeout' }) + '\n'); } catch (e) {} current = null; busy = false; } }, 600000);
  res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8' });
  const content = [];
  if (files && files.length) {
    for (const f of files) {
      if (f.type && f.type.startsWith('image/')) content.push({ type: 'image', source: { type: 'base64', media_type: f.type, data: f.data } });
      else {
        const up = path.join(__dirname, 'uploads'); ensureDir(up);
        const dest = path.join(up, Date.now() + '-' + (f.name || 'file').replace(/[^a-zA-Z0-9._-]/g, '_'));
        try { fs.writeFileSync(dest, Buffer.from(f.data, 'base64')); userText += `\n[Archivo adjunto: ${dest}]`; } catch (e) {}
      }
    }
  }
  content.push({ type: 'text', text: userText });
  child.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content } }) + '\n');
  broadcastProc({ type: 'user', detail: userText.slice(0, 90) });
  log('-> claude:', userText.slice(0, 100));
}

// ── HTTP ─────────────────────────────────────────────────────────────────────
function json(res, code, obj) { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); }

const server = http.createServer((req, res) => {
  const [p] = req.url.split('?');

  // ── Auth opcional: si VOICE_TOKEN está definido, todo exige token (header / ?token= / cookie) ──
  if (TOKEN) {
    const u = new URL(req.url, 'http://x');
    const tok = req.headers['x-voice-token'] || u.searchParams.get('token') || cookieVal(req, 'hctok');
    if (p === '/' || p === '/index.html') {
      if (u.searchParams.get('token') === TOKEN) res.setHeader('Set-Cookie', `hctok=${TOKEN}; Path=/; SameSite=Strict; Max-Age=31536000`);
      else if (tok !== TOKEN) { res.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end('<body style="background:#0F1822;color:#F4EDE2;font-family:sans-serif;padding:48px"><h2>🔒 Hey Claude</h2><p>Acceso protegido. Abre la URL con <code>?token=TU_TOKEN</code>.</p></body>'); }
    } else if (tok !== TOKEN) { return json(res, 401, { error: 'token requerido' }); }
  }

  if (req.method === 'GET' && (p === '/' || p === '/index.html')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(fs.readFileSync(path.join(__dirname, 'public', 'index.html')));
  }
  if (req.method === 'GET' && p.endsWith('.html') && !p.includes('..')) {
    const staticFile = path.join(__dirname, 'public', p);
    if (fs.existsSync(staticFile)) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(fs.readFileSync(staticFile)); }
  }
  if (req.method === 'GET' && p === '/status') return json(res, 200, { ready, busy, model: MODEL, resolvedModel: RESOLVED_MODEL, activeId, tripwire: TRIPWIRE, permissionMode: PERMISSION_MODE, workspace: path.basename(WORKSPACE) });

  // ── Config en caliente: modelo, permisos y workspace (reinicia al agente) ──
  if (req.method === 'GET' && p === '/config') {
    return json(res, 200, { model: MODEL, permissionMode: PERMISSION_MODE, workspace: WORKSPACE, models: VOICE_MODELS, permissionModes: PERM_MODES, recents: RECENTS.filter(w => w !== WORKSPACE) });
  }

  // navegador de carpetas (solo dirs) ACOTADO a BROWSE_ROOT (home): no expone todo el disco
  if (req.method === 'GET' && p === '/browse') {
    const q = new URL(req.url, 'http://x').searchParams.get('path');
    let abs = q ? path.resolve(q) : ((WORKSPACE === BROWSE_ROOT || WORKSPACE.startsWith(BROWSE_ROOT + path.sep)) ? WORKSPACE : BROWSE_ROOT);
    if (abs !== BROWSE_ROOT && !abs.startsWith(BROWSE_ROOT + path.sep)) abs = BROWSE_ROOT; // clamp
    try {
      const dirs = fs.readdirSync(abs, { withFileTypes: true })
        .filter(e => e.isDirectory() && !e.name.startsWith('.'))
        .map(e => {
          const full = path.join(abs, e.name);
          let project = false;
          try { project = fs.existsSync(path.join(full, '.git')) || fs.existsSync(path.join(full, 'CLAUDE.md')) || fs.existsSync(path.join(full, 'package.json')); } catch (e2) {}
          return { name: e.name, project };
        })
        .sort((a, b) => (b.project - a.project) || a.name.localeCompare(b.name));
      const parent = (abs !== BROWSE_ROOT && abs.startsWith(BROWSE_ROOT + path.sep)) ? path.dirname(abs) : null;
      return json(res, 200, { path: abs, parent, root: BROWSE_ROOT, dirs });
    } catch (e) { return json(res, 404, { error: 'no se puede abrir: ' + e.message }); }
  }
  if (req.method === 'POST' && p === '/config') {
    return readBody(req, body => {
      if (busy) return json(res, 429, { error: 'el agente está trabajando; espera o pulsa Detener' });
      let changed = false;
      if (body.model !== undefined) {
        const m = String(body.model).trim();
        if (!m) return json(res, 400, { error: 'modelo vacío' });
        if (m !== MODEL) { MODEL = m; changed = true; }
      }
      if (body.permissionMode !== undefined) {
        if (!PERM_MODES.includes(body.permissionMode)) return json(res, 400, { error: 'modo de permisos no válido' });
        if (body.permissionMode !== PERMISSION_MODE) { PERMISSION_MODE = body.permissionMode; changed = true; }
      }
      if (body.workspace !== undefined) {
        const w = path.resolve(String(body.workspace).trim());
        let ok = false; try { ok = fs.statSync(w).isDirectory(); } catch (e) {}
        if (!ok) return json(res, 400, { error: 'ese directorio no existe' });
        if (w !== WORKSPACE) { rememberWorkspace(WORKSPACE); WORKSPACE = w; ensureClaudeContext(); changed = true; }
      }
      if (changed) {
        saveConfig(); restartClaude();
        broadcastProc({ type: 'system', detail: `config: ${MODEL} · ${PERMISSION_MODE} · ${path.basename(WORKSPACE)}` });
      }
      return json(res, 200, { ok: true, model: MODEL, permissionMode: PERMISSION_MODE, workspace: WORKSPACE });
    });
  }

  if (req.method === 'GET' && p === '/proc') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write(`data: ${JSON.stringify({ type: 'connected', ts: Date.now() })}\n\n`);
    procClients.add(res);
    const ka = setInterval(() => { try { res.write(': ka\n\n'); } catch (e) {} }, 20000); // keep-alive anti-buffer
    req.on('close', () => { clearInterval(ka); procClients.delete(res); });
    return;
  }

  // Stop: aborta el turno actual (mata y reinicia el claude; la sesión visible se conserva)
  if (req.method === 'POST' && p === '/stop') { restartClaude(); broadcastProc({ type: 'system', detail: 'detenido por el usuario' }); return json(res, 200, { ok: true }); }

  // ── Visión de pantalla: el agente (vía curl) pide una captura; el navegador la entrega ──
  if (req.method === 'GET' && p === '/screen/now') {
    if (!procClients.size) return json(res, 503, { error: 'no_browser', hint: 'no hay ningún navegador conectado a la web de voz' });
    const id = genId();
    const timer = setTimeout(() => {
      if (pendingShots.has(id)) { pendingShots.delete(id); json(res, 504, { error: 'sin_captura', hint: 'el usuario no está compartiendo pantalla; pídele que pulse el botón de pantalla' }); }
    }, 5000);
    pendingShots.set(id, { res, timer });
    broadcastProc({ type: 'capture_request', id });
    return;
  }
  if (req.method === 'POST' && p === '/screen/frame') {
    return readBody(req, body => {
      const rec = pendingShots.get(body.id);
      json(res, 200, { ok: true });
      if (!rec) return;
      pendingShots.delete(body.id); clearTimeout(rec.timer);
      if (!body.data) return json(rec.res, 502, { error: 'sin_captura', hint: 'el usuario no está compartiendo pantalla' });
      try {
        ensureDir(SCREENS_DIR);
        const f = path.join(SCREENS_DIR, 'screen-' + Date.now() + '.jpg');
        fs.writeFileSync(f, Buffer.from(body.data, 'base64'));
        const all = fs.readdirSync(SCREENS_DIR).sort();
        while (all.length > 20) { try { fs.unlinkSync(path.join(SCREENS_DIR, all.shift())); } catch (e) { break; } }
        json(rec.res, 200, { ok: true, path: f, nota: 'lee este fichero con la herramienta Read para ver la pantalla' });
      } catch (e) { json(rec.res, 500, { error: e.message }); }
    }, 2e7);
  }

  if (req.method === 'GET' && p === '/sessions') {
    return json(res, 200, sessions.map(s => ({ id: s.id, name: s.name, createdAt: s.createdAt, active: s.id === activeId, count: s.messages.length })));
  }
  if (req.method === 'GET' && /^\/sessions\/[^/]+\/messages$/.test(p)) {
    const s = sessions.find(x => x.id === p.split('/')[2]);
    return json(res, s ? 200 : 404, s ? s.messages : []);
  }
  if (req.method === 'POST' && p === '/sessions') {
    return readBody(req, body => { const s = createSession(body.name); restartClaude(); json(res, 200, { id: s.id, name: s.name }); });
  }
  if (req.method === 'POST' && /^\/sessions\/[^/]+\/activate$/.test(p)) {
    const id = p.split('/')[2];
    if (id === activeId) return json(res, 200, { ok: true });
    if (!sessions.find(x => x.id === id)) return json(res, 404, { error: 'no existe' });
    activeId = id; saveIndex(); restartClaude(); return json(res, 200, { ok: true });
  }
  if (req.method === 'POST' && /^\/sessions\/[^/]+\/rename$/.test(p)) {
    const id = p.split('/')[2];
    return readBody(req, body => { const s = sessions.find(x => x.id === id); if (!s) return json(res, 404, {}); s.name = (body.name || '').slice(0, 60) || s.name; s.named = true; saveIndex(); json(res, 200, { ok: true }); });
  }
  if (req.method === 'DELETE' && /^\/sessions\/[^/]+$/.test(p)) {
    const id = p.split('/')[2];
    if (sessions.length <= 1) return json(res, 400, { error: 'última sesión' });
    const wasActive = id === activeId; const newActive = deleteSession(id);
    if (wasActive) restartClaude();
    return json(res, 200, { ok: true, activeId: newActive });
  }

  if (req.method === 'POST' && p === '/say') {
    if (!ready) return json(res, 503, { error: 'arrancando' });
    if (busy) return json(res, 429, { error: 'ocupado' });
    return readBody(req, body => {
      const text = (body.text || '').trim();
      const files = Array.isArray(body.files) ? body.files : [];
      if (!text && !files.length) return json(res, 400, { error: 'sin texto' });
      ask(text || '(ver archivos adjuntos)', res, files);
    }, 2e7);
  }

  if (req.method === 'GET' && p === '/fs') {
    const rel = new URL(req.url, 'http://x').searchParams.get('path') || '.';
    const abs = path.resolve(WORKSPACE, rel);
    if (abs !== WORKSPACE && !abs.startsWith(WORKSPACE + path.sep)) return json(res, 403, { error: 'forbidden' });
    try {
      const items = fs.readdirSync(abs, { withFileTypes: true })
        .filter(e => !e.name.startsWith('.') || e.name === '.claude')
        .map(e => { const o = { name: e.name, dir: e.isDirectory() }; if (!e.isDirectory()) { try { o.size = fs.statSync(path.join(abs, e.name)).size; } catch (_) {} } return o; })
        .sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name));
      return json(res, 200, { path: path.relative(WORKSPACE, abs) || '.', items });
    } catch (e) { return json(res, 500, { error: e.message }); }
  }
  if (req.method === 'GET' && p === '/fs/read') {
    const rel = new URL(req.url, 'http://x').searchParams.get('path') || '';
    const abs = path.resolve(WORKSPACE, rel);
    if (abs !== WORKSPACE && !abs.startsWith(WORKSPACE + path.sep)) return json(res, 403, { error: 'forbidden' });
    try {
      const stat = fs.statSync(abs);
      if (stat.size > 500000) return json(res, 413, { error: 'archivo demasiado grande (>500KB)' });
      return json(res, 200, { path: path.relative(WORKSPACE, abs), content: fs.readFileSync(abs, 'utf8'), size: stat.size });
    } catch (e) { return json(res, 500, { error: e.message }); }
  }

  res.writeHead(404); res.end('not found');
});

// ── Boot ─────────────────────────────────────────────────────────────────────
ensureClaudeContext();
loadSessions();
if (!sessions.length) createSession('Primera sesión');
else if (!activeId) activeId = sessions[0].id;
startClaude();
server.listen(PORT, HOST, () => {
  log(`Hey Claude escuchando en http://${HOST}:${PORT}  ·  workspace: ${WORKSPACE}  ·  permisos: ${PERMISSION_MODE}`);
  if (!TOKEN) log('AVISO seguridad: sin VOICE_TOKEN → solo seguro en localhost. Si lo expones (Tailscale Serve / túnel / 0.0.0.0), define VOICE_TOKEN=<secreto> y abre la URL con ?token=<secreto>.');
});
