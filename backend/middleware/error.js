const { HttpError } = require('../lib/util');

function notFound(req, res) {
  res.status(404).json({ error: { code: 'not_found', message: 'Ressursen finnes ikke.' } });
}

// Multer surfaces upload-time errors with err.name === 'MulterError' and an
// err.code such as LIMIT_FILE_SIZE / LIMIT_UNEXPECTED_FILE. Translate the
// common ones to friendly Norwegian messages instead of letting them fall
// through to a generic 500.
const MULTER_MESSAGES = {
  LIMIT_FILE_SIZE: { status: 413, code: 'file_too_large', message: 'Filen er for stor. Maks 8 MB.' },
  LIMIT_FILE_COUNT: { status: 400, code: 'too_many_files', message: 'For mange filer i én forespørsel.' },
  LIMIT_UNEXPECTED_FILE: { status: 400, code: 'unexpected_field', message: 'Ukjent filfelt.' },
  LIMIT_PART_COUNT: { status: 400, code: 'too_many_parts', message: 'For mange felter i forespørselen.' },
  LIMIT_FIELD_KEY: { status: 400, code: 'field_name_too_long', message: 'Feltnavn er for langt.' },
  LIMIT_FIELD_VALUE: { status: 400, code: 'field_value_too_long', message: 'Feltverdi er for lang.' },
};

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
  if (err && err.name === 'MulterError') {
    const m = MULTER_MESSAGES[err.code] || { status: 400, code: 'upload_error', message: 'Opplasting feilet.' };
    return res.status(m.status).json({ error: { code: m.code, message: m.message } });
  }
  console.error('[unhandled]', err);
  res.status(500).json({ error: { code: 'internal_error', message: 'Noe gikk galt.' } });
}

module.exports = { notFound, errorHandler };
