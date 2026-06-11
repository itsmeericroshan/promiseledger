# 📜 PromiseLedger — AI-Powered Political Accountability

> **ET GenAI Hackathon 2.0 Submission**  
> Track political promises. Verify they were said. Know if they were kept.

---

## 🔴 Live Demo
👉 **[https://promiseledger.vercel.app](https://promiseledger-app-eric-roshan-t-s-projects.vercel.app/)**

## 🎥 Demo Video
👉 **[Watch on YouTube / Loom](#)**
> *(Replace with your demo video link)*

---

## 🧩 Problem Statement

Politicians make hundreds of promises during elections and in office. Citizens have no easy way to:
- **Verify** if a promise was actually made
- **Track** whether it was fulfilled or broken
- **Search** using natural language (not exact wording)

This creates an accountability gap that PromiseLedger fills.

---

## 💡 Solution

PromiseLedger is a web app that lets anyone:

| Feature | How it works |
|---|---|
| **Record a promise** | Save exact wording + politician name + date + source link with a tamper-proof SHA-256 fingerprint |
| **AI Fact-Check** | Type what you *remember* hearing — Claude AI finds the matching promise even with different words |
| **Auto-Analyse** | One click — Claude searches the live web and tells you if a promise was ✅ Kept, ❌ Broken, or ⏳ Waiting — with real news sources |
| **Verdict tracking** | Manually mark promises with evidence links; full update history |
| **Browse & Filter** | Filter by Kept / Broken / Waiting status |

---

## 🤖 GenAI Usage (Anthropic Claude)

This project uses the **Anthropic Claude API** (`claude-sonnet-4-20250514`) in two key ways:

### 1. Semantic Fact-Check (`/api/anthropic`)
When a user searches for a promise, Claude compares their query to all saved promises using **semantic understanding** — not keyword matching.

```
"women security force" → finds → "women safety squad initiative"
"build roads" → finds → "infrastructure development programme"
```

### 2. Live Web Analysis (`web_search` tool)
Claude uses the built-in `web_search_20250305` tool to **search the live internet** for news about a specific promise and returns:
- A plain-English verdict (Kept / Broken / Waiting)
- Confidence level (High / Medium / Low)
- Real news sources with links

**API calls are made server-side** via a Next.js API route — the API key is never exposed to the browser.

---

## 🛠 Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 14 (App Router), React 18 |
| Styling | Pure CSS (no UI libraries) |
| AI | Anthropic Claude API (`claude-sonnet-4-20250514`) |
| Web Search | Anthropic `web_search_20250305` tool |
| Storage | Browser localStorage (no database needed) |
| Hosting | Vercel (free tier) |

---

## 🚀 Run Locally

### Prerequisites
- Node.js 18+
- Anthropic API key from [console.anthropic.com](https://console.anthropic.com)

### Steps

```bash
# 1. Clone the repo
git clone https://github.com/YOUR_USERNAME/promiseledger.git
cd promiseledger

# 2. Install dependencies
npm install

# 3. Set up environment
cp .env.local.example .env.local
# Edit .env.local and add your Anthropic API key:
# ANTHROPIC_API_KEY=sk-ant-...

# 4. Start development server
npm run dev

# 5. Open in browser
open http://localhost:3000
```

---

## ☁️ Deploy to Vercel (Free)

1. Push this repo to GitHub (make it **public**)
2. Go to [vercel.com](https://vercel.com) → **New Project** → Import your repo
3. Add **Environment Variable**:
   - Key: `ANTHROPIC_API_KEY`
   - Value: `sk-ant-...` (your key from console.anthropic.com)
4. Click **Deploy**
5. Your app is live at `https://your-project.vercel.app` ✅

---

## 📁 Project Structure

```
promiseledger/
├── src/
│   └── app/
│       ├── page.js              # Main app (all UI + logic)
│       ├── layout.js            # Root layout + fonts
│       └── api/
│           └── anthropic/
│               └── route.js    # Secure API proxy (key never exposed to browser)
├── public/                      # Static assets
├── .env.local.example           # Environment template
├── .gitignore                   # Excludes .env.local and node_modules
├── next.config.js
└── package.json
```

---

## 🔐 Security

- API key stored in `.env.local` — **never committed to git** (in `.gitignore`)
- All Claude API calls go through `/api/anthropic` server-side route
- Browser never sees the API key

---

## 📋 Hackathon Checklist

- [x] Uses Generative AI (Anthropic Claude API)
- [x] Uses open-source tools (Next.js, React)
- [x] Public GitHub repository
- [x] Live demo URL (Vercel)
- [x] Working prototype
- [x] No licensed datasets used
- [x] GenAI API usage is core to the product, not cosmetic

---

## 👤 Team / Author

> *Add your name, team name, and Unstop profile link here*

---

## 📄 License

MIT — free to use and modify.
