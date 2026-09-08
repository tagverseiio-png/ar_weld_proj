#!/usr/bin/env bash
# Deploy (or update) a disposable dev or production stack.
# Usage: ./deploy.sh dev|prod
# Safety: never deploy with the root principal. Use the scoped
# ar-wedding-deployer profile (or an IAM Identity Center role) instead.
set -euo pipefail
ENV="${1:-dev}"
REGION="ap-south-1"
STACK="ar-wedding-${ENV}"
PARAMS="infra/params-${ENV}.json"

if aws sts get-caller-identity --query 'Arn' --output text 2>/dev/null | grep -q ':root$\|/root$'; then
  echo "REFUSING: authenticated as root. Assume the deployment role first." >&2
  exit 1
fi

# Convert params JSON file into sam '--parameter-overrides Key=Value' args,
# skipping blanks (SAM rejects empty values like NotifyEmail=).
OVERRIDES=$(python3 -c "import json;print(' '.join(f\"{k}={v}\" for k,v in json.load(open('$PARAMS')).items() if v not in ('', None)))")

echo "==> sam build"
sam build --template-file infra/template.yaml
echo "==> sam deploy ${STACK} (${REGION})"
# shellcheck disable=SC2086
sam deploy \
  --stack-name "$STACK" \
  --region "$REGION" \
  --capabilities CAPABILITY_IAM CAPABILITY_NAMED_IAM \
  --resolve-s3 \
  --parameter-overrides $OVERRIDES
echo "==> outputs"
aws cloudformation describe-stacks --stack-name "$STACK" --region "$REGION" \
  --query 'Stacks[0].Outputs' --output table

echo "==> per-env S3 CORS (see infra/configure-cors.sh)"
BUCKET=$(aws cloudformation describe-stacks --stack-name "$STACK" --region "$REGION" \
  --query 'Stacks[0].Outputs[?OutputKey==`MediaBucketName`].OutputValue' --output text)
ORIGINS=$(python3 -c "import json; p=json.load(open('$PARAMS')); print(' '.join([o for o in dict.fromkeys([p.get('VercelOrigin',''), p.get('CanonicalOrigin','')]) if o]))")
# shellcheck disable=SC2086
bash infra/configure-cors.sh "$BUCKET" $ORIGINS
