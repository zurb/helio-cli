<!--
helio-cli landing page — content document

Audience: developers first, UX researchers and PMs second.
Primary CTA: `npm install -g @zurb/helio-cli` (used exactly 3 times: hero, quickstart, footer).
Binary on $PATH is still `helio-cli` — all other commands on this page use it unchanged.
Positioning: the fastest way to launch a UX test — idea to live, under a minute, from your terminal.
Voice: action-first, every claim backed by a one-liner, no marketing fluff.

Designer/developer notes are inline as HTML comments. Headline alternates are listed under each section as "ALT:" bullets so an editor can pick.
-->

# Ship a UX test before your coffee's done.

<!-- ALT headlines (editor's choice):
  - "UX research at the speed of `enter`."
  - "Run UX tests from your terminal."
  - "From idea to live UX test, in one command."
-->

Helio CLI puts the full Helio research platform behind a single command. Create a test, attach standardized UX metrics, send it to a real audience, and pull results — without leaving your terminal. Built for developers who automate, researchers who move fast, and teams who want their UX work to live in the same workflow as their code.

No new dashboard to learn. No new login to keep open. Same Helio platform you already trust — exposed as commands you can pipe, script, and version-control.

<!-- Hero layout: large headline, one-paragraph subhead, two CTAs side-by-side, terminal block below spanning full width -->

**`npm install -g @zurb/helio-cli`** &nbsp; &nbsp; [Read the quickstart →](#try-it-now)

```bash
$ helio-cli tests create \
    --project-id 1f2e... \
    --name "Checkout sentiment check" \
    --intro "Two quick questions about checkout." \
    --target-audience-size 50 \
    --ux-metrics sentiment loyalty

id      9c3b-...-4a21
name    Checkout sentiment check
status  draft

$ helio-cli tests send 9c3b-...-4a21

id      9c3b-...-4a21
status  live
```

---

## The 60-second story

You already installed it (above). Here's what the next 60 seconds look like.

<!-- Two numbered steps, each its own code block. Designed to read as "this is literally the whole demo." -->

**1. Authenticate once.**

```bash
helio-cli auth login
```

Paste your API ID and token from `my.helio.app/account/organization`. The CLI remembers you.

**2. Create and send a test, with UX metrics auto-generated.**

```bash
helio-cli tests create \
    --project-id <uuid> \
    --name "Homepage hero test" \
    --intro "Help us evaluate the new homepage." \
    --target-audience-size 50 \
    --ux-metrics sentiment appeal usefulness

helio-cli tests send <test-uuid>
```

That's the whole demo. Three commands, one live UX test, responses landing as participants complete.

---

## What it does

<!-- Three-column grid on desktop, single column on mobile. Each card: bold label, one-line command, short description. -->

**Create tests, all ten question types.**
```bash
helio-cli tests create --questions '[...]'
```
Free response, multiple choice, likert, NPS, ranking, preference, matrix, card sort, point allocation, and max-diff. Define your test in JSON, validate it with `--dry-run`, ship it when it's right.

**Auto-generate UX metrics.**
```bash
helio-cli tests create ... --ux-metrics sentiment loyalty usefulness
```
Eleven standardized metrics, attached to any test with a single flag. Customize the context, keep the wording consistent, benchmark across studies.

**Pull reports.**
```bash
helio-cli tests report <uuid> --include questions_summary,demographics,ux_metrics
```
Summary stats, full response data, demographics filters, and pagination. Output as text for humans or JSON for pipelines.

**Manage participants and custom lists.**
```bash
helio-cli custom-lists add-participants <list-uuid> --data '[...]'
```
Bulk-add participants via JSON, manage custom lists, target specific audiences for repeat studies and longitudinal work.

**Edit drafts before they go live.**
```bash
helio-cli tests add-question <uuid> --type likert --instructions "Checkout was easy." --scale-type agreement
```
Add, edit, remove, and reorder questions on any draft test. Preview the participant view before you spend an incentive.

**Run in CI.**
```bash
HELIO_API_ID=$ID HELIO_API_TOKEN=$TOKEN helio-cli tests list --output json
```
Environment-variable auth, structured JSON output, predictable exit codes, `--dry-run` validation, and a built-in `doctor` command to diagnose issues fast.

---

## UX metrics, generated for you

<!-- ALT headlines:
  - "Stop reinventing the question."
  - "The metric library, one flag away."
-->

Every test type Helio offers can include standardized UX metrics — sentiment, loyalty, usefulness, appeal, comprehension, expectations, and more. The CLI generates them for you, with consistent wording, so results are comparable across tests, products, and quarters.

A UX metric isn't just a question. It's a calibrated instrument with documented scales, baselines, and behavior across thousands of Helio studies. When you add `--ux-metrics sentiment loyalty` to a test, you're not writing a survey — you're plugging into a measurement system. That means a sentiment score from this week's release can be compared, honestly, to one from a year ago.

```bash
helio-cli tests create \
    --project-id <uuid> \
    --name "Onboarding pulse" \
    --intro "A quick check on first-run experience." \
    --target-audience-size 75 \
    --ux-metrics sentiment loyalty usefulness \
    --ux-metric-context "the Helio onboarding flow"
```

Use the metric, every time. Benchmark against yourself, across releases, without rewriting questions from scratch.

<!-- Optional sidebar listing available metrics in two columns -->
Available: `sentiment`, `feeling`, `appeal`, `reaction`, `comprehension`, `frequency`, `loyalty`, `intent`, `desirability`, `usefulness`, `expectations`.

---

## Built for automation

<!-- Four-bullet section. Each bullet: bold label, one-line claim, code block. -->

**JSON everywhere.** Add `--output json` to any command. Pipe the result into `jq`, your data warehouse, a notebook, or a script. Every command in the CLI honors the same flag, so your tooling only has to learn one contract.
```bash
helio-cli tests report <uuid> --output json | jq '.questions_summary'
```

**Environment-variable auth.** Drop into CI or a sandbox without touching a config file.
```bash
export HELIO_API_ID=...
export HELIO_API_TOKEN=...
helio-cli tests list --status running --output json
```

**Structured errors, predictable exit codes.** Errors come back as JSON when you ask for it.
```bash
{ "error": "Unauthorized", "code": 401 }
```

**`--dry-run` before you spend.** Validate a test payload without creating anything or charging incentives.
```bash
helio-cli tests create --dry-run --project-id <uuid> --name "Test" --intro "Hi" \
    --target-audience-size 50 --questions '[...]'
```

Wire it into GitHub Actions, internal tools, or your nightly cron. The CLI is built to be scripted, not just typed.

---

## Two ways in

<!-- Two columns on desktop, stacked on mobile. Equal weight. -->

**For developers.**
You already live in a terminal. Now your research does too. Schedule nightly pulls, gate releases on sentiment thresholds, version-control your test definitions next to the code they evaluate. Treat user feedback like every other production signal — observable, scriptable, and tied to a build.

```bash
# nightly: pull the latest report and post to Slack
helio-cli tests report $TEST_ID --output json \
    | jq '.ux_metrics' \
    | ./post-to-slack.sh
```

**For researchers and PMs.**
Save a test once, run it a hundred times. Re-run last quarter's onboarding study against a fresh audience — no clicking through screens, no re-typing instructions, no losing the wording you spent two weeks tuning. The test definition is a file you can share, edit in a PR, and replay forever.

```bash
# re-launch the onboarding study with a new audience
helio-cli tests create \
    --project-id $PROJECT \
    --name "Onboarding · Q3 wave" \
    --intro "$(cat onboarding-intro.txt)" \
    --target-audience-size 100 \
    --ux-metrics sentiment loyalty
```

Same platform you know. Faster surface to work on. The web app is still there when you want it; the CLI is there when you need to move.

---

## Try it now

1. **Install.**
   ```bash
   npm install -g @zurb/helio-cli
   ```

2. **Log in.**
   ```bash
   helio-cli auth login
   ```

3. **See what's there.**
   ```bash
   helio-cli projects list
   ```

4. **Launch your first test.**
   ```bash
   helio-cli tests create \
       --project-id <uuid> \
       --name "My first CLI test" \
       --intro "Quick feedback on a new idea." \
       --target-audience-size 50 \
       --ux-metrics sentiment
   ```

For a guided walkthrough and full command schemas: `helio-cli guide`.

For everything else: the [GitHub repo](#) and the [API reference](#).

<!-- Replace GitHub and API reference links at build time -->

---

## Helio CLI is open and ready.

```bash
npm install -g @zurb/helio-cli
```

[Docs](#) · [API reference](#) · [Support](#) · [Status](#)

<!-- Replace footer link hrefs at build time -->

<sub>Requires Node.js ≥ 22 and a Helio API token. Get yours at [my.helio.app/account/organization](https://my.helio.app/account/organization).</sub>
