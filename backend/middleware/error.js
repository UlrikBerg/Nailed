const { HttpError } = require('../lib/util');

function notFound(req, res) {
  res.status(404).json({ error: { code: 'not_found', message: 'Ressursen finnes ikke.' } });
}

// Express error handler. Must have 4 args.
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details },
    });
  }
  if (err && err.name === 'ZodError') {
    return res.status(400).json({
      error: { code: 'validation_error', message: 'Ugyldig forespørsel.', details: err.issues },
    });
  }
  console.error('[unhandled]', err);
  res.status(500).json({ error: { code: 'internal_error', message: 'Noe gikk galt.' } });
}

module.exports = { notFound, errorHandler };
