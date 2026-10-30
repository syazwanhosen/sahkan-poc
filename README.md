# Sahkan e-Invoice

Proof-of-concept of an LHDN e-invoicing web app. It has two workspaces:

- **Demo**: sample data, a simulated MyInvois and a demo clock. Nothing is sent to LHDN. This is all the single-file build (claude.ai artifact) can do.
- **MyInvois sandbox (or production)**: your own business on the real MyInvois API, through a small server that holds the credentials and the signing key: Vite's dev server locally, a Vercel Function when deployed. It runs on the real clock.

## Run

```bash
npm ci             # installs the packages for this computer's OS (macOS, Windows, Linux)
npm run dev        # http://localhost:5173, with the MyInvois server
npm run build      # type-check + single-file build in dist/index.html
npm run artifact   # build + dist/sahkan-demo.html (claude.ai artifact page)
```

Open a view directly with a hash: `#clients`, `#monthend`, `#requests`, `#buyer`, `#new`.

## Connect to MyInvois

1. Register on the MyInvois sandbox portal (preprod.myinvois.hasil.gov.my) and register an ERP system to get a client ID and secret. Production needs its own registration.
2. `cp .env.example .env`, fill in `MYINVOIS_CLIENT_ID` and `MYINVOIS_CLIENT_SECRET`, and restart `npm run dev`. The terminal says which systems are set up.
3. In the app, choose **Use MyInvois sandbox** in the top bar, then fill in your business in Settings. **Fill in from your MyInvois QR code** reads it from LHDN. The supplier TIN must be the taxpayer whose ERP system logs in: Settings shows which TIN that is, and the app refuses to send until they match (LHDN would answer "The authenticated TIN and documents TIN is not matching").
4. Optional: add an intermediary system (`MYINVOIS_INTERMEDIARY_*`) for the accountant view, and a signing certificate (`MYINVOIS_CERT_FILE`, `MYINVOIS_KEY_FILE`) to send signed version 1.1 documents. Without a certificate, documents go as version 1.0, which LHDN still accepts without a signature.

Behind a TLS-inspecting proxy (Zscaler and similar), Node can't verify LHDN's certificate. Point `MYINVOIS_CA_FILE` at the proxy's root certificate (`.env.example` shows how to export it on a Mac).

The live workspace is kept in localStorage, so it survives closing the browser. The demo is kept in sessionStorage as before. Switching between them keeps both.

## Deploy to Vercel

The page is static, and the MyInvois server runs as one Vercel Function (`api/myinvois.ts`); `vercel.json` sends every `/api/myinvois/*` call to it.

1. Import the repository in Vercel, or run `vercel` in this folder. `vercel.json` holds the settings: the Vite build, a clean `npm ci`, and the function in Singapore (`sin1`), the region closest to LHDN.
2. In the project's **Settings > Environment Variables**, add `MYINVOIS_ENV`, `MYINVOIS_CLIENT_ID`, `MYINVOIS_CLIENT_SECRET` and `MYINVOIS_ACCESS_KEY`, a long random value such as the output of `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` (works on Windows too). The intermediary system is optional, as in `.env.example`. Pasting your `.env` is fine: the function ignores `MYINVOIS_CA_FILE`, and `MYINVOIS_ALLOWED_HOSTS` only matters locally.
3. To send signed version 1.1 documents, paste the certificate and key themselves into `MYINVOIS_CERT_PEM` and `MYINVOIS_KEY_PEM`: a deployment has no files for `MYINVOIS_CERT_FILE`. One line with `\n` for each line break works too.
4. Redeploy after changing a variable. A deployment keeps the values it was built with.

Anyone with the link can open the demo. **Use MyInvois sandbox** asks for the access key once, and the browser keeps it. Without `MYINVOIS_ACCESS_KEY` the function refuses every MyInvois call, so a deployment can't expose the credentials by mistake. To make the whole site private too, turn on Vercel's Deployment Protection.

Each function instance logs in to MyInvois on its own and keeps the token while it stays warm, so the app logs in more often than under `npm run dev`. Vercel limits a request to 4.5 MB; the largest submission MyInvois takes (5 MB once base64-encoded) is about 3.75 MB as the browser sends it. `.vercelignore` keeps `.env` and keys out of `vercel` CLI uploads, which don't read `.gitignore`.

## What you can try

- Fix a rejected e-invoice (wrong TIN, missing classification) and resubmit it
- Send an e-invoice above RM10,000
- Approve or decline buyer requests from receipt QR codes, or switch on auto-issue
- Import a month of POS receipts and file the consolidated e-invoice
- Cancel within 72 hours (blocked when a credit note refers to it), credit and debit notes
- Received e-invoices from suppliers: reject one within 72 hours and see the supplier cancel it
- Switch to the accountant view: one board for every client, reminders, intermediary filing
- The buyer's phone page (EN/BM) that a receipt QR code opens
- See the UBL 2.1 JSON and the submission body for any e-invoice, and for live ones the copy LHDN holds
- PDF, JSON and CSV downloads (inside the claude.ai viewer)

## MyInvois APIs

All 17 are wrapped by the server (`server/client.ts`), exposed to the app under `/api/myinvois/*` (`server/handler.ts`), and used on a screen:

