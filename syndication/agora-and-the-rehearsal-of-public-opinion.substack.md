<!--
Title: A Sandbox for Public Opinion
Subtitle: Why I built Agora — a multi-agent simulation that rehearses marketing decisions before they ship.
Suggested Tags (Substack): AI, Marketing, Tools
Canonical URL: https://saikanagat.pages.dev/blog/agora-and-the-rehearsal-of-public-opinion.html
Suggested Feature Image: TBD
-->

# A Sandbox for Public Opinion

Most marketing decisions get made twice. Once, in a meeting room, on instinct. Then again, three months later, with a deck of metrics used to *justify* what was already chosen. The data was never an input. It was post-hoc rationalisation.

This bothered me long before I started working in marketing. As a designer, you sketch ten, prototype three, put them in front of users, cut what doesn't survive. Marketing rarely works this way. Most campaigns ship as if they were already correct.

Agora is the small piece of software I started building to fix this for myself.

## What it actually is

A multi-agent simulation. Type in a scenario in plain English — "We're raising prices 22% to fund AI features" — and the engine generates a synthetic crowd of personas. Each has an occupation, baseline stance, vocality, openness. They move around a 2D space, post short messages, shift opinions based on who they collide with.

The browser version is the lite build. The full build uses LLM-driven agents with persistent memory, GraphRAG-extracted personas, and a ReportAgent you can chat with after. Same principle: *you don't argue about what people will think — you watch them think it.*

## Why this matters for marketing

**It forces the question to be specific.** Vague briefs collapse the moment you simulate them.

**It shows the shape of disagreement.** A poll says 60/40. The simulation says opposition is concentrated in long-time customers and support comes from people who don't actually pay. Different problem.

**It shows dynamics, not snapshots.** A vocal minority can move the median. Surveys ask people in isolation. People don't form opinions in isolation.

## What it can't do

The crowd is synthetic. The output is directional, not predictive. If you ship because Agora says "support 67%," you're misusing it. The point isn't the percentage — it's the pattern of how it's reached.

I think of it the way a designer thinks of a foam mock-up. Nobody ships the foam. But you'd be a fool to skip it.

## The deeper bet

Most consumer-facing decisions in 2026 should pass through some kind of synthetic-crowd rehearsal before they touch a real budget. Not because the simulation is correct, but because rehearsing forces specificity, observation and iteration that marketing teams routinely skip.

---

*Originally published at [saikanagat.pages.dev/blog/agora-and-the-rehearsal-of-public-opinion](https://saikanagat.pages.dev/blog/agora-and-the-rehearsal-of-public-opinion.html). Try the live demo there.*

**P.S.** — Subscribe for more weird experiments at the intersection of AI and marketing. If you've used synthetic-crowd tools and have thoughts, reply — I want to hear what worked and what didn't.
