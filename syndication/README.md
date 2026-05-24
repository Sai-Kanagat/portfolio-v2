# Syndication: Medium + Substack Drafts

Ready-to-paste Markdown for republishing the 9 blog posts from `saikanagat.pages.dev/blog/` on Medium and Substack. 18 files total, two per post (`.medium.md` and `.substack.md`).

## The canonical-tag strategy (3 sentences)

The original posts on `saikanagat.pages.dev/blog/` already have `rel="canonical"` set to themselves, which means Google treats them as the source of truth. When you republish to Medium or Substack, you tell those platforms to point their canonical tag back at your portfolio URL — this lets Google credit the **original** with all the ranking authority while still letting Medium/Substack readers find and read the piece. End result: you stack up your name across Google's first page (portfolio + Medium + Substack + LinkedIn) without any duplicate-content penalty, because Google sees one canonical and four pointers.

## Step-by-step: how to publish

### Medium

1. **Set up your author profile.** Go to `medium.com/@saikanagat` (claim the handle if you haven't). Add: headshot, one-line bio ("Industrial designer turned marketer. Bologna Business School. Building Nishta."), link to `saikanagat.pages.dev`, location set to Bologna.
2. **Use the Story Import tool** (preferred): `medium.com/p/import` → paste the original blog URL (e.g. `https://saikanagat.pages.dev/blog/building-nishta.html`). Medium auto-pulls content AND auto-sets the canonical tag back to the source. This is the cleanest path.
3. **OR paste-and-set-canonical manually:**
   - New Story → paste the body of the `.medium.md` file (strip the HTML comment metadata block at the top before pasting).
   - Add the title and subtitle from the metadata block.
   - Three dots menu (top right) → **More Settings** → scroll to **"Customize SEO settings"** → paste the canonical URL into the **"Canonical URL"** field. This is the critical step — without it, Google sees Medium as a duplicate.
   - Add 3–5 tags from the metadata block.
   - Add a feature image (use the suggested path from metadata, or a unsplash placeholder if TBD).
4. **Publish.** Then submit to a relevant publication if one fits (e.g. Better Marketing, UX Collective).

### Substack

1. **Set up your newsletter.** Go to `substack.com` → New Publication. Use the URL `saikanagat.substack.com`. Name it something like "Sai Kanagat — Notes" or "The Joint" (design + marketing). One-line description, headshot, link back to portfolio.
2. **New Post → paste the body** of the `.substack.md` file (again, strip the HTML comment metadata block before pasting; use the title/subtitle from the metadata).
3. **Set the canonical URL:** Post settings (gear icon) → **"SEO"** section → **"Canonical URL"** field → paste the original portfolio URL. Same logic as Medium.
4. Add 2–3 tags. Schedule or send.

### LinkedIn (see below)

Take only 3 posts to LinkedIn — Articles, not posts — with a "Originally published at..." link back in the first line.

## Recommended publishing cadence

**Don't dump all 9 in one week.** Google's spam filter and Medium's promotion engine both punish bursts. Stack them over 2 months:

- **1 post per week**, alternating Medium and Substack so the same piece doesn't go live on both platforms on the same day.
- **Publish oldest first** (use the original `datePublished` dates from the HTML — Feb 2026 → May 2026). This builds a natural-looking publication arc rather than a backdated dump.

Suggested schedule (start the Monday after you set up profiles):

| Week | Platform | Post |
|------|----------|------|
| 1 | Medium | the-brief-as-a-design-object |
| 1 | Substack | portfolios-are-products |
| 2 | Medium | portfolios-are-products |
| 2 | Substack | the-brief-as-a-design-object |
| 3 | Medium | why-italy-and-why-now |
| 3 | Substack | what-15k-meta-ads-taught-me |
| 4 | Medium | what-15k-meta-ads-taught-me |
| 4 | Substack | why-italy-and-why-now |
| 5 | Medium | why-industrial-designers-make-better-marketers |
| 5 | Substack | agora-and-the-rehearsal-of-public-opinion |
| 6 | Medium | agora-and-the-rehearsal-of-public-opinion |
| 6 | Substack | why-industrial-designers-make-better-marketers |
| 7 | Medium | carlos-mota-studio-lesson |
| 7 | Substack | building-nishta |
| 8 | Medium | building-nishta |
| 8 | Substack | carlos-mota-studio-lesson |
| 9 | Medium | bologna-business-school-marketing-reality |
| 9 | Substack | bologna-business-school-marketing-reality |

By week 9, all 18 syndications are live. Google has indexed them as a gradual stream, not a spam burst.

## LinkedIn: 3 strongest for the Italy job-hunt angle

LinkedIn Articles (not posts — Articles get indexed by Google and stay on your profile permanently). Pick these three because each one signals a different hireable strength to an Italian recruiter:

1. **`why-italy-and-why-now`** — the explicit "I want a job here, here's why" piece. This is the one Italian hiring managers will share internally. Make this your first Article.
2. **`what-15k-meta-ads-taught-me`** — concrete numbers (€15K, 3.2× ROAS) prove you're operational, not just theoretical. Italian recruiters are skeptical of CVs full of strategy talk with no execution. This piece is your evidence.
3. **`carlos-mota-studio-lesson`** — international pedigree (Carlos Mota, Architectural Digest, NYC) elevates you above the local candidate pool without sounding boastful. The Verde Collection story does the bragging for you.

For each LinkedIn Article:
- Title and body identical to the Medium version.
- **First line** must be: *"Originally published at [saikanagat.pages.dev/blog/...](URL). Republished here with canonical link back."*
- Add a cover image and 3 hashtags (#Marketing #ItaliaJobs #BrandStrategy or similar).
- Publish them 2 weeks apart — week 2, week 5, week 8 of the cadence above — so they coincide with your Medium/Substack momentum.

## Quick reference: file naming

```
syndication/
  <slug>.medium.md
  <slug>.substack.md
  README.md  (this file)
```

The HTML comment block at the top of each file is metadata — **strip it before pasting** into Medium/Substack editors. Copy the title, subtitle, tags, canonical URL, and feature image suggestion from that block into the respective fields in the platform UI.
