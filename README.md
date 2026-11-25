# Kandi v1

A mobile-first dating app for ravers. Installable as a Progressive Web App (Add to Home Screen on iPhone or Android). This is a working v1 with real accounts, a discover feed, likes and comments on a photo or prompt, mutual matches, realtime chat, events, at-the-show mode, and report/block. Payments are **stubbed** — nothing is charged.

## What’s included

- Sign up and login, with an 18+ age gate
- Profiles: name, vibes, looking-for, prompt answers, photo upload
- Discover feed of real users (seeded with clearly fake demo ravers)
- Like or comment on a specific photo or prompt (Hinge-style)
- Daily free-like limit (8). Kandi+ / VIP unlocks unlimited likes
- Likes You is gated behind Kandi+
- Mutual matches and realtime chat (WebSocket at `/ws`)
- Events with “I’m going,” plus At the show live mode and a meetup-spot picker
- Report and block
- Safety: in-app meetup note with a friend (demo only — no real GPS or SMS)
- Kandi+ and Kandi VIP checkout is a **stub**. It flips a flag in the database and is clearly labeled “no real charges.” **TODO:** Stripe Checkout (web) or Apple / Google in-app purchase (native apps) before any public launch

## Requirements

- Node.js 22 or later (local dev uses the built-in `node:sqlite` module)
- That’s it for local development. Data lives in `data/kandi.sqlite`. Uploaded photos are also stored in the database so they survive hosts without a persistent disk.

## Run locally

```bash
cd kandi-app
npm install
npm run seed
npm start
```

Open [http://localhost:8787](http://localhost:8787). On a phone on the same network, use `http://YOUR_LAN_IP:8787`.

To re-seed demo data without wiping real signups, run `npm run seed` again. Demo accounts are upserted; other users are left alone.

Environment (optional):

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8787` | HTTP port |
| `HOST` | `0.0.0.0` | Bind address |
| `KANDI_SECRET` | a dev placeholder | Change this before any public deploy |
| `KANDI_SECURE_COOKIE` | unset | Set to `1` to always mark the session cookie `Secure`. Auto-enabled when the request is HTTPS (`X-Forwarded-Proto`) |
| `DATABASE_URL` | unset | Postgres connection string (Neon). When set, the app uses Postgres instead of SQLite. |
| `SEED_ON_BOOT` | `1` | Seed demo ravers if the database has no users |

## Demo logins (example profiles)

All of these are clearly fake demo ravers with gradient/emoji placeholder photos, not real people. Password for every demo account: **`plur-demo`**

Usernames: `nova`, `hex`, `luna`, `riot`, `vesper`, `sol`, `ember`, `pixel`, `jade`, `orion`

Suggested flow: log in as **vesper** and like **Nova** (Nova already liked Vesper, so you’ll match and can chat). Or create a new account — two demo ravers will like you so Likes You isn’t empty after you upgrade.

## Install on a phone (PWA)

1. Open the site in Safari (iPhone) or Chrome (Android).
2. iPhone: Share → Add to Home Screen.
3. Android: menu → Install app / Add to Home Screen.

The app then opens in standalone mode with the Kandi icon.

## Free phone preview on Render + Neon

The recommended free host for this app is a **Render Free web service** plus a **Neon Free Postgres** database. Render can run the Express + WebSocket server and gives you an `https://….onrender.com` URL, with no credit card. Neon keeps accounts, likes, chats, and uploaded photos when Render’s free instance sleeps or restarts (a local SQLite file would be wiped — free Render services have no persistent disk).

What to expect on the free tier (plain words):

- The site **goes to sleep after 15 minutes** with no visitors. The next open takes about **a minute** and Render shows a loading page. After that it should feel normal. Incoming chat messages also keep it awake.
- You get **750 free instance hours per month**. Sleeping time does not count. If you use all 750, the site pauses until next month.
- Neon’s free plan does **not** expire after 30 days (Render’s own free Postgres does — that’s why Neon is used instead). Neon compute also sleeps after a few idle minutes; the next query usually wakes it in under a second.
- This is a preview, not production hosting. Render may restart free services, and you should not put real paying users here.

### What Boston needs to do (accounts we can’t create for you)

1. **Put this folder in a GitHub repo.** If you already have GitHub, create a new repository, push `/workspace/kandi-app` (or this project root), and leave it public or private.
2. **Create a free Neon database (no credit card).**
   1. Open [https://console.neon.tech](https://console.neon.tech) and sign up with **GitHub or Google** (or email).
   2. Create a project (default region is fine).
   3. On the dashboard, copy the **connection string**. For this app, prefer the **direct** (non-pooler) URI, and keep `sslmode=require`.
3. **Deploy on Render (no credit card).**
   1. Open [https://dashboard.render.com/register](https://dashboard.render.com/register) and sign up with **GitHub** (Google or email also work). Render’s first-deploy docs say this path is free and no payment is required.
   2. Connect your GitHub account when asked, and authorize access to the Kandi repo.
   3. Click **New → Blueprint**. Point it at the repo that contains `render.yaml`, then Apply. **Or** click **New → Web Service**, select the repo, and set: Language/runtime **Node**, build command `npm install`, start command `npm start`, instance type **Free**.
   4. When prompted for `DATABASE_URL`, paste the Neon connection string. `KANDI_SECRET` can be auto-generated.
   5. Deploy. The public URL will look like `https://kandi-xxxx.onrender.com`. Open that on your iPhone. The first load after a sleep can take about a minute.

`Dockerfile` is also in this repo if you later move to Fly.io, Koyeb, or a VPS. Fly’s free path is only a $1 seven-day credit unless you add a card ($5/month after that). Koyeb’s free instance lasts longer between sleeps (1 hour) but **requires a credit card**. Railway was declined. Glitch no longer hosts new projects.

For a real launch you’ll want:

1. **Hosting.** A paid always-on plan (Render paid, Fly.io with a card, or a VPS) so the app does not sleep. Vercel is a poor fit as-is because this app is a long-running Express + WebSocket server, not a serverless Next.js app.
2. **HTTPS and a domain.** Session cookies are marked `Secure` automatically behind an HTTPS proxy.
3. **A hosted database** once you have more than one server or care about backups (Postgres is the usual next step). Back up `data/kandi.sqlite` if you stay on SQLite.
4. **Payments.** Replace `POST /api/subscribe` with Stripe Checkout + webhooks, or with Apple/Google in-app purchases for native apps. Do not collect card numbers in this app.
5. **App Store and Google Play (optional, for a native wrapper).** A PWA can ship first. A native app would need Apple Developer ($99/year) and Google Play Console (~$25 one-time) accounts, a wrapper (e.g. Capacitor), in-app purchase setup, age rating, and review. Dating apps face extra review and often must provide in-app reporting and 18+ gating — both already exist here, but you’ll still need policies and a review plan.
6. **Moderation.** There is report/block storage, but no admin review queue or photo moderation yet. You’ll need a process (and probably tooling) before opening this to strangers.
7. **Legal.** Terms of service, privacy policy, and dating-app specific consent / safety copy, plus age verification stronger than a typed age if you go public.

## What’s intentionally not in v1

- Real payments (stub only)
- Real GPS or SMS location sharing
- Email / phone verification, password reset, or OAuth
- Admin moderation dashboard
- Production-grade photo scanning or ID checks
- Native iOS / Android store builds
