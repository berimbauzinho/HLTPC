const express = require('express');
const path = require('path');

const app = express();
const PORT = 3000;
const HOST = '0.0.0.0';

app.set('trust proxy', true);

// Parse raw bodies for all /api endpoints up to 25MB (supports json, text, and binary images)
app.use('/api', express.raw({ type: '*/*', limit: '25mb' }));

async function startServer() {
  // Load Netlify function handlers
  const adminLogin = require('./netlify/functions/admin-login.js').handler;
  const adminSession = require('./netlify/functions/admin-session.js').handler;
  const adminLogout = require('./netlify/functions/admin-logout.js').handler;
  const adminChangePassword = require('./netlify/functions/admin-change-password.js').handler;
  const adminUsers = require('./netlify/functions/admin-users.js').handler;

  const contentV2 = (await import('./netlify/functions/content-v2.mjs')).default;
  const adminContentV2 = (await import('./netlify/functions/admin-content-v2.mjs')).default;
  const adminMediaV2 = (await import('./netlify/functions/admin-media-v2.mjs')).default;
  const mediaV2 = (await import('./netlify/functions/media-v2.mjs')).default;
  const adminProcessDemo = (await import('./netlify/functions/admin-process-demo-v2-background.mjs')).default;

  // Helper for Netlify v1 lambda handlers
  function handleLambda(handler) {
    return async (req, res) => {
      try {
        let bodyStr = '';
        if (req.body) {
          bodyStr = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body);
        }
        const event = {
          httpMethod: req.method,
          headers: req.headers,
          body: bodyStr,
          queryStringParameters: req.query || {},
          path: req.path
        };
        const result = await handler(event);
        res.status(result.statusCode || 200);
        if (result.headers) {
          for (const [key, val] of Object.entries(result.headers)) {
            res.setHeader(key, val);
          }
        }
        res.send(result.body);
      } catch (err) {
        console.error('Lambda handler error:', err);
        res.status(500).json({ error: err.message || 'Internal server error' });
      }
    };
  }

  // Helper for Netlify v2 Web Request/Response handlers
  function handleWeb(handler, urlModifier) {
    return async (req, res) => {
      try {
        let fullUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
        if (urlModifier) {
          fullUrl = urlModifier(fullUrl, req);
        }
        const headers = new Headers();
        for (const [key, val] of Object.entries(req.headers)) {
          if (Array.isArray(val)) {
            val.forEach(v => headers.append(key, v));
          } else if (val !== undefined) {
            headers.set(key, val);
          }
        }
        const init = {
          method: req.method,
          headers
        };
        if (req.method !== 'GET' && req.method !== 'HEAD' && req.body) {
          init.body = req.body;
        }
        const webRequest = new Request(fullUrl, init);
        const webResponse = await handler(webRequest);
        res.status(webResponse.status);
        webResponse.headers.forEach((val, key) => {
          res.setHeader(key, val);
        });
        const arrayBuf = await webResponse.arrayBuffer();
        res.send(Buffer.from(arrayBuf));
      } catch (err) {
        console.error('Web handler error:', err);
        res.status(500).json({ error: err.message || 'Internal server error' });
      }
    };
  }

  // --- API Routes ---
  app.all('/api/admin/login', handleLambda(adminLogin));
  app.all('/api/admin/session', handleLambda(adminSession));
  app.all('/api/admin/logout', handleLambda(adminLogout));
  app.all('/api/admin/change-password', handleLambda(adminChangePassword));
  app.all('/api/admin/users', handleLambda(adminUsers));

  app.all('/api/content', handleWeb(contentV2));
  app.all('/api/admin/content', handleWeb(adminContentV2));
  app.all('/api/admin/media', handleWeb(adminMediaV2));

  // Media route: /api/media/:id -> /media-v2?id=:id
  app.all('/api/media/:id', handleWeb(mediaV2, (url, req) => {
    const parsed = new URL(url);
    parsed.searchParams.set('id', req.params.id);
    return parsed.href;
  }));

  // Background demo processing route
  app.post('/api/admin/process-demo', (req, res) => {
    res.status(200).json({ ok: true });
    // Process asynchronously in background
    let fullUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
    const headers = new Headers();
    for (const [key, val] of Object.entries(req.headers)) {
      if (Array.isArray(val)) val.forEach(v => headers.append(key, v));
      else if (val !== undefined) headers.set(key, val);
    }
    const init = { method: req.method, headers, body: req.body };
    const webRequest = new Request(fullUrl, init);
    adminProcessDemo(webRequest).catch(err => console.error('Demo processing background error:', err));
  });

  // Health check endpoint
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  // --- Static Files ---
  const publicDir = path.resolve(__dirname);

  // Serve /admin directory
  app.use('/admin', express.static(path.join(publicDir, 'admin')));
  app.get('/admin', (req, res) => {
    res.sendFile(path.join(publicDir, 'admin', 'index.html'));
  });

  // Serve root static files (assets, index.html, styles.css, app.js, data.js, etc.)
  app.use(express.static(publicDir, {
    index: 'index.html'
  }));

  // Fallback to index.html for SPA/routes (excluding /api/*)
  app.get('*all', (req, res, next) => {
    if (req.path.startsWith('/api/')) {
      return next();
    }
    if (req.path.startsWith('/admin')) {
      return res.sendFile(path.join(publicDir, 'admin', 'index.html'));
    }
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  const server = app.listen(PORT, HOST, () => {
    console.log(`HLTPC server running on http://${HOST}:${PORT}`);
  });

  return server;
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
