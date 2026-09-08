# AR Video Album — Build Plan

**Strucureo — Single Studio MVP · WebAR + AWS S3 + Lambda + Vercel**

---

## 1. What We're Building

A WebAR system where a wedding studio uploads printed photos and their matching video clips. Guests scan a QR code in the printed album with their phone camera. No app install — the browser recognizes the printed photo and plays the matching video overlaid on top of it.

---

## 2. Final Stack Decision

| Layer | Choice | Why |
|---|---|---|
| Frontend (WebAR) | Vercel + MindAR.js + Three.js | Static hosting, fast global CDN, zero server needed for AR itself |
| Storage | AWS S3 | Cheap, durable storage for photos, videos, and `.mind` marker files |
| Compute / API | AWS Lambda (Node.js) + API Gateway | Serverless — pay only per request, no server to manage for low volume |
| Database | DynamoDB (or Supabase/Postgres if you prefer SQL) | Lightweight, pairs naturally with Lambda; simple key-based lookups |
| Marker generation | Lambda job using MindAR compiler CLI | Runs on upload, converts photo → `.mind` marker file automatically |
| Video delivery | S3 + CloudFront (CDN) | Fast video load on guest's phone, reduces S3 direct-access cost |
| Admin upload panel | Simple Next.js page on Vercel, hitting the same Lambda APIs | Lets studio staff upload photo+video pairs without touching AWS console |

---

## 3. Architecture Flow

```
STUDIO ADMIN (Vercel Next.js page)
   → uploads photo + video for each album page
   → calls API Gateway endpoint: POST /albums/{id}/pages

API GATEWAY → AWS LAMBDA (upload handler)
   → stores photo + video directly to S3
   → writes page record to DynamoDB (album_id, photo_url, video_url)
   → triggers second Lambda: marker-builder

LAMBDA (marker-builder)
   → runs MindAR compiler on all photos in the album
   → outputs one combined .mind file
   → saves .mind file to S3
   → updates album record: marker_file_url, status = ready

GUEST FLOW (phone browser)
   → scans QR code → opens yourstudio.com/ar/{albumId} (hosted on Vercel)
   → page fetches album data: GET /albums/{id} → API Gateway → Lambda → DynamoDB
   → page loads .mind file + video URLs from S3/CloudFront
   → MindAR activates camera, detects photo, overlays matching video
```

---

## 4. AWS Resources

| Resource | Purpose |
|---|---|
| S3 Bucket — `ar-album-media` | Stores raw photos, videos, and `.mind` marker files |
| S3 bucket policy + CloudFront distribution | Serves media fast, avoids exposing raw S3 URLs, caches videos globally |
| Lambda: `uploadHandler` | Receives photo+video from admin panel, saves to S3, writes DB record |
| Lambda: `markerBuilder` | Compiles `.mind` file whenever an album's photos change |
| Lambda: `getAlbum` | Returns album data (pages, video URLs, marker file URL) to guest page |
| API Gateway | Exposes the 3 Lambdas as REST endpoints |
| DynamoDB — `Albums` | `album_id, studio_id, couple_name, marker_file_url, status` |
| DynamoDB — `AlbumPages` | `page_id, album_id, photo_url, video_url, marker_index` |
| IAM roles | Lambda execution roles scoped only to the needed S3 bucket + DynamoDB tables |

---

## 5. Frontend (Vercel) Structure

- **Public guest page:** `/ar/[albumId]` — loads MindAR + Three.js, fetches album JSON, starts camera, tracks markers, plays matching video on detection.
- **Admin page:** `/admin/albums/[id]` — form to upload photo + video pairs, shows processing status while `markerBuilder` runs, generates the final QR code once status = ready.
- Both live in the same Next.js project on Vercel — admin routes protected with simple password/auth for now (single studio).

---

## 6. Content Pipeline (Studio Workflow)

1. Studio photographs/scans the printed album page (clear, well-lit, matte finish preferred over glossy).
2. Studio trims the matching video clip — recommend 10–30 seconds, compressed H.264, 720p, to keep guest data usage low.
3. Both files uploaded via the admin panel — one photo + one video per album page.
4. `markerBuilder` Lambda automatically regenerates the album's combined `.mind` file whenever a page is added or changed.
5. Once status flips to "ready," the system generates one QR code per album linking to `/ar/{albumId}` — printed on the album's inside cover or first page.

---

## 7. Cost Shape (Single Studio, Low Volume)

At this scale (a handful of albums per month, guests scanning occasionally at events), monthly AWS cost should be very low — Lambda and API Gateway both have generous free tiers, and S3 + CloudFront costs scale with video storage/bandwidth, not idle time. Main cost driver: video storage and CDN bandwidth during wedding events when many guests scan at once.

---

## 8. Key Technical Constraints

