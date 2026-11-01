// The installer page. Everything shown comes from the installer's event stream; every answer goes
// back to it and is checked there. Text is set with textContent only, never as HTML.

const COMMANDS = {
  install: ['Install or carry on', 'Sign in, check, show the plan, then set up the inventory lanes once you approve it.'],
  preview: ['Preview the plan', 'What install would do, without signing in.'],
  prereqs: ['Check prerequisites', 'Your roles, tenant settings and licences. Read-only.'],
  status: ['Status', 'What the install record says is installed. No sign-in.'],
  check: ['Check the install', 'Solutions, flows and each lane\'s latest run. Changes nothing.'],
  'deploy-app': ['Deploy the app', 'Build and deploy the app again, only if the build changed.'],
  'rotate-secret': ['Rotate secrets', 'New client secrets, put where the flows read them.'],
  uninstall: ['Uninstall', 'Removes what the installer made, after a confirmation. Data stays.'],
};

const $ = (id) => document.getElementById(id);
const feed = $('feed');
const question = $('question');
const live = $('live');
let running = null;

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== false) node.setAttribute(k, v === true ? '' : v);
  }
  for (const ch of children) if (ch !== null && ch !== undefined) node.append(ch);
  return node;
}

async function post(path, body = {}) {
  const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { ok: res.ok, status: res.status, body: await res.json().catch(() => ({})) };
}

function setRunning(name) {
  running = name;
  for (const b of document.querySelectorAll('.command')) b.disabled = !!name;
}

function renderCommands() {
  const box = $('commands');
  box.replaceChildren();
  for (const [id, [title, about]] of Object.entries(COMMANDS)) {
    box.append(el('button', { class: 'command', type: 'button', onclick: () => start(id) }, el('strong', { text: title }), el('span', { class: 'muted', text: about })));
  }
}

async function start(command) {
  if (running) return;
  feed.replaceChildren();
  const r = await post('/api/start', { command });
  if (!r.ok) add(el('div', { class: 'line fail', text: r.body.error ?? 'Couldn\'t start that.' }));
}

function add(node) {
  feed.append(node);
  node.scrollIntoView({ block: 'nearest' });
}

function renderPlan(plan) {
  const facts = el('dl', { class: 'facts' });
  for (const f of plan.facts) facts.append(el('dt', { text: f.label }), el('dd', { text: f.value }));
  const list = el('ol');
  for (const s of plan.steps) {
    const tag = s.state === 'done' ? el('span', { class: 'tag done', text: 'already done' }) : s.state === 'skip' ? el('span', { class: 'tag skip', text: 'skipped' }) : s.approval ? el('span', { class: 'tag approval', text: 'asks again before it runs' }) : null;
    const changes = el('ul');
    for (const c of s.changes) changes.append(el('li', { text: c }));
    if (s.role) changes.append(el('li', { text: `Needs: ${s.role}` }));
    if (s.note) changes.append(el('li', { text: s.note }));
    list.append(el('li', {}, el('strong', { text: s.title }), tag, changes));
  }
  return el('div', { class: 'card plan' }, el('h2', { text: plan.title }), facts, list);
}

function renderPrereqs(items) {
  const body = el('tbody');
  for (const p of items) {
    body.append(el('tr', {},
      el('td', { class: `status-${p.status}`, text: { met: '✓ Met', missing: '✗ Missing', eligible: '! Eligible (activate it)', unknown: '? Couldn\'t check' }[p.status] ?? p.status }),
      el('td', {}, el('strong', { text: p.label }), p.detail ? el('div', { class: 'muted', text: p.detail }) : null),
      el('td', { text: [p.neededFor, p.status === 'met' ? '' : p.howTo].filter(Boolean).join('. ') + (p.optional ? ' (optional)' : '') }),
    ));
  }
  return el('div', { class: 'card prereqs' }, el('h2', { text: 'Prerequisites' }), el('table', {}, el('thead', {}, el('tr', {}, el('th', { text: 'State' }), el('th', { text: 'Check' }), el('th', { text: 'Needed for' }))), body));
}

function renderNext(title, steps) {
  const list = el('ul');
  for (const s of steps) {
    const item = el('li', {}, el('strong', { text: s.title }), el('span', { class: 'muted', text: `  ${s.who}` }), el('div', { text: s.why }));
    if (s.link) item.append(el('div', {}, el('a', { href: s.link, target: '_blank', rel: 'noopener noreferrer', text: s.linkText ?? s.link })));
    for (const line of s.steps ?? []) item.append(el('div', {}, el('code', { text: line })));
    if (s.message) item.append(el('div', { class: 'muted', text: s.message }));
    list.append(item);
  }
  return el('div', { class: 'card next' }, el('h2', { text: title }), list);
}

