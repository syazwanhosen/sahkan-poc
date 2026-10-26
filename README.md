# Sahkan e-Invoice demo

Clickable proof-of-concept of an LHDN e-invoicing web app. It uses sample data and a simulated MyInvois. Nothing is sent to LHDN.

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + single-file build in dist/index.html
npm run artifact   # build + dist/sahkan-demo.html (claude.ai artifact page)
```

Open a view directly with a hash: `#clients`, `#monthend`, `#requests`, `#buyer`, `#new`.

## What you can try

- Fix a rejected e-invoice (wrong TIN, missing classification) and resubmit it
- Send an e-invoice above RM10,000
- Approve or decline buyer requests from receipt QR codes, or switch on auto-issue
- Import a month of POS receipts and file the consolidated e-invoice
- Cancel within 72 hours (blocked when a credit note refers to it), credit and debit notes
- Switch to the accountant view: one board for every client, reminders, intermediary filing
- The buyer's phone page (EN/BM) that a receipt QR code opens
- See the UBL 2.1 JSON and the submission body for any e-invoice
- PDF, JSON and CSV downloads (inside the claude.ai viewer)

## Structure

```
src/
  types.ts              data model
  data/seed.ts          sample businesses, buyers, items, e-invoices, requests
  data/receipts.ts      generated POS receipts that reconcile to the cent
  lib/rules.ts          LHDN field rules: TIN, phone, postcode, classification codes, tax
  lib/ubl.ts            UBL 2.1 JSON + MyInvois submission body (SHA-256, base64)
  lib/split.ts          month-end split: consolidated / above RM10,000 / already issued
  lib/pdf.ts            e-invoice PDF (jsPDF), marked SAMPLE
  lib/csv.ts            sales file import
  state/actions.ts      everything the app does, including the simulated MyInvois
  state/store.ts        one store, kept in sessionStorage
  pages/                Today, E-invoices, composer, detail, requests, month-end, clients, buyers, items, settings
  shell.tsx, ui.tsx     layout and shared components
  styles.css            design tokens (light + dark) and components
```

## Simulated vs real

The demo accepts a submission at once and validates it a moment later, like the asynchronous MyInvois API. To go live, replace the simulated calls in `state/actions.ts`:

| Demo function   | MyInvois API                                              |
| --------------- | --------------------------------------------------------- |
| `submitDocs`    | `POST /api/v1.0/documentsubmissions` (body from `lib/ubl.ts`) |
| `validateOne`   | `GET /api/v1.0/documentsubmissions/{submissionUid}` (poll) |
| `cancelDoc`     | `PUT /api/v1.0/documents/state/{uuid}/state`              |
| `verifyTin`     | `GET /api/v1.0/taxpayer/validate/{tin}`                    |

Also needed for production: OAuth client credentials (taxpayer or intermediary `onbehalfof`), a digital signature on each document, a backend to hold secrets and queue submissions, and a database in place of sessionStorage.

All names, tax numbers and amounts are invented.
