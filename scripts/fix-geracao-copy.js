const fs = require('fs');
const path = require('path');
const p = path.join(__dirname, '..', 'frontend', 'src', 'pages', 'Geracao.jsx');
let s = fs.readFileSync(p, 'utf8');
function rep(re, to){ s = s.replace(re, to); }
rep(/Falha ao consultar gr.*?fico/g, 'Falha ao consultar gráfico');
rep(/label:'Gera.{0,10}o'/g, "label:'Geração'");
rep(/>Gera.{0,10}o de Energia</g, '>Geração de Energia<');
rep(/>M.{0,4}s</g, '>Mês<');
rep(/Pr.{0,4}-carregando/g, 'Pré-carregando');
rep(/Pr.{0,4}-carregar/g, 'Pré-carregar');
rep(/.ltimos/g, 'últimos');
rep(/n.o/g, 'não');
rep(/requisi.{0,6}es/g, 'requisições');
fs.writeFileSync(p, s, 'utf8');
console.log('Geracao.jsx copy normalized');

