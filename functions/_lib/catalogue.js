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

// Identifiers are strings only: a number or boolean here would reach dashboard code that expects text.
const STRING_ONLY = new Set(['track_id', 'zone', 'demo_id', 'form_id', 'field', 'kind', 'state', 'reason', 'mode', 'action', 'input', 'project_id', 'video_id', 'filter_id', 'list_id', 'file_id', 'method', 'choice', 'region', 'role_bucket', 'link_location', 'section_id']);

export function paramType(name) {
  return PARAM_TYPES[name] || (STRING_ONLY.has(name) ? 'str' : 'id');
}

export function eventSpec(name) {
  return Object.prototype.hasOwnProperty.call(EVENTS, name) ? EVENTS[name] : null;
}

export function storesInD1(spec) {
  return !!spec && spec.sinks.includes('d');
}
