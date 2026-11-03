// No bundler needed: verify the app imports cleanly and static assets exist.
import { existsSync } from 'node:fs';
await import('../server/index.js');
for (const f of ['public/index.html', 'public/app.js', 'public/style.css']) if (!existsSync(f)) { console.error('missing', f); process.exit(1); }
console.log('build: server modules load, static assets present'); process.exit(0);
