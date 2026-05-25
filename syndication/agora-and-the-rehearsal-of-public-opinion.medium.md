<!--
Title: Agora, and Why I Built a Sandbox for Public Opinion
Subtitle: Marketing decisions are made on intuition and defended with data after the fact. A multi-agent simulation flips the order.
Suggested Tags (Medium): AI, Marketing, Simulation, Multi Agent Systems, Decision Making
Canonical URL: https://saikanagat.pages.dev/blog/agora-and-the-rehearsal-of-public-opinion.html
Suggested Feature Image: TBD (Agora simulation screenshot)
Pull Quote: "You don't argue about what people will think — you watch them think it."
-->

# Agora, and Why I Built a Sandbox for Public Opinion

**Most marketing decisions get made twice.** Once, in a meeting room, on instinct. Then again, three months later, with a deck full of metrics that the team uses to *justify* what was already chosen. The data was never an input. It was post-hoc rationalisation.

This bothered me long before I started working in marketing. As a designer, you are taught to test. You sketch ten options, you prototype the best three, you put them in front of users, you watch what happens, you cut what doesn't survive. The discipline is built around the assumption that you don't know the answer until reality tells you. Marketing rarely works this way. Most campaigns ship as if they were already correct.

Agora is the small piece of software I started building to fix this for myself. The premise is simple: before you ship a decision — a price change, a brand pivot, a campaign tagline, a controversial product announcement — what if you could see how a synthetic crowd reacts to it first? Not focus-group reaction. Not survey data. **Live, behavioural, agent-by-agent reaction**, with the dynamics of how influence actually moves through a population.

## What It Actually Is

Agora is a multi-agent simulation. You type in a scenario in plain English — "We're raising prices 22% to fund AI features" — and the engine generates a synthetic crowd of personas. Each persona has an occupation, a baseline stance, a vocality score, an openness score. They move around a 2D space, run into each other, post short messages above their heads, and shift opinions based on who they collide with.

The browser version on this site is the lite build. It uses template-driven messages and lightweight rules. The full build behind it uses real LLM-driven agents with persistent memory, GraphRAG-extracted personas pulled directly from the seed material, and a ReportAgent you can chat with after the simulation is done. But the principle is the same in both versions: *you don't argue about what people will think — you watch them think it.*

## Why This Matters for Marketing

Three reasons.

**One: it forces the question to be specific.** Vague briefs collapse the moment you try to simulate them. "Will customers like our rebrand?" doesn't run. "Will customers who have been with us 5+ years and pay €99/month tolerate a logo change that abandons our heritage typeface?" runs beautifully. The act of seeding the simulation forces you to articulate what you're actually asking.

**Two: it shows you the shape of the disagreement.** A pure poll tells you 60% support and 40% oppose. The simulation tells you that opposition is concentrated in long-time customers and the support comes mostly from people who don't actually pay. That's a different problem. That's the problem you needed to know.

**Three: it shows the dynamics, not the snapshot.** Most consumer reaction isn't static — it propagates. A vocal minority can move the median. A single high-influence persona can shift their entire neighbourhood. The simulation surfaces these inflection points the way no survey can, because surveys ask people in isolation, and people don't form opinions in isolation.

## What It Can't Do

Plenty. The crowd is synthetic — it's not your actual market, it's a stand-in built from demographic and psychographic templates. The opinion-dynamics rules are deliberately simple. The output is directional, not predictive. If you ship a campaign because Agora says "support 67%," you are misusing the tool. The point isn't the percentage. The point is the pattern of how the percentage is reached, and what shifts it.

I think of it the way a designer thinks of a foam mock-up. Nobody ships the foam. But you'd be a fool to skip it.

## The Deeper Bet

I think most consumer-facing decisions in 2026 should pass through some kind of synthetic-crowd rehearsal before they touch a real budget. Not because the simulation is correct — it isn't — but because the act of rehearsing forces a discipline of specificity, observation and iteration that marketing teams routinely skip. The same discipline that makes good design good.

Agora is small. The version on this site runs in your browser in 200 lines of JavaScript. You can try it now. Type any scenario you'd put real money behind. Watch the report. Then ask yourself: would your team have caught what the simulation caught?

---

*Originally published at [saikanagat.pages.dev/blog/agora-and-the-rehearsal-of-public-opinion](https://saikanagat.pages.dev/blog/agora-and-the-rehearsal-of-public-opinion.html).*
