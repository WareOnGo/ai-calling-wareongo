import { spawn } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const harness = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(process.env.EVAL_RENDER_DIR || resolve(harness, 'shots', `dashboard-${new Date().toISOString().replaceAll(':', '-')}`));
mkdirSync(output, { recursive: true });
const child = spawn(process.execPath, [resolve(harness, 'node_modules/@playwright/test/cli.js'), 'test', '31-render-dashboard.spec.ts', ...process.argv.slice(2)], {
  cwd: harness, stdio: 'inherit', env: { ...process.env, EVAL_RENDER_DIR: output },
});
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => {
  const captures = readdirSync(output).filter(name => /^manifest-.*\.json$/.test(name)).flatMap(name => JSON.parse(readFileSync(resolve(output, name), 'utf8')));
  writeFileSync(resolve(output, 'manifest.json'), JSON.stringify({ generatedAt: new Date().toISOString(), exitCode: code, captures }, null, 2));
  const escaped = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
  const cards = captures.map(item => `<article data-theme="${item.theme}" data-width="${item.width}" data-label="${escaped(item.label.toLowerCase())}"><h2>${escaped(item.label)}</h2><p>${item.width} × ${item.height} · ${item.theme} · ${escaped(item.route)}</p><a href="${item.file}" target="_blank"><img loading="lazy" src="${item.file}" alt="${escaped(item.label)} in ${item.theme}"></a><p>${item.visibleRows} complete rows in view · ${item.visibleControls} controls in view</p></article>`).join('\n');
  writeFileSync(resolve(output, 'index.html'), `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Bolna dashboard visual audit</title><style>body{margin:0;padding:24px;background:#101113;color:#eee;font:14px/1.5 system-ui}h1{font-size:24px}h2{font-size:16px;margin:0}p{color:#b3b3bc}header{position:sticky;top:0;background:#101113;padding:12px 0;z-index:1}label{margin-right:16px}input,select{padding:8px;color:inherit;background:#24252b;border:1px solid #777;border-radius:6px}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:24px}article{min-width:0;background:#1a1b20;padding:16px;border-radius:12px}article[hidden]{display:none}img{display:block;width:100%;max-height:650px;object-fit:contain;object-position:top;background:#111}a{color:#c1b4ff}</style><header><h1>Bolna dashboard visual audit</h1><p>${captures.length} captures · synthetic eval data · ${code === 0 ? 'Checks passed' : 'Run incomplete or checks failed; inspect Playwright report'}</p><label>Search <input id="search" type="search" placeholder="Page or interaction"></label><label>Theme <select id="theme"><option value="">Both</option><option>light</option><option>dark</option></select></label><label>Width <select id="width"><option value="">Both</option><option>1366</option><option>390</option></select></label></header><main>${cards}</main><script>function filter(){document.querySelectorAll('article').forEach(card=>{card.hidden=!card.dataset.label.includes(document.getElementById('search').value.toLowerCase())||(document.getElementById('theme').value&&card.dataset.theme!==document.getElementById('theme').value)||(document.getElementById('width').value&&card.dataset.width!==document.getElementById('width').value)})}document.querySelectorAll('input,select').forEach(input=>input.addEventListener('input',filter));</script></html>`);
  console.log(`\nVisual gallery: ${resolve(output, 'index.html')}\nManifest: ${resolve(output, 'manifest.json')}\n`);
  process.exitCode = code ?? 1;
});
