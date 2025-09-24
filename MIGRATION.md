# S3からDynamoDBへのデータ移行ガイド

このガイドでは、S3バケットに保存されているユーザー情報と投稿情報をDynamoDBテーブルに移行する手順を説明します。

## 移行の概要

### 変更内容

#### ユーザー情報
- **移行前**: S3バケット `{AppName}-{stage}-user-info-{account}-{region}` にJSONファイルとして保存
- **移行後**: DynamoDBテーブル `{AppName}-{stage}-users` にレコードとして保存

#### 投稿情報
- **移行前**: S3バケットの投稿データから手動で収集、HTMLファイルとして来歴ページを生成
- **移行後**: DynamoDBテーブル `{AppName}-{stage}-posts` に投稿情報を保存、動的に来歴ページを生成

### データ構造
```json
// S3 (移行前): {userId}.json
{
  "blueskyUserId": "user.bsky.social",
  "encryptedBlueskyAppPassword": "***",
  "provenancePageId": "uuid",
  "updatedAt": "2025-01-18T05:22:18.502Z",
  "validatedAt": "2025-01-18T05:22:18.502Z",
  "createdAt": "2025-01-18T05:22:01.303Z"
}

// DynamoDB (移行後)
{
  "userId": "cognito-user-sub",  // 新規追加
  "blueskyUserId": "user.bsky.social",
  "encryptedBlueskyAppPassword": "***",
  "provenancePageId": "uuid",
  "updatedAt": "2025-01-18T05:22:18.502Z",
  "validatedAt": "2025-01-18T05:22:18.502Z",
  "createdAt": "2025-01-18T05:22:01.303Z"
}
```

## 移行手順

### 1. 依存関係のインストール
```bash
npm install
```

### 2. CDKスタックのデプロイ（DynamoDBテーブル作成）
```bash
# 開発環境
export AWS_PROFILE=${YOUR_AWS_PROFILE} && npx cdk deploy ${AppName}-dev-database --context stage=dev --require-approval never

# 本番環境
export AWS_PROFILE=${YOUR_AWS_PROFILE} && npx cdk deploy ${AppName}-prd-database --context stage=prd --require-approval never
```

### 3. データ移行の実行

#### ユーザー情報の移行
```bash
# 開発環境
export AWS_PROFILE=${YOUR_AWS_PROFILE} && npm run migrate-users -- --stage dev

# 本番環境
export AWS_PROFILE=${YOUR_AWS_PROFILE} && npm run migrate-users -- --stage prd
```

#### 投稿情報の移行
```bash
# 開発環境
export AWS_PROFILE=${YOUR_AWS_PROFILE} && npm run migrate-posts -- --stage dev

# 本番環境
export AWS_PROFILE=${YOUR_AWS_PROFILE} && npm run migrate-posts -- --stage prd
```

### 4. 更新されたLambda関数のデプロイ
```bash
# 開発環境
export AWS_PROFILE=${YOUR_AWS_PROFILE} && npx cdk deploy --all --context stage=dev --require-approval never

# 本番環境
export AWS_PROFILE=${YOUR_AWS_PROFILE} && npx cdk deploy --all --context stage=prd --require-approval never
```

### 5. 動作確認
1. アプリケーションにアクセス: `https://${YOUR_DOMAIN}/`
2. 既存ユーザーでログイン
3. マイページでBluesky設定が正しく表示されることを確認
4. 新規投稿が正常に動作することを確認

### 6. S3バケットのクリーンアップ（オプション）
動作確認が完了し、問題がないことを確認した後、古いS3バケットを削除できます：

```bash
# 注意: この操作は元に戻せません
aws s3 rm s3://${AppName}-${stage}-user-info-${account}-${region} --recursive
```

## トラブルシューティング

### 移行スクリプトでエラーが発生した場合
1. AWS認証情報が正しく設定されているか確認
2. S3バケットとDynamoDBテーブルが存在するか確認
3. 必要なIAM権限があるか確認

### Lambda関数でエラーが発生した場合
1. 環境変数 `USERS_TABLE_NAME` が正しく設定されているか確認
2. Lambda関数にDynamoDBアクセス権限があるか確認
3. CloudWatch Logsでエラーの詳細を確認

## ロールバック手順

問題が発生した場合、以下の手順でロールバックできます：

1. 古いバージョンのLambda関数を再デプロイ（S3を使用するバージョン）
2. DynamoDBテーブルを削除（データは失われません、S3に残っています）
3. 問題を修正後、再度移行を実行

## 注意事項

- 移行中はアプリケーションの使用を控えてください
- 移行前に必ずバックアップを取得してください
- 本番環境での移行前に、開発環境で十分にテストしてください
- S3バケットの削除は、動作確認が完了してから行ってください