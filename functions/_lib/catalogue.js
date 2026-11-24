// Single source of truth is tracking/catalogue.json (frozen). The catalogue lists
// parameter names only, so the type of each parameter is declared here.
// Any catalogue parameter missing from PARAM_TYPES falls back to "id" (a short
// slug-like token), the safest type.
import catalogue from '../../tracking/catalogue.json';

export const EVENTS = catalogue.events;
export const KEY_EVENTS = catalogue.key_events;
export const CATALOGUE_VERSION = catalogue.version;

// id: short token, letters digits _ . : - / +   num: finite number
// path: path only, no query, no hash   host: hostname   cells: grid cells
export const PARAM_TYPES = {
  visible_s: 'num', active_s: 'num', max_scroll: 'num', percent: 'num', dwell_s: 'num',
  seconds: 'num', ms: 'num', read_s: 'num', x: 'num', y: 'num', nth: 'num', n: 'num',
  step: 'id',
  missing_path: 'path', page_path: 'path',
  domain: 'host',
  ext: 'ext',
  value: 'numid',
  cells: 'cells',
};

export function paramType(name) {
  return PARAM_TYPES[name] || 'id';
}

export function eventSpec(name) {
  return Object.prototype.hasOwnProperty.call(EVENTS, name) ? EVENTS[name] : null;
}

export function storesInD1(spec) {
  return !!spec && spec.sinks.includes('d');
}
