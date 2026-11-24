'use strict';
// Personalized pitches from verified findings only. No invented statistics, no guarantees.

const BENEFITS = {
  website: 'make it easier for visitors to trust you and send an enquiry, especially from their phones',
  search: 'help more nearby customers find you on Google Search and Google Maps',
  creative: 'present your work and products more clearly and consistently',
  marketing: 'reach new customers with campaigns you can measure',
  other: 'support your growth online'
};

function pickFindings(c, n = 4) {
  const issues = c.issues || [];
  return [...issues.filter(i => i.status === 'Confirmed Issue'), ...issues.filter(i => i.status !== 'Confirmed Issue')].slice(0, n);
}

function generatePitches(c, settings) {
  if (c.validation?.category !== 'Qualified') return null;
  const co = settings.company;
  const name = c.name, industry = c.industryName || c.industry || 'your industry';
  const findings = pickFindings(c);
  if (!findings.length) return null;
  const services = (c.services || []).slice(0, 4);
  const groups = [...new Set(services.map(s => s.group))];
  const benefits = groups.map(g => BENEFITS[g] || BENEFITS.other);
  const date = (c.lastVerifiedAt || new Date().toISOString()).slice(0, 10);
  const site = c.contact?.website ? c.website?.domain || c.contact.website : '';
  const findingLines = findings.map(f => `• ${f.title}${f.detail ? ' — ' + f.detail : ''}${f.status === 'Potential Improvement' ? ' (opportunity to review)' : ''}`);
  const serviceNames = services.map(s => s.name);
  const signature = [co.sender || co.name, co.name, co.phone, co.email, co.website].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join('\n');
  const intro = `I'm reaching out from ${co.name}, a website development, branding and digital marketing company.`;
  const scopeNote = `These observations come from a review of publicly available information on ${date}. Some items are opportunities to discuss rather than confirmed problems.`;

  const email = `Subject: A few digital improvements for ${name}

Hello ${name} team,

${intro} While looking at ${industry.toLowerCase()} businesses${c.city ? ' in ' + c.city : ''}, we reviewed ${site ? 'your website (' + site + ') and ' : ''}your online presence and noticed:

${findingLines.join('\n')}

${serviceNames.length ? `We help businesses like yours with ${serviceNames.join(', ')}. ` : ''}Addressing these could ${benefits.join(', and ')}.

${scopeNote}

Would you be open to a 15-minute call this week? We can walk you through the findings at no cost.

Best regards,
${signature}

If you'd prefer not to hear from us, reply "unsubscribe" and we won't contact you again.`;

  const whatsapp = `Hello ${name} 👋 This is ${co.sender || co.name} from ${co.name}. We reviewed your online presence on ${date} and noticed ${findings.slice(0, 2).map(f => f.title.toLowerCase()).join(' and ')}. ${serviceNames.length ? `We help with ${serviceNames.slice(0, 2).join(' and ')}. ` : ''}Could we share a short free summary of what we found? Reply STOP if you'd rather not hear from us.`;

  const call = `CALL SCRIPT — ${name}
1. Introduction: "Hello, this is ${co.sender || '[your name]'} from ${co.name}. Is this a good time for two minutes?"
2. Reason for calling: "We help ${industry.toLowerCase()} businesses${c.city ? ' in ' + c.city : ''} with their websites and online presence. We looked at yours and noted a few things."
3. Findings (mention one or two):
${findings.slice(0, 3).map(f => '   - ' + f.title + (f.detail ? ': ' + f.detail : '')).join('\n')}
4. Question: "Is improving ${groups.includes('search') ? 'how customers find you online' : 'your website enquiries'} something you're working on at the moment?"
5. Offer: "We can send a free written audit and discuss ${serviceNames.slice(0, 2).join(' or ') || 'next steps'}."
6. Close: "Would ${'a short call later this week'} work? What's the best email to send the audit to?"
Note: These are observations from public information, not guarantees of results. Respect a "no" and record it.`;

  const proposal = `BUSINESS PROPOSAL (DRAFT) — ${name}
Prepared by ${co.name} · ${date}

1. About ${name}
${industry}${c.city ? ', ' + c.city : ''}${c.country ? ', ' + c.country : ''}${site ? ' · ' + site : ''}

2. What we found
${findingLines.join('\n')}

3. Recommended services
${services.map(s => `• ${s.name} — addresses: ${s.reasons.join('; ')}`).join('\n') || '• To be agreed after discovery call'}

4. Expected benefits
${benefits.map(b => '• ' + b[0].toUpperCase() + b.slice(1)).join('\n')}

5. Next steps
• Discovery call to confirm goals and priorities
• Written scope, timeline and pricing (to be agreed after discovery)

Results depend on many factors; no rankings, traffic or revenue outcomes are guaranteed.
${scopeNote}`;

  const auditOffer = `Subject: Free digital audit for ${name}

Hello ${name} team,

${co.name} is offering a complimentary digital audit to selected ${industry.toLowerCase()} businesses${c.city ? ' in ' + c.city : ''}. Our first look already found ${findings.length} item(s) worth reviewing, including ${findings[0].title.toLowerCase()}.

The full audit covers your website, Google Business Profile, customer reviews and local search presence, with a short list of practical priorities. There is no cost or obligation.

Would you like us to prepare it? Just reply to this email.

Best regards,
${signature}

Reply "unsubscribe" to stop further messages.`;

  return { email, whatsapp, call, proposal, auditOffer, generatedAt: new Date().toISOString(), basedOn: findings.map(f => f.id) };
}

module.exports = { generatePitches };
