import fs from 'node:fs';
const P = s => s ? s.split(' ') : [];
const E = {};
const add = (sinks, text) => text.trim().split('\n').forEach(l => { const [n, p = ''] = l.trim().split(':'); E[n] = { sinks, params: P(p.trim()) }; });
add('gd', `
page_leave: visible_s active_s max_scroll
scroll_milestone: percent
page_not_found: missing_path
consent_choice: choice region
nav_click: track_id zone
menu_toggle: state
lang_toggle: to
outbound_click: domain track_id
email_click: track_id
phone_click: track_id
file_download: file_id ext
cv_download: file_id
brandbook_click: link_location
project_open: project_id
project_close: project_id method dwell_s
filter_apply: filter_id list_id
form_start: form_id
form_error: form_id field
form_submit_attempt: form_id
form_submit_success: form_id
form_submit_failure: form_id
form_abandon: form_id field
newsletter_request: page_path
media_result: demo_id kind state
demo_open: demo_id
demo_start: demo_id mode
demo_engaged: demo_id seconds
demo_end: demo_id ms reason
demo_action: demo_id action item value bucket ms
article_progress: percent
article_complete: read_s
video_progress: video_id percent
haunt_start: mode
haunt_end: ms reason
js_error: kind
hire_pdf: role_bucket`);
add('d', `
page_view: title_id
section_view: section_id ms
ui_click: track_id zone x y nth
ui_hover: track_id ms
input_change: field
rage_click: track_id n
dead_click: track_id
cursor_sample: cells
cursor_idle: ms
tap: x y track_id
text_select: track_id
copy: track_id
web_vital: metric value rating
consent_shown: region
consent_reopened: from
footer_click: track_id
form_view: form_id
form_field: form_id field
newsletter_view: page_path
newsletter_fab_shown: page_path
newsletter_fab_click: page_path
newsletter_start: page_path
newsletter_invalid: page_path
newsletter_failed: page_path
newsletter_confirmed: page_path
project_prev: project_id
project_next: project_id
project_preview: project_id
lightbox_open: image_id
lightbox_nav: image_id dir
lightbox_close: method
haunt_mode: mode
haunt_interrupted: input ms
haunt_stop_click: ms
intro_shown:
intro_completed: ms
intro_skipped: ms
cursor_enabled:
video_state: video_id state
model_state: demo_id state ms delegate
demo_error: demo_id code
tour_start:
tour_step: step
tour_exit: reason`);
const ga = Object.entries(E).filter(([, e]) => e.sinks.includes('g'));
const dims = [...new Set(ga.flatMap(([, e]) => e.params).filter(p => p !== 'page_path'))].concat(['page_type', 'entry_link', 'consent_state', 'device_class', 'is_owner', 'site_lang']);
const bad = dims.filter(d => ['source', 'medium', 'campaign', 'content', 'term'].includes(d));
if (bad.length || dims.length > 50) { console.error('FAIL', bad, dims.length); process.exit(1); }
fs.writeFileSync('tracking/catalogue.json', JSON.stringify({ version: 1, common: ['page_type', 'entry_link', 'consent_state', 'device_class', 'is_owner', 'site_lang'], key_events: ['form_submit_success', 'email_click', 'cv_download', 'newsletter_confirmed', 'hire_pdf'], ga4_dimensions: dims, events: E }, null, 1));
console.log('events', Object.keys(E).length, 'ga4', ga.length, 'dims', dims.length);
