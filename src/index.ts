import express, { Request, Response, NextFunction } from 'express';
import session from 'express-session';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import axios from 'axios';

declare module 'express-session' {
  interface SessionData {
    token?: string;
  }
}

const app = express();
const PORT = process.env.PORT || 4000;
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const API_URL = (process.env.API_URL || 'http://localhost:3002').replace(/\/$/, '');

const redis = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
const queue = new Queue('challenge-validations', { connection: redis });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'eco-validator-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 8 * 60 * 60 * 1000 },
  }),
);

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session.token) return res.redirect('/login');
  next();
}

// ─── LOGIN ──────────────────────────────────────────────────────────────────

app.get('/login', (_req, res) => res.send(loginPage()));

app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const { data } = await axios.post(`${API_URL}/auth/login`, { email, password });
    req.session.token = data.access_token;
    res.redirect('/');
  } catch {
    res.send(loginPage('E-mail ou senha incorretos'));
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

// ─── DASHBOARD ──────────────────────────────────────────────────────────────

app.get('/', requireAuth, async (req, res) => {
  const errorMsg = req.query.error as string | undefined;
  try {
    const jobs = await queue.getJobs(['waiting', 'delayed']);
    const submissions = jobs
      .sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0))
      .map((j) => j.data);
    res.send(dashboardPage(submissions, errorMsg));
  } catch {
    res.send(dashboardPage([], 'Não foi possível conectar ao Redis'));
  }
});

// ─── APPROVE ────────────────────────────────────────────────────────────────

app.post('/submissoes/:id/approve', requireAuth, async (req, res) => {
  const id = req.params.id;
  try {
    await axios.patch(
      `${API_URL}/desafios/submissoes/${id}/status`,
      { status: 'SUCCESS' },
      { headers: { Authorization: `Bearer ${req.session.token}` } },
    );
    const job = await queue.getJob(`submissao-${id}`);
    if (job) await job.remove();
    res.redirect('/');
  } catch (err: any) {
    const msg = err?.response?.data?.message || 'Erro ao aprovar submissão';
    res.redirect(`/?error=${encodeURIComponent(msg)}`);
  }
});

// ─── REJECT ─────────────────────────────────────────────────────────────────

app.post('/submissoes/:id/reject', requireAuth, async (req, res) => {
  const id = req.params.id;
  try {
    await axios.patch(
      `${API_URL}/desafios/submissoes/${id}/status`,
      { status: 'ERROR' },
      { headers: { Authorization: `Bearer ${req.session.token}` } },
    );
    const job = await queue.getJob(`submissao-${id}`);
    if (job) await job.remove();
    res.redirect('/');
  } catch (err: any) {
    const msg = err?.response?.data?.message || 'Erro ao rejeitar submissão';
    res.redirect(`/?error=${encodeURIComponent(msg)}`);
  }
});

// ─── START ──────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`🌱 EcoConsciente Validator rodando em http://localhost:${PORT}`);
});

// ─── HTML ────────────────────────────────────────────────────────────────────

const BASE_STYLES = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    background: linear-gradient(135deg, #1A211A 0%, #2a3a2a 100%);
    min-height: 100vh; color: #fff;
  }