| Concern | Approach |
|---|---|
| Glare/poor lighting on printed photo | Matte print finish; MindAR tolerates moderate variance but avoid glossy lamination |
| Large video files on guest mobile data | Aggressive H.264 compression, keep clips short, serve via CloudFront |
| Multiple photos per page confusing tracking | One marker photo per physical page |
| Old/faded album retrofits | Require a fresh, high-contrast re-scan of the original photo before generating its marker |
| Weak signal at event venues | Optional: PWA service worker to pre-cache album assets once guest scans QR on wifi beforehand |

---

## 9. Build Order

1. Set up S3 bucket, DynamoDB tables, and IAM roles.
2. Build and deploy the 3 Lambdas (`uploadHandler`, `markerBuilder`, `getAlbum`) behind API Gateway.
3. Build the admin upload page on Vercel, wire it to `uploadHandler`.
4. Build the guest-facing `/ar/[albumId]` page with MindAR integration, wire it to `getAlbum`.
5. Test end-to-end with one real album: upload 5–6 photo+video pairs, generate QR, scan on an actual phone.
6. Add CloudFront in front of the S3 bucket once the flow works, for faster video delivery.
7. Retrofit workflow: add a way to re-scan and upload old physical album photos into the same pipeline.

---

## 10. Future (Not Needed Now)

If this expands beyond one studio, the main addition is a `studio_id` tenancy layer across all tables and Lambdas, plus a proper multi-studio admin dashboard with separate logins. No architectural rework needed — just an added tenant boundary.

---

## 11. Lovable Prompt (Frontend Only — Tailwind + Framer Motion)

> Use this prompt as-is in Lovable. It builds **only the frontend UI** (no backend logic) — you'll wire it to your real Lambda API endpoints afterward.

```
Build a frontend-only web app called "AR Video Album" for a wedding photography
studio in Chennai. Use React, Tailwind CSS, and Framer Motion for animations.
No backend — use mock/placeholder data and functions for now, structured so
real API calls can be swapped in later.

STYLE:
- Elegant, warm, wedding-themed aesthetic — soft ivory/cream background,
  deep maroon or gold accent color, elegant serif font for headings
  (e.g. "Playfair Display"), clean sans-serif for body text.
- Smooth Framer Motion transitions on page load, card hover, and button taps.
- Mobile-first responsive design — most real users will open this on a phone.

PAGES / SCREENS:

1. Guest AR Landing Page ("/ar/:albumId")
   - Full-screen camera viewfinder mock (placeholder camera UI, not real
     camera access yet).
   - Overlay instructions: "Point your camera at a photo in the album"
     with a subtle pulsing frame guide animation.
   - Studio logo + couple's names elegantly displayed at the top.
   - Loading state: animated shimmer while "album data" is fetching
     (use mock delay).
   - Bottom sheet that slides up (Framer Motion) showing "Now Playing:
     [Photo Title]" once a mock scan is "detected" (trigger with a button
     for now — e.g. "Simulate Scan").

2. Admin Dashboard ("/admin")
   - Sidebar or top nav: Albums, Upload, Settings.
   - Albums list view: cards showing album thumbnail, couple name,
     status badge (Draft / Processing / Ready), and a "Copy QR Link" button.
   - Empty state with a friendly illustration/icon and "Create your first
     album" CTA.

3. Album Detail / Upload Page ("/admin/albums/:id")
   - Two-column layout: left = list of uploaded photo+video pairs
     (as cards with thumbnail + small video preview icon), right = upload
     form (drag-and-drop zone for photo, drag-and-drop zone for video,
     "Add Page" button).
   - Status indicator per page: "Uploaded" / "Processing marker" / "Ready"
     with animated progress spinner during processing (mock state).
   - Sticky footer/header showing overall album status and a "Generate QR
     Code" button (disabled until all pages ready) — reveals a QR code
     card with download button when clicked.

4. QR Code / Share Page ("/admin/albums/:id/share")
   - Large centered QR code card with a soft drop shadow and gold border
     accent.
   - "Download QR," "Copy Link," and "Preview as Guest" buttons.
   - Small mockup preview of a printed album page with the QR sticker
     placement suggestion.

COMPONENTS TO BUILD REUSABLY:
- StatusBadge (Draft / Processing / Ready, color-coded)
- UploadDropzone (drag-and-drop, accepts image or video type prop)
- AlbumCard
- AnimatedCameraFrame (for the guest scanning UI)
- BottomSheet (for the "now playing" reveal)

INTERACTIONS TO FAKE FOR NOW (no backend):
- "Simulate Scan" button on the guest page that triggers the bottom sheet
  animation with a placeholder video.
- Upload dropzones accept a file and just show a local preview + fake
  "processing" delay before flipping to Ready.
- All data can live in local component state or a simple mock JSON file —
  structure it so it's easy to later replace with real fetch() calls to
  API endpoints like GET /albums/:id and POST /albums/:id/pages.

Keep the code modular and clearly commented where a real API call should
eventually replace the mock logic.
```

---

*Prepared for Aathish — Strucureo, Chennai*
