const fs = require('node:fs');
const path = require('node:path');
const output = path.resolve('dist');
fs.mkdirSync(output, { recursive: true });
for (const name of ['index.html', 'styles.css', 'refinements.css', 'viewer.css', 'app.js', 'data.js', 'data-2025.js', 'assets', 'admin']) {
  fs.cpSync(path.resolve(name), path.join(output, name), { recursive: true });
}
console.log('Site público preparado em dist; dados locais, ferramentas e código do servidor não são publicados.');
fs.copyFileSync('netlify/functions/demo-series.mjs', path.join(output, 'admin/demo-series.mjs'));
