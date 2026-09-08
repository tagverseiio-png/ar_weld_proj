#!/usr/bin/env bash
# Applies the per-env S3 CORS policy data-plane after `sam deploy`.
# Rationale: CloudFormation's EarlyValidation hook rejects intrinsic
# functions inside S3 CorsConfiguration.AllowedOrigins, so origins cannot
# come from stack parameters. This keeps the template valid while preserving
# origin-restricted browser uploads (presigned PUTs only).
# Usage: ./configure-cors.sh <bucket> <origin> [origin...]
set -euo pipefail
BUCKET="${1:?bucket required}"
shift
[ "$#" -ge 1 ] || { echo "at least one origin required" >&2; exit 1; }

ORIGINS_JSON=$(python3 -c "import json,sys; print(json.dumps([{'AllowedHeaders':['*'],'AllowedMethods':['GET','PUT','HEAD'],'AllowedOrigins':sys.argv[1:],'ExposeHeaders':['ETag'],'MaxAgeSeconds':300}]))" "$@")
aws s3api put-bucket-cors --bucket "$BUCKET" --cors-configuration "{\"CORSRules\": $ORIGINS_JSON}"
echo "CORS set on s3://$BUCKET for: $*"
