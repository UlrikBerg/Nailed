const config = require('../config');

let backend;
if (config.storage.backend === 'r2') {
  backend = require('./r2');
} else {
  backend = require('./local');
}

module.exports = backend;