| MyInvois API | Used for |
| --- | --- |
| Login as Taxpayer System | Every call as the business owner. One token per system, cached until two minutes before it expires, and renewed after a 401 |
| Login as Intermediary System | The accountant view: logs in with `onbehalfof` set to the client's TIN (`TIN:ROB` for individuals with a business registration) |
| Submit Documents | Composer, buyer requests, month-end. Batches of up to 100 per taxpayer. The server sets the version, signs 1.1 documents, hashes and base64-encodes |
| Get Submission | Polls every 4 seconds after a submission (LHDN asks for 3 to 5), slowing down for long ones. Resumes after a reload |
| Get Document Details | The reasons a document is invalid, mapped to the form fields to fix. Also **Check with LHDN** on an e-invoice |
| Get Document | **Show the copy LHDN holds** in an e-invoice's data tab, and the lines of a received e-invoice |
| Cancel Document | Cancel within 72 hours, with LHDN's errors (window closed, a credit note refers to it) in plain words |
| Search Documents | **Received**: e-invoices suppliers issued to you in the last 30 days. Also a background check, at most every 2 minutes, for buyers asking you to cancel and for cancellations made on the portal |
| Reject Document | **Received**: reject a supplier's e-invoice within 72 hours of validation, once, with a reason. LHDN asks the supplier to cancel it |
| Validate Taxpayer's TIN | **Check** next to a TIN. LHDN checks it together with the ID number (BRN, MyKad, passport or army number) |
| Search Taxpayer's TIN | **Find it from the ID** (or by name) when the buyer doesn't know their TIN |
| Taxpayer's QR Code | Fills in the business, a buyer, or the buyer's phone page from a MyInvois QR code (paste the scanned text) |
| Get Notifications | **From MyInvois** on the Today page: the last 7 days |
| Get All Document Types | **Check the connection** and **Document types** in Settings |
| Get Document Type | **Document types** in Settings: a type's versions and LHDN's time limits (submit, cancel, reject) |
| Get Document Type Version | **Document types** in Settings: one version's details |
| Get Recent Documents | **Recent on MyInvois** in Settings: the last 31 days sent and received, with the channel (ERP, portal, app) and intermediary. LHDN means it for troubleshooting, so the app's own lists use Search Documents |

A validated live e-invoice's QR code opens its public validation page (`{portal}/{uuid}/share/{longId}`). Sandbox PDFs are watermarked SANDBOX.

### Server safety

Under `npm run dev` the server only answers this computer (`localhost`); set `MYINVOIS_ALLOWED_HOSTS` to open it to other devices. On Vercel it answers any of the project's domains, but only browsers that send the access key (`Authorization: Bearer`, compared in constant time), and none until `MYINVOIS_ACCESS_KEY` is set. Set the key in `.env` to try that flow locally. Everywhere, it refuses calls from other sites (Origin check, no CORS) and needs JSON bodies. Secrets never reach the browser: `/api/myinvois/status` reports only which systems are set up, and without the key only whether there is anything to unlock.

### Before production

This runs inside Vite's dev and preview servers, or as a Vercel Function behind one shared access key, which is fine for a proof of concept. For production, put user sign-in in front of `createHandler` (`server/handler.ts`) in place of the shared key, and add a database in place of localStorage and a queue for submissions. Then register the production ERP system and use a certificate from a Malaysian CA (MCMC's list of licensees).

## Structure

```
api/
  myinvois.ts           the same endpoints as a Vercel Function (vercel.json routes /api/myinvois/* to it)
server/
  config.ts             MYINVOIS_* settings, sandbox and production URLs
  client.ts             MyInvois API client: tokens, retries on 401 and 429, every endpoint
  sign.ts               version 1.1 digital signature (XAdES, RSA-SHA256), as the SDK's JSON guide
  handler.ts            /api/myinvois/* endpoints for the app, with the safety checks above
  plugin.ts             mounts the handler on Vite's dev and preview servers
src/
  types.ts              data model
  data/seed.ts          sample businesses, buyers, items, e-invoices, requests; the empty live workspace
  data/receipts.ts      generated POS receipts that reconcile to the cent
  lib/rules.ts          LHDN field rules: TIN, phone, postcode, classification codes, tax, business details
  lib/ubl.ts            UBL 2.1 JSON + MyInvois submission body (SHA-256, base64)
  lib/myinvois.ts       the app's client for /api/myinvois
  lib/split.ts          month-end split: consolidated / above RM10,000 / already issued
  lib/pdf.ts            e-invoice PDF (jsPDF), marked SAMPLE or SANDBOX
  lib/csv.ts            sales file import
  state/actions.ts      everything the app does: the simulated MyInvois and the live one
  state/store.ts        one store, two workspaces (demo in sessionStorage, live in localStorage)
  state/live.ts         the server's MyInvois setup, for the screens
  pages/                Today, E-invoices, Received, composer, detail, requests, month-end, clients, buyers, items, settings
  shell.tsx, ui.tsx     layout and shared components
  styles.css            design tokens (light + dark) and components
```

In the demo, all names, tax numbers and amounts are invented.