`;

function loginPage(error?: string): string {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>EcoConsciente — Validador</title>
  <style>
    ${BASE_STYLES}
    body { display: flex; align-items: center; justify-content: center; }
    .card {
      background: rgba(26,33,26,0.95);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 20px; padding: 40px;
      width: 100%; max-width: 400px;
    }
    .logo { text-align: center; margin-bottom: 32px; }
    .logo .icon { font-size: 3rem; display: block; margin-bottom: 8px; }
    .logo h1 { font-size: 1.5rem; }
    .logo p { color: #EE9300; font-size: 0.9rem; margin-top: 4px; }
    label { display: block; color: rgba(255,255,255,0.6); font-size: 0.85rem; margin-bottom: 6px; }
    input {
      width: 100%; padding: 12px 16px; margin-bottom: 16px;
      background: rgba(50,52,65,0.8);
      border: 2px solid transparent; border-radius: 10px;
      color: #fff; font-size: 1rem; outline: none;
      transition: border-color 0.2s;
    }
    input:focus { border-color: #00A335; }
    button {
      width: 100%; padding: 14px;
      background: linear-gradient(135deg, #00A335, #00d444);
      border: none; border-radius: 10px;
      color: #fff; font-size: 1rem; font-weight: 600;
      cursor: pointer; transition: opacity 0.2s;
    }
    button:hover { opacity: 0.88; }
    .error {
      background: rgba(220,38,38,0.15);
      border: 1px solid rgba(220,38,38,0.3);
      color: #ff6b6b; border-radius: 10px;
      padding: 10px 14px; margin-bottom: 16px; font-size: 0.9rem;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">
      <span class="icon">🌱</span>
      <h1>EcoConsciente</h1>
      <p>Painel de Validação</p>
    </div>
    ${error ? `<div class="error">⚠️ ${error}</div>` : ''}
    <form method="POST" action="/login">
      <label>E-mail</label>
      <input type="email" name="email" placeholder="seu@email.com" required autofocus>
      <label>Senha</label>
      <input type="password" name="password" placeholder="••••••••" required>
      <button type="submit">Entrar</button>
    </form>
  </div>
</body>
</html>`;
}

