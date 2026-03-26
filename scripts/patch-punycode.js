/**
 * postinstall patch — corrige DEP0040 (punycode deprecated)
 *
 * grammy → node-fetch@2 → whatwg-url@5 → tr46@0.0.3
 * tr46 faz require("punycode") que no Node ≥21 resolve para o built-in deprecated.
 * Este patch troca por require("punycode/") que resolve para o pacote npm mantido.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const target = path.join(__dirname, '..', 'node_modules', 'tr46', 'index.js');

if (!fs.existsSync(target)) {
  // tr46 não instalado — nada a fazer
  process.exit(0);
}

let code = fs.readFileSync(target, 'utf8');
const needle = 'require("punycode")';
const replacement = 'require("punycode/")';

if (code.includes(replacement)) {
  // já patcheado
  process.exit(0);
}

if (!code.includes(needle)) {
  console.warn('[patch-punycode] padrão não encontrado em tr46/index.js — talvez já atualizado');
  process.exit(0);
}

code = code.replace(needle, replacement);
fs.writeFileSync(target, code, 'utf8');
console.log('[patch-punycode] tr46/index.js corrigido → require("punycode/")');
