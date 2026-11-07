import re,glob,html,collections
from html.parser import HTMLParser
class P(HTMLParser):
    def __init__(s):
        super().__init__(convert_charrefs=True); s.t=[]; s.skip=0
    def handle_starttag(s,t,a):
        if t in('script','style','noscript'): s.skip+=1
        for k,v in a:
            if k in('alt','title','content','aria-label','placeholder') and v: s.t.append(v)
    def handle_endtag(s,t):
        if t in('script','style','noscript'): s.skip=max(0,s.skip-1)
    def handle_data(s,d):
        if not s.skip: s.t.append(d)
rows=[]
for f in glob.glob('**/*.html',recursive=True):
    if 'node_modules' in f: continue
    p=P(); p.feed(open(f,errors='ignore').read()); x='\n'.join(p.t)
    x2=re.sub(r'width=device-width[^\n]*','',x)
    rows.append((x2.count('—'),x2.count('–'),x2.count(';'),f))
bad=[r for r in rows if r[0] or r[2]]
for r in bad: print('FAIL',r[3],'em dashes',r[0],'semicolons',r[2])
print('pages',len(rows),'failing',len(bad))
raise SystemExit(1 if bad else 0)