function ask(e) {
  question.hidden = false;
  question.replaceChildren(el('h2', { text: e.message }));
  question.dataset.id = String(e.id);
  const error = el('div', { class: 'error', role: 'alert' });
  const send = async (value) => {
    const r = await post('/api/answer', { id: e.id, value });
    if (!r.ok) error.textContent = r.body.error ?? 'That answer wasn\'t taken.';
  };
  const actions = el('div', { class: 'actions' });
  if (e.kind === 'confirm') {
    actions.append(
      el('button', { class: e.default ? 'primary' : 'secondary', type: 'button', text: 'Yes', onclick: () => send(true) }),
      el('button', { class: e.default ? 'secondary' : 'primary', type: 'button', text: 'No', onclick: () => send(false) }),
    );
    question.append(actions);
  } else if (e.kind === 'select') {
    const name = `q${e.id}`;
    e.choices.forEach((ch, i) => {
      const input = el('input', { type: 'radio', name, value: String(i), disabled: !!ch.disabled, checked: i === e.default });
      question.append(el('label', { class: 'choice' }, input, el('span', {}, ch.name, ch.description ? el('small', { text: ch.description }) : null, typeof ch.disabled === 'string' ? el('small', { text: ch.disabled }) : null)));
    });
    actions.append(el('button', { class: 'primary', type: 'button', text: 'Continue', onclick: () => send(Number(question.querySelector(`input[name="${name}"]:checked`)?.value ?? -1)) }));
    question.append(actions);
  } else if (e.kind === 'checkbox') {
    e.choices.forEach((ch, i) => {
      question.append(el('label', { class: 'choice' }, el('input', { type: 'checkbox', value: String(i), disabled: !!ch.disabled, checked: !!ch.checked }), el('span', {}, ch.name, ch.description ? el('small', { text: ch.description }) : null)));
    });
    actions.append(el('button', { class: 'primary', type: 'button', text: 'Continue', onclick: () => send([...question.querySelectorAll('input[type="checkbox"]:checked')].map((x) => Number(x.value))) }));
    question.append(actions);
  } else {
    const input = el('input', { type: e.kind === 'secret' ? 'password' : 'text', value: e.default ?? '', autocomplete: 'off', 'aria-label': e.message });
    input.addEventListener('keydown', (k) => {
      if (k.key === 'Enter') send(input.value);
    });
    actions.append(el('button', { class: 'primary', type: 'button', text: 'Continue', onclick: () => send(input.value) }));
    question.append(input, actions);
    input.focus();
  }
  actions.append(el('button', { class: 'quiet', type: 'button', text: 'Cancel', onclick: () => post('/api/cancel') }));
  question.append(error);
  live.textContent = e.message;
}

const progress = new Map();

function handle(e) {
  switch (e.type) {
    case 'command':
      if (e.state === 'running') {
        setRunning(e.command);
        add(el('div', { class: 'command-state', text: `Running: ${COMMANDS[e.command]?.[0] ?? e.command}` }));
      } else {
        setRunning(null);
        question.hidden = true;
        add(el('div', { class: `command-state ${e.state}`, text: `${COMMANDS[e.command]?.[0] ?? e.command}: ${e.state}${e.error ? `. ${e.error}` : ''}` }));
        live.textContent = `${e.command} ${e.state}`;
      }
      break;
    case 'heading':
      add(el('div', { class: 'heading', text: e.title }));
      break;
    case 'step':
      add(el('div', { class: 'step', text: `${e.n} of ${e.total}: ${e.title}` }));
      break;
    case 'line':
      add(el('div', { class: `line ${e.kind}`, text: e.text }));
      break;
    case 'plan':
      add(renderPlan(e.plan));
      break;
    case 'prereqs':
      add(renderPrereqs(e.items));
      break;
    case 'next-steps':
      add(renderNext(e.title, e.steps));
      break;
    case 'prompt':
      ask(e);
      break;
    case 'invalid':
      break;
    case 'answered':
      if (question.dataset.id === String(e.id)) question.hidden = true;
      add(el('div', { class: 'answered', text: `→ ${e.display}` }));
      break;
    case 'auto':
      add(el('div', { class: 'line ok', text: `${e.message}: ${e.display}` }));
      break;
    case 'progress': {
      let node = progress.get(e.id);
      if (!node) {
        node = el('div', { class: 'progress' });
        progress.set(e.id, node);
        add(node);
      }
      node.textContent = `${e.label}: ${e.status} (${Math.round(e.elapsed / 1000)}s)`;
      break;
    }
    case 'progress-done':
      progress.get(e.id)?.remove();
      progress.delete(e.id);
      break;
  }
}

$('quit').addEventListener('click', async () => {
  const r = await post('/api/quit');
  if (r.ok) document.body.replaceChildren(el('p', { class: 'noscript', text: 'The installer has closed. You can close this tab.' }));
  else add(el('div', { class: 'line warn', text: r.body.error ?? 'Couldn\'t close yet.' }));
});

renderCommands();
fetch('/api/state').then((r) => r.json()).then((s) => setRunning(s.running)).catch(() => {});
const events = new EventSource('/events');
events.onmessage = (m) => handle(JSON.parse(m.data));
