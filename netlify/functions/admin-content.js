const { json } = require('./auth-utils');
// Disable every write through the obsolete direct function URL.
exports.handler = async () => json(410, { error: 'Painel antigo bloqueado. Atualize a página e use /api/admin/content.' });
