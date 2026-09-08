# AR Video Album — Marikkanu Studios, Chennai

WebAR wedding albums: guests scan a printed QR code, point their phone at a
printed photo, and the matching video plays over it. No app install.

## Stack

- Frontend: TanStack Start + React + Tailwind, hosted on Vercel.
- AR: MindAR 1.2.5 + Three.js 0.149.0 (pinned; three is kept pre-0.152
  because mind-ar 1.2.5 imports `sRGBEncoding`). Client-only, dynamically
  imported, camera released on exit.
- Backend: AWS Lambda (Node 20) + API Gateway HTTP API (Cognito JWT) +
  single DynamoDB table + private S3 + CloudFront OAC. SAM in `infra/`.
- Media contract: JPEG/WebP photos (≤10 MB), MP4 H.264/AAC ≤50 MB,
  10–30 s @ 720p recommended (~8 MB/clip). Max 30 pages/album, 200 guests.

## Local development (mock mode, no AWS)

```sh
npm install
npm run dev
```

With all `VITE_*` blank the app runs on local mocks: uploads are object
URLs, AR is a "Simulate Scan" prototype. Copy `.env.example` to `.env.local`
to point at real infrastructure.

Useful scripts: `npm run build`, `npm run lint`, `npm test` (vitest:
contracts + build-revision logic), `npx tsc --noEmit`.

## Deploy order (AWS ap-south-1)

1. Safety gate: MFA on root, no root keys, IAM Identity Center deployment
   role (never deploy as root). Confirm billing/credits, create a US$5
   budget with alerts.
2. `infra/deploy.sh dev` — disposable stack with synthetic media. Verify:
   S3 private (Access Analyzer), OAC-only reads, origin-limited CORS,
   presigned-URL expiry, throttling, bounded logs, DLQ, old-build-never-wins.
   Then `infra/teardown.sh dev` proves clean teardown.
3. `infra/deploy.sh prod`, create the single Cognito admin user, verify SES
   sender for expiry warnings.
4. Per album with an expiry date, create two EventBridge Scheduler schedules
   with the stack's `SchedulerRoleArn`: warning (T-7 days → ExpiryWarningFn)
   and deletion (expiry date → ExpiryDeleteFn).
5. Vercel: import the repo, set the public `VITE_*` vars (API URL, Cognito
   client, CloudFront + canonical origins — never AWS secrets), deploy
   preview, smoke-test, promote. Printable QR codes generate only from the
   canonical origin; preview domains show a warning.
6. Pilot: upload 5 pages then 30, publish, print QR + photos, scan on iOS
   Safari and Android Chrome over mobile data. Freeze edits before the event;
   keep the prior manifest revision as rollback until expiry.

## Emergency pause

Set admin/upload/build Lambda concurrency to 0 (stops mutations and signing)
while published CloudFront media stays up, unless revocation is required.

## Teardown

`infra/teardown.sh <env>`, then inspect all regions (S3 versions/multiparts,
CloudFront, DDB backups, logs, DLQs, schedules, ECR) and recheck Billing
after 24–48 h.
