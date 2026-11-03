"""Turn the syntax guide's highlighted listings into test/fixtures/syntax-guide.json.

    curl -sSL -o guide.html https://xit.jotaen.net/syntax-guide
    python3 -I scripts/guide_fixture.py guide.html > test/fixtures/syntax-guide.json
"""
import json, sys
from html.parser import HTMLParser

STATUSES = {'open', 'checked', 'ongoing', 'obsolete', 'in-question'}

class P(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.listings = []; self.section = None; self.annotation = ''
        self.in_h2 = self.in_annot = False
        self.depth = 0; self.listing_depth = None; self.stack = []
        self.cur = None  # current line: list of (text, classes)
    def handle_starttag(self, tag, attrs):
        cls = dict(attrs).get('class', '') or ''
        if tag == 'h2': self.in_h2 = True; self.section = ''
        if tag == 'div' and 'annotation' in cls.split(): self.in_annot = True; self.annotation = ''
        if tag == 'div':
            self.depth += 1
            if 'listing' in cls.split():
                self.listing_depth = self.depth; self.lines = []; self.cur = []
        if tag == 'span' and self.listing_depth: self.stack.append(cls)
        if tag == 'br' and self.listing_depth is not None:
            self.lines.append(self.cur); self.cur = []
    def handle_endtag(self, tag):
        if tag == 'h2': self.in_h2 = False
        if tag == 'span' and self.listing_depth and self.stack: self.stack.pop()
        if tag == 'div':
            if self.in_annot and self.listing_depth is None: self.in_annot = False
            if self.listing_depth == self.depth:
                self.listings.append((self.section, ' '.join(self.annotation.split()), self.lines))
                self.listing_depth = None
            self.depth -= 1
    def handle_data(self, data):
        if self.in_h2: self.section += data
        elif self.listing_depth is not None:
            # Whitespace between tags in the listing's HTML source isn't content.
            if not self.stack and data.strip() == '': return
            self.cur.append((data, list(self.stack)))
        elif self.in_annot: self.annotation += data

def summarise(line):
    text = ''.join(t for t, _ in line)
    outer = line[0][1][0] if line and line[0][1] else ''
    inner = lambda kind: [t for t, c in line if kind in c[1:]]
    joined = lambda kind: ''.join(inner(kind))
    if not line or outer in ('indent', ''):
        return {'kind': 'blank'}, text
    if outer == 'invalid': return {'kind': 'invalid'}, text
    if outer == 'headline': return {'kind': 'title', 'text': text}, text
    assert outer in STATUSES, outer
    # Group consecutive runs of highlighted text into spans, with where each
    # starts in the line (in UTF-16 code units, as JavaScript counts).
    spans = []
    tokens = {'tag': [], 'due': []}
    prev = None; offset = 0
    for t, c in line:
        k = next((k for k in ('checkbox', 'priority', 'tag', 'due') if k in c), None)
        if k and k == prev: spans[-1][1] += t
        elif k: spans.append([k, t, offset])
        if k in tokens:
            if k == prev: tokens[k][-1] += t
            else: tokens[k].append(t)
        prev = k; offset += len(t.encode('utf-16-le')) // 2
    has_box = bool(inner('checkbox'))
    rest = ''.join(t for t, c in line if 'checkbox' not in c and 'priority' not in c)
    entry = {'kind': 'item' if has_box else 'continuation', 'status': outer}
    if has_box:
        pr = joined('priority')
        entry['priority'] = pr.count('!') if pr else 0
        # Drop the one-space separator before the description (and after a priority).
        desc = rest[1:] if rest.startswith(' ') else rest
        if pr: desc = desc[1:] if desc.startswith(' ') else desc
        entry['text'] = desc
    else:
        entry['text'] = rest[4:]
    entry['tags'] = tokens['tag']; entry['due'] = tokens['due']; entry['spans'] = spans
    return entry, text

p = P(); p.feed(open(sys.argv[1], encoding='utf-8').read())
out = []
for section, annotation, lines in p.listings:
    summaries = [summarise(l) for l in lines]
    out.append({'section': section.strip(), 'annotation': annotation,
                'source': '\n'.join(t for _, t in summaries) + '\n',
                'lines': [s for s, _ in summaries]})
json.dump({
    'source': 'https://xit.jotaen.net/syntax-guide',
    'retrieved': '2026-11-03',
    'note': "Generated from the guide's highlighted HTML (one listing per document). Do not edit by hand; deviations are listed in test/syntax-guide.test.ts.",
    'listings': out,
}, sys.stdout, ensure_ascii=False, indent=1)
