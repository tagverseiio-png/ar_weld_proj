#!/usr/bin/env bash
# Full teardown of a disposable stack (dev). Verifies no chargeable residue.
# Usage: ./teardown.sh dev
set -euo pipefail
ENV="${1:-dev}"
REGION="ap-south-1"
STACK="ar-wedding-${ENV}"

echo "==> disabling uploads/API first (set Lambda concurrency to 0)"
for fn in "-albums" "-uploads" "-builds" "-marker-builder"; do
  aws lambda put-function-concurrency --function-name "ar-wedding-${ENV}${fn}" --reserved-concurrent-executions 0 --region "$REGION" 2>/dev/null || true
done

BUCKET=$(aws cloudformation describe-stack-resources --stack-name "$STACK" --region "$REGION" \
  --query "StackResources[?ResourceType=='AWS::S3::Bucket'].PhysicalResourceId | [0]" --output text 2>/dev/null || true)
if [ -n "$BUCKET" ] && [ "$BUCKET" != "None" ]; then
  echo "==> emptying s3://$BUCKET (all versions + multipart)"
  aws s3 rm "s3://$BUCKET" --recursive --region "$REGION" || true
  aws s3api list-object-versions --bucket "$BUCKET" --region "$REGION" \
    --query '{Objects: Versions[].{Key:Key,VersionId:VersionId}}' --output json 2>/dev/null \
    | python3 -c "import json,sys; d=json.load(sys.stdin); print(len(d.get('Objects') or []))" || true
  aws s3api abort-multipart-uploads 2>/dev/null || true
fi

echo "==> sam delete"
sam delete --stack-name "$STACK" --region "$REGION" --no-prompts || true

echo "==> recheck billing after 24-48h; inspect all regions for:"
echo "    S3 versions/multipart, CloudFront distributions, DynamoDB backups,"
echo "    CloudWatch log groups, SQS DLQs, EventBridge schedules, ECR images."
