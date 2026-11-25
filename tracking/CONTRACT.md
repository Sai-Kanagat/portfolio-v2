# Tracking contract (frozen, v1)
Change only through the orchestrator.

## Rules
- Never collect typed text, file names, emails, camera or mic data, landmarks, IPs, keystrokes. Values are ids, buckets, counts, ms.
- Never use parameter names source, medium, campaign, content, term.
- Use buckets: len_bucket 0|1-20|21-80|81-300|300+; count_bucket 0|1|2-5|6-20|21+.
- Tracking fails silently and never blocks, delays or alters the page. Demo hot loops must not call track per frame.
- No em or en dashes in copy or comments. No AI attribution in commits.

## Client API (js/track.js, window.sk)
sk.track(name, params)            catalogue event
sk.demo(demo_id, action, params)  sends demo_action {demo_id, action, value?, ms?, bucket?, item?}
sk.media(demo_id, kind, state, params)  kind camera|mic; state prompt|granted|denied|dismissed|unavailable|failed|stopped
sk.model(demo_id, state, {ms, delegate})  state loaded|failed
sk.form(form_id, state, {field?})  state view|start|field|error|attempt|success|failure|abandon
sk.len(text) / sk.count(n)        bucket helpers; return the bucket string only
sk.haunt(on)                      sets the ghost flag; behavioural collectors ignore everything while on
sk.consent                        'granted' | 'denied' | 'pending'
window.skTrack(name, params)      legacy alias
Calls before track.js loads are safe: each page may use (window.skq=window.skq||[]).push([fn,...args]).
Demo code uses: function T(){try{window.sk&&sk.demo.apply(sk,arguments)}catch(e){}}

## Consent
js/consent.js owns state in localStorage sk_consent_v2 ('granted'|'denied'). Region comes from
<html data-cr="eea|other"> injected by functions/_middleware.js; fallback timezone test, unknown counts as eea.
eea: nothing to D1 or Clarity until granted. other: granted by default, notice shown with opt-out.
Dispatches window event 'sk:consent' {detail:{state}}. Any element with [data-consent-open] reopens the choice.
Declined: no visitor id, no session id, no /api/e calls, no Clarity. Global Privacy Control counts as declined.

## Wire format: POST /api/e, JSON, max 32 KB, sendBeacon or fetch keepalive
{v:1, vid, sid, pid, ctx:{path,page_type,lang,device,vw,vh,ref_host,link,utm:{...},owner,test}, ev:[{n,t,p}]}
vid, sid, pid: 16 lowercase hex. t: ms since epoch. 204 on success, 400 invalid, 403 origin, 413 size, 429 rate.
URLs: path only. Query allowlist utm_source utm_medium utm_campaign utm_content sk_l lang haunt. Hash is never sent.

## Elements
data-track="zone.name" stable id. data-zone on containers. Missing id falls back to zone.tag.slug(label).
[data-no-track] subtree is ignored (the ghost). Owner flag: ?sk_owner=1 sets localStorage sk_owner.
Test flag: ?sk_test=<id> sets sessionStorage sk_test.

## D1
events(id,ts,vid,sid,pid,name,path,page_type,device,lang,country,link,owner,test,params)
sessions(sid,vid,first_ts,last_ts,landing,ref_host,utm_source,utm_medium,utm_campaign,link,country,device,owner,test,pages,events,active_ms)
links(slug,dest,channel,campaign,content_label,app_label,created,retired)
link_clicks(id,ts,slug,country,device,is_bot)
cursor_bins(day,path,device,kind,x,y,n,test)
daily_rollup(day,name,key,n,visitors)

## Routing
catalogue.json: each event has sinks. g = GA4 through dataLayer, d = D1, c = Clarity tag.
