// Ubicación legible y modalidad declarada en la vista de alumna.
// Las fuentes entregan códigos ISO ('es'), cadenas de Google con barrio y comunidad, arrays
// serializados ('["United States"]') y texto libre. La ficha debe leer un lugar, y la modalidad
// no puede suponerse: «Presencial u híbrido» era una invención del motor.
// Uso: node --experimental-strip-types tests/engine/location.mjs   (sin red ni Cloudflare)
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const workerPath = fileURLToPath(new URL('../../sites/engine/worker.js', import.meta.url));
const stage = join(mkdtempSync(join(tmpdir(), 'wdc-engine-location-')), 'worker.mjs');
copyFileSync(workerPath, stage);
const { __test } = await import(pathToFileURL(stage).href);
const { locationLabel, countryOfLocation, modalityOf } = __test;

// El código ISO suelto es el caso más repetido en la base (1.405 filas con 'es').
assert.equal(locationLabel('es'), 'España');
assert.equal(locationLabel('br'), 'Brasil');
assert.equal(locationLabel('mx'), 'México');
assert.equal(locationLabel('es, us'), 'España', 'lista de códigos: se queda el primero reconocido');

// Cadena de Google: barrio + comunidad + país. Se enseña ciudad y país, no tres veces Madrid.
assert.equal(locationLabel('Madrid, Comunidad de Madrid, España'), 'Madrid, España');
// Formato de Google con barrio: «Salamanca» y «Retiro» son barrios de Madrid, no ciudades.
assert.equal(locationLabel('Salamanca, Madrid, Comunidad de Madrid, Spain'), 'Madrid, España');
assert.equal(locationLabel('Retiro, Madrid, Comunidad de Madrid, España'), 'Madrid, España');
assert.equal(locationLabel('Las Rozas de Madrid, Comunidad de Madrid, España'), 'Las Rozas de Madrid, España');

// Arrays serializados que llegan como texto (Google Jobs).
assert.equal(locationLabel('["United States"]'), 'Estados Unidos');
assert.equal(locationLabel('["Colombia","Mexico"]'), 'Colombia');

// Ciudades de LATAM sin país explícito: el país se reconoce, no se deja el topónimo suelto.
assert.equal(locationLabel('Bogotá'), 'Bogotá, Colombia');
assert.equal(locationLabel('CDMX'), 'CDMX, México');
assert.equal(locationLabel('Buenos Aires'), 'Buenos Aires, Argentina');
assert.equal(locationLabel('Lima, Perú'), 'Lima, Perú');

// Remoto y vacío.
assert.equal(locationLabel('Remote'), 'Remoto');
assert.equal(locationLabel('remoto'), 'Remoto');
assert.equal(locationLabel(null), 'Ubicación por confirmar');
assert.equal(locationLabel(''), 'Ubicación por confirmar');
// Sin país reconocible no se inventa uno.
assert.equal(locationLabel('Zona industrial'), 'Zona industrial');

// País para clasificar: solo lo que la ubicación dice, salvo España, que tiene los 8.132 municipios.
assert.equal(countryOfLocation('Bogotá'), 'Colombia');
assert.equal(countryOfLocation('Bogotá', { conCiudades: false }), null);
assert.equal(countryOfLocation('Valencia'), 'España');
assert.equal(countryOfLocation('Madrid, Comunidad de Madrid, España'), 'España');

// Modalidad: lo que dice el anuncio, y si no lo dice, se declara.
assert.equal(modalityOf('Buscamos comercial para nuestra oficina'), 'Modalidad no indicada');
assert.equal(modalityOf('Puesto presencial en nuestra sede de Madrid'), 'Presencial');
assert.equal(modalityOf('Trabajo 100% remoto desde cualquier ciudad'), 'Remoto');
assert.equal(modalityOf('Modelo híbrido: 2 días en oficina'), 'Híbrido');
assert.equal(modalityOf('Buscamos closer', 'Remoto'), 'Remoto');
// Una ubicación concreta no convierte el puesto en presencial: el anuncio no lo dice.
assert.equal(modalityOf('Buscamos closer', 'Madrid, España'), 'Modalidad no indicada');

console.log('PASS  ubicación legible y modalidad declarada (24 casos)');
