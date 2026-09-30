# Local setup

## প্রথমবার

```bash
npm install
cp .env.example .env   # তারপর SUPABASE_URL ও SUPABASE_PUBLISHABLE_KEY বসান
```

`.env`-এ শুধু publishable/anon key রাখবেন, service-role key কখনো নয়। `GEMINI_API_KEY` লাগে শুধু AI সহকারী local-এ চালাতে চাইলে।

## চালানো

| উপায় | কমান্ড | কী serve হয় |
| --- | --- | --- |
| npm | `npm start` | build করে, তারপর `app/` serve করে `http://localhost:5502`-এ |
| VS Code Live Server | "Go Live" | `app/` (`.vscode/settings.json` → root `/app`, port 5502) |
| Built output | `npm run build`, তারপর `public/` serve | deploy-এর মতো হুবহু ফাইল |

`npm run build` চালালে `app/supabase-config.js` (gitignored) তৈরি হয়। তাই source preview-তেও Supabase config পাওয়া যায়।

AI সহকারী (`/api/admin-assistant`) static server-এ চলে না, এর জন্য `vercel dev` লাগবে।

## Check

```bash
node --check app/js/some-file.js   # JS syntax
npm run build                      # repo-level sanity
```

## Supabase

- নতুন migration রাখুন `supabase/migrations/<timestamp>_<name>.sql` নামে।
- RPC signature বদলালে frontend wrapper একসাথে মিলিয়ে নিন।
- Apply করবেন অনুমোদিত workflow দিয়ে (Supabase CLI বা MCP)। Apply করার পর সম্ভব হলে RPC smoke test করুন।

## Scripts

- `scripts/`: এককালীন data/debug script (ছবি আপলোড, হিসাব Excel টেমপ্লেট, alumni workbook ইত্যাদি)। চালানোর আগে script-টা পড়ে নিন, কারণ কিছু script live DB-তে লেখে।
- `npm run make:hisab-template`: দফতর হিসাব Excel টেমপ্লেট তৈরি করে (Python + openpyxl)।
