# How version.cam talks

Written 2026-11-07, after Peter read the onboarding texts and said they
sounded strange: "Nothing is sold. Team is told. Can we speak more
normally?" This page is the rule for every sentence a user reads: the
website, the app, the mails, the CLI's messages, the skill, the READMEs,
and the posts we publish. Code comments keep the repository's own rule
(say why).

## The rule

Write the way you would explain it to a colleague sitting next to you.
Read the sentence out loud. If you would not say it, rewrite it. In
Peter's words (2026-11-07): "Readable, simple, accurate, no embellishments,
like one colleague to another. But don't dumb it down: still accurate and
true." Plain is not simple-minded. A developer is reading; say the real
thing, in words that need no second reading.

1. **Say who does what.** "We email your team when a clip breaks." "You
   can't buy a plan yet." "CI records the clip on every push." Don't hide
   the actor behind a passive: not "the team is told", not "nothing is
   sold", not "no card is asked for".
2. **Normal word order.** Subject, verb, object. No inversions, no
   fragments used as punchlines, no sentence built as a chain of colons.
3. **Use "you" and "we".** Contractions are fine. We are a small company
   talking to developers, not a manual.
4. **Plain words.** Host, keep, send, check, show, use. A "living address"
   is a permanent link that stays up to date. "The door" is sign in.
   Don't praise the product with adjectives like true, honest or living.
5. **One idea per sentence.** Short is good; clipped is not. A sentence
   may contain an "and".
6. **Keep every fact.** Commands, numbers, limits, names and dates stay
   exactly as they are. Plain never means vague, and we never promise more
   than the code does.
7. **No filler and no AI tells.** Not seamless, robust, powerful,
   effortless, leverage, empower, delve, simply, "whether you're X or Y",
   three adjectives in a row, or a run of rhetorical questions.
8. **Headings and buttons are labels.** "Pricing", "Sign in", "What
   happens when you change the app".
9. **Errors and refusals** say what happened, why, and what to do next, in
   that order, in one or two sentences.
10. **Legal pages** keep their precise wording. Change a sentence there only
    when it is hard to understand, and keep the one-writer checks green.
11. The long-dash rule stays: no em or en dashes in anything we publish.

## Before and after

All of these are live today (2026-11-07).

| Where | Today | Plainly |
|---|---|---|
| Front page | version.cam, where the recordings go after CI, is in a private beta: the first ten accounts that ask have Pro free until it ends. | version.cam hosts the recordings after CI has made them. It is in private beta, and the first ten people who ask get Pro for free until the beta ends. |
| Front page | nothing is sold yet, and no card is asked for | You can't buy a plan yet, and we don't ask for a card. |
| Front page | Told by email, Slack or an issue when a clip breaks. | We email you, post to Slack or open a GitHub issue when a clip breaks. |
| Front page | One address that only plays what passed | A permanent link that only plays versions that passed their check |
| Front page | It renders nothing: a video of the wreckage would help nobody. | It doesn't render a video of the failure. The picture of the page is more useful. |
| Front page | Per project, never per seat. | Priced per project, not per seat. |
| Front page | Planned means the final prices follow the first bill | The prices are marked "planned" because we will confirm them after the first invoices. |
| Sign-in page | version.cam signs you in with GitHub. You see the project of each repository GitHub lets you read where the Versioncam App is installed, and every project of your own account; you change those you administer. | Sign in with GitHub. You will see the projects of the repositories you can read, where the Versioncam App is installed, and every project under your own account. You can change the settings of the ones you administer. |
| Upgrade page | version.cam is in a private beta: nothing is sold yet, and no card is asked for. The first ten accounts that ask have Pro free until the beta ends | version.cam is in private beta, so you can't buy a plan yet and we don't ask for a card. The first ten people who ask get Pro for free until the beta ends. |
| CLI, `inspect` | app: started with "npm run dev", HTTP 200 after 0.4 s; it stops when this command does | app: started with "npm run dev", answered after 0.4 s. It will be stopped when this command finishes. |
| Publish refusal | This account has 1 project of private repositories, and the Free plan is for public ones: a private repository's clips are stored on Pro, and its checks still run | Your Free plan covers public repositories only, so the clips from this private repository were checked but not stored. Pro stores them: |

## How to check a page

Give the sentence to someone who has never seen the product. If they ask
"what does that mean?", rewrite it. A fresh agent reading the page as a
stranger, with this file and nothing else, is a fair stand-in: it lists
every sentence it had to read twice.