function dashboardPage(submissions: any[], error?: string): string {
  const count = submissions.length;

  const cards =
    count === 0
      ? `<div class="empty">
          <span>🎉</span>
          <p>Nenhuma submissão pendente</p>
          <small>A página atualiza automaticamente a cada 30s</small>
        </div>`
      : submissions
          .map(
            (s) => `
        <article class="card">
          <div class="card-header">
            <h3>${escapeHtml(s.desafioTitle)}</h3>
            <div class="badges">
              <span class="badge-points">🏆 ${s.pontos} pts</span>
              <span class="badge-pending">⏳ Pendente</span>
            </div>
          </div>
          <a class="photo-link" href="${escapeHtml(s.imageUrl)}" target="_blank" rel="noopener" title="Abrir foto em tamanho completo">
            <img
              src="${escapeHtml(s.imageUrl)}"
              alt="Foto de prova"
              loading="lazy"
              onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"
            >
            <div class="photo-error" style="display:none">📷 Foto indisponível</div>
          </a>
          <div class="card-meta">
            <span>👤 ${escapeHtml(s.userName)}</span>
            <span>🕐 ${new Date(s.submittedAt).toLocaleString('pt-BR')}</span>
          </div>
          <div class="card-actions">
            <form method="POST" action="/submissoes/${s.submissaoId}/approve"
                  onsubmit="return confirm('Aprovar submissão de ${escapeHtml(s.userName)}?')">
              <button class="btn-approve">✅ Aprovar</button>
            </form>
            <form method="POST" action="/submissoes/${s.submissaoId}/reject"
                  onsubmit="return confirm('Rejeitar submissão de ${escapeHtml(s.userName)}?')">
              <button class="btn-reject">❌ Rejeitar</button>
            </form>
          </div>
        </article>`,
          )
          .join('');

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Validador — ${count} pendente${count !== 1 ? 's' : ''}</title>
  <meta http-equiv="refresh" content="30">
  <style>
    ${BASE_STYLES}
    header {
      background: rgba(26,33,26,0.95);
      border-bottom: 1px solid rgba(255,255,255,0.08);
      padding: 14px 28px;
      display: flex; align-items: center; justify-content: space-between;
      position: sticky; top: 0; z-index: 10;
    }
    .logo { display: flex; align-items: center; gap: 10px; }
    .logo span { font-size: 1.4rem; }
    .logo h1 { font-size: 1.1rem; }
    .logo small { display: block; color: #EE9300; font-size: 0.75rem; font-weight: normal; }
    .header-right { display: flex; align-items: center; gap: 12px; }
    .count-badge {
      background: rgba(0,163,53,0.2);
      border: 1px solid rgba(0,163,53,0.4);
      color: #00d444; border-radius: 20px;
      padding: 4px 14px; font-size: 0.85rem; font-weight: 700;
    }
    .refresh-hint { color: rgba(255,255,255,0.3); font-size: 0.75rem; }
    .btn-logout {
      background: rgba(255,255,255,0.08);
      border: 1px solid rgba(255,255,255,0.15);
      color: rgba(255,255,255,0.6); border-radius: 8px;
      padding: 6px 14px; cursor: pointer; font-size: 0.82rem;
      text-decoration: none; transition: background 0.2s;
    }
    .btn-logout:hover { background: rgba(255,255,255,0.14); }
    main { padding: 28px; max-width: 1280px; margin: 0 auto; }
    .error-bar {
      background: rgba(220,38,38,0.12);
      border: 1px solid rgba(220,38,38,0.3);
      color: #ff6b6b; border-radius: 10px;
      padding: 12px 16px; margin-bottom: 24px; font-size: 0.9rem;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
      gap: 20px;
    }
    .card {
      background: rgba(26,33,26,0.95);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 16px; overflow: hidden;
      display: flex; flex-direction: column;
    }
    .card-header { padding: 16px 18px 12px; }
    .card-header h3 {
      font-size: 0.9rem; line-height: 1.45;
      color: rgba(255,255,255,0.9); margin-bottom: 10px;
    }
    .badges { display: flex; gap: 8px; flex-wrap: wrap; }
    .badge-points {
      background: rgba(238,147,0,0.15);
      border: 1px solid rgba(238,147,0,0.3);
      color: #EE9300; border-radius: 20px;
      padding: 2px 10px; font-size: 0.78rem; font-weight: 600;
    }
    .badge-pending {
      background: rgba(99,102,241,0.15);
      border: 1px solid rgba(99,102,241,0.3);
      color: #a5b4fc; border-radius: 20px;
      padding: 2px 10px; font-size: 0.78rem;
    }
    .photo-link { display: block; position: relative; background: rgba(0,0,0,0.3); }
    .photo-link img {
      width: 100%; height: 210px; object-fit: cover;
      display: block; transition: opacity 0.2s;
    }
    .photo-link:hover img { opacity: 0.88; }
    .photo-error {
      height: 210px; align-items: center; justify-content: center;
      color: rgba(255,255,255,0.3); font-size: 0.9rem;
      flex-direction: column; gap: 8px;
    }
    .card-meta {
      padding: 10px 18px;
      display: flex; gap: 14px; flex-wrap: wrap;
      color: rgba(255,255,255,0.45); font-size: 0.78rem;
      border-top: 1px solid rgba(255,255,255,0.06);
    }
    .card-actions {
      padding: 12px 18px;
      display: flex; gap: 8px;
      border-top: 1px solid rgba(255,255,255,0.06);
      margin-top: auto;
    }
    .card-actions form { flex: 1; }
    .btn-approve, .btn-reject {
      width: 100%; padding: 9px 12px;
      border: none; border-radius: 8px;
      font-size: 0.88rem; font-weight: 600;
      cursor: pointer; transition: opacity 0.2s;
    }
    .btn-approve { background: linear-gradient(135deg, #00A335, #00d444); color: #fff; }
    .btn-reject { background: rgba(220,38,38,0.75); color: #fff; }
    .btn-approve:hover, .btn-reject:hover { opacity: 0.82; }
    .empty {
      grid-column: 1 / -1; text-align: center;
      padding: 80px 20px; color: rgba(255,255,255,0.3);
    }
    .empty span { font-size: 4rem; display: block; margin-bottom: 16px; }
    .empty p { font-size: 1.1rem; margin-bottom: 8px; }
    .empty small { font-size: 0.8rem; }
  </style>
</head>
<body>
  <header>
    <div class="logo">
      <span>🌱</span>
      <div>
        <h1>EcoConsciente <small>Painel de Validação</small></h1>
      </div>
    </div>
    <div class="header-right">
      <span class="refresh-hint">atualiza em 30s</span>
      <span class="count-badge">${count} pendente${count !== 1 ? 's' : ''}</span>
      <a class="btn-logout" href="/logout">Sair</a>
    </div>
  </header>
  <main>
    ${error ? `<div class="error-bar">⚠️ ${decodeURIComponent(error)}</div>` : ''}
    <div class="grid">
      ${cards}
    </div>
  </main>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
