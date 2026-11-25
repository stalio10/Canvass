## Canvass 2.0: Pitch HQ + Lead Finder in one app

**One login, one pipeline, one place for the whole team.**

### Try it on your computer

1. Download **Canvass-Local.zip** below and unzip it.
2. Windows: double-click **Start Canvass.bat** (PHP is included). Mac: `brew install php`, then **Start Canvass (Mac).command**.
3. Sign in with **MSB / admin** and change the password in *My space*.
4. **Lead Finder → Settings:** add your Google Places API key.

This test copy keeps its data in its own `data` folder. It does not touch the live Pitch HQ site.

### What's new

- **Lead Finder lives inside Canvass.** Click *Lead Finder* in the sidebar and its own menu opens underneath (Dashboard, Find on Google, Bulk upload, Quick add, Results, Reports & backup, Settings). Fold it away with the arrow. On phones it's the **Finder** tab.
- **Qualified leads join the pipeline** under *Spotted*, unclaimed, with the findings in the notes. A radar mark shows cards from Lead Finder, and **Full report** opens the findings, pitches and sources.
- **Quick add** (the old Pitch HQ finder) is now part of Lead Finder, with a new **Save & check fully** button that runs every Lead Finder check on it.
- **"I sent this"** on a pitch moves the pipeline card to *Pitched*, with the 14-day repeat warning and do-not-contact kept.
- **Accounts now saves to the server**, behind its own accounts password. Bill reminders show on the Overview without amounts.
- **Runs on Hostinger shared hosting.** Lead Finder was rebuilt in PHP 8.2. Searches run in small steps from a cron job, so they never time out.
- **Your v1.0 data comes with you.** Restore a backup from the Windows app; its pipeline leads join the Canvass pipeline at the matching stage.
- **Free-tier protection** defaults to 900 Google requests a month and 50 a day, counted before anything is sent.
- **Same rules, same results.** On the demo set, the PHP engine gives exactly the same categories, scores, issues and services as v1.0. Demo data never enters the pipeline.

### Not included yet

- Going live on Hostinger (needs the Hostinger account that hosts mhdshibili.com connected).
- Automatic sending of emails or WhatsApp messages (pitches are copied and sent by you).
