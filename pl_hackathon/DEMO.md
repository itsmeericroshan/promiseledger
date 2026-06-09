# 🎬 PromiseLedger — Judge's Demo Guide

This guide walks you through the key features in under 5 minutes.

---

## Option A — Live Demo (Easiest)
👉 Open **[https://promiseledger.vercel.app](https://promiseledger.vercel.app)**
> No setup needed. Everything works instantly.

---

## Option B — Run Locally

```bash
git clone https://github.com/YOUR_USERNAME/promiseledger.git
cd promiseledger
npm install
cp .env.local.example .env.local
# Add your ANTHROPIC_API_KEY to .env.local
npm run dev
# Open http://localhost:3000
```

---

## 🧪 Test Walkthrough (5 mins)

### Step 1 — Record a Promise (30 sec)
1. Click **✍️ Record a Promise**
2. Type: `We will form a dedicated women's security force in every district by 2026`
3. Add politician: `Ravi Kumar`
4. Pick a date and click **📌 Save This Promise**

### Step 2 — Record another (30 sec)
1. Type: `We will plant 10 million trees across urban areas by 2025`
2. Add: `Ministry of Environment`
3. Save it

### Step 3 — Test AI Fact-Check (1 min)
1. Click **🔍 Fact-Check** tab
2. Type: `women safety squad` *(different words, same meaning)*
3. Click **Search & Verify**
4. ✅ Watch AI find the matching promise despite different wording

### Step 4 — Test Auto-Analyse with Live Web Search (2 min)
1. Click **📋 Browse All**
2. Click on the **tree planting promise**
3. Click **🔎 Auto-Analyse Now**
4. Watch Claude search the live internet and return:
   - A verdict (Kept / Broken / Waiting)
   - Real news article links
   - Plain English summary
5. Click **Apply Verdict** to update the record

### Step 5 — Manual Verdict (30 sec)
1. In the same modal, scroll to **Update the Verdict**
2. Select ❌ Broken, add a note, click Submit
3. See the history log update

---

## 🤖 GenAI Features Summary

| Feature | Claude capability used |
|---|---|
| Fact-Check search | Semantic understanding — finds promises with different wording |
| Auto-Analyse | `web_search` tool — live internet search + analysis |
| Verdict generation | Reasoning — confidence scoring, source attribution |

---

## ❓ FAQ for Judges

**Q: Does this need a database?**  
A: No — data is stored in browser localStorage. Simple and works everywhere.

**Q: Is the API key safe?**  
A: Yes — it's stored in Vercel environment variables and only used server-side. Never exposed to the browser.

**Q: What if there's no internet?**  
A: Recording and browsing pledges works offline. AI features need internet.

**Q: Can multiple people use it?**  
A: Currently single-user (localStorage). A database like Supabase could make it multi-user — planned next step.
