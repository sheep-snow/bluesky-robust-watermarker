# Check Result Lambda Function

This Lambda function handles checking the status and results of watermark verification requests.

## Endpoints

- `GET /check-result?id={verification_id}` - Check verification status and result
  - Returns HTML page by default
  - Returns JSON if `Accept: application/json` header is present

## Response Status

- `processing` - Verification is still in progress
- `completed` - Verification completed successfully
- `error` - An error occurred during verification

## Environment Variables

- `VERIFICATION_RESULTS_TABLE` - DynamoDB table name for storing results
- `APP_NAME` - Application name for branding
- `DOMAIN_NAME` - Domain name for generating links
