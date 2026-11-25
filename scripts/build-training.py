"""Builds docs/Canvass-Training.pptx from the v2 screenshots.  Run:  python3 scripts/build-training.py"""
from pathlib import Path
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor

ROOT = Path(__file__).resolve().parent.parent
SHOTS = ROOT / 'docs' / 'screenshots' / 'v2'
BLUE, INK, MUTED = RGBColor(0x2E, 0x55, 0xE6), RGBColor(0x12, 0x15, 0x1B), RGBColor(0x68, 0x71, 0x7E)
prs = Presentation(); prs.slide_width, prs.slide_height = Inches(13.333), Inches(7.5)
blank = prs.slide_layouts[6]

def text(slide, x, y, w, h, lines, size=18, color=INK, bold=False):
    tb = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h)); tf = tb.text_frame; tf.word_wrap = True
    for i, line in enumerate(lines):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        r = p.add_run(); r.text = line; r.font.size = Pt(size); r.font.color.rgb = color; r.font.bold = bold; p.space_after = Pt(8)
    return tb

def slide(title, bullets, shot=None):
    s = prs.slides.add_slide(blank)
    text(s, 0.6, 0.4, 12, 0.9, [title], 32, INK, True)
    if shot:
        text(s, 0.6, 1.4, 4.4, 5.6, ['• ' + b for b in bullets], 17, INK)
        s.shapes.add_picture(str(SHOTS / shot), Inches(5.2), Inches(1.4), width=Inches(7.6))
    else:
        text(s, 0.6, 1.5, 12, 5.5, ['• ' + b for b in bullets], 20, INK)
    return s

s = prs.slides.add_slide(blank)
text(s, 0.8, 2.2, 11, 1.2, ['canvass.'], 60, BLUE, True)
text(s, 0.8, 3.5, 11, 1.5, ['Team training: Pitch HQ + Lead Finder in one app', 'Version 2.0'], 24, MUTED)

slide('One app, one login', ['Pitch HQ: Overview, Pipeline, Businesses, Team, Reports, Accounts', 'Lead Finder: finds and checks businesses for you', 'Qualified leads land in the Pipeline under Spotted', 'Ctrl+K searches everything'], 'overview.png')
slide('The Lead Finder menu', ['Click Lead Finder: its menu opens underneath', 'Click the arrow to fold it away', 'On phones: the Finder tab, with buttons at the top', 'A progress chip follows you while a search runs'], 'lf-dashboard.png')
slide('Find on Google', ['Pick industry, city, area and how many leads you want', 'The box shows how many Google requests it can use', 'Every business is checked as it’s found', 'Stop any time. Nothing checked is lost'], 'lf-find.png')
slide('Upload a list or add one business', ['Bulk upload: Excel, CSV, or paste names, websites or Maps links', 'Quick add: paste one Google Maps listing', '“Save & check fully” runs every Lead Finder check too'], 'lf-quickadd.png')
slide('Read the results', ['Qualified: passed every check, something real to help with', 'Unverified: add evidence, e.g. the licence date', 'Rejected and No opportunity show the exact reason', 'The ring is the lead score out of 100'], 'lf-results.png')
slide('The business report', ['Contact details, age, activity and Google rating, each with its source', 'Confirmed issues first, then possible improvements', 'Services to pitch, and why'], 'lf-report.png')
slide('Pitch it, honestly', ['Five drafts: email, WhatsApp, call, proposal, audit offer', 'Read before sending. Canvass never sends anything', '“I sent this” moves the pipeline card to Pitched', 'Respect “Do not contact”'], 'lf-pitch.png')
slide('Then work the pipeline', ['Claim a Spotted card, add helpers, log calls and meetings', 'The radar mark means it came from Lead Finder', '“Full report” opens its findings and pitches'], 'pipeline.png')
slide('House rules', ['Never invent data. “Not Available” is fine', 'Keep free-tier protection on (900 a month, 50 a day)', 'Keys and passwords go only into Canvass Settings', 'Google content is removed after 30 days automatically', 'Demo data is fictional and never reaches the pipeline'])
prs.save(ROOT / 'docs' / 'Canvass-Training.pptx'); print('saved')
